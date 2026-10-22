import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db";
import * as s from "../src/db/schema";
import { createImport, getImport, chooseImport, processImportItem, importReport } from "../src/lib/import-server";
import { matchText, validateImportInput } from "../src/lib/import-parser";
import { catalogRefSchema } from "../src/lib/catalog-server";
import type { ImportInput } from "../src/lib/import-types";
import type { CatalogRef } from "../src/lib/catalog-metadata";

const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
async function main() {
  if (!args.includes("--file") || !args.includes("--owner-email") || !args.includes("--report")) throw new Error("Usage: import-list.ts --file approved.json --owner-email user@example.com --report /private/path/report [--batch UUID] [--execute] [--reuse-map map.json]");
  const file = flag("--file"), report = flag("--report"), email = flag("--owner-email").toLowerCase();
  const member = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, seat: s.members.seat, color: s.members.color, avatarId: s.members.avatarId }).from(s.members).innerJoin(s.user, eq(s.members.userId, s.user.id)).where(eq(s.user.email, email)).get();
  if (!member) throw new Error("The named account is not a member. No data changed.");
  const source = JSON.parse(readFileSync(file, "utf8")) as { input: ImportInput; ref: CatalogRef }[];
  if (!Array.isArray(source) || !source.length || source.length > 500) throw new Error("Expected 1–500 reviewed items.");
  const kind = catalogRefSchema.parse(source[0].ref).kind;
  const rows = source.map(r => ({ input: validateImportInput(r.input, kind), ref: catalogRefSchema.parse(r.ref) }));
  if (rows.some(r => r.ref.kind !== kind)) throw new Error("A batch must contain one media kind.");
  const reuse: Record<string, string> = args.includes("--reuse-map") ? JSON.parse(readFileSync(flag("--reuse-map"), "utf8")) : {};
  const batchId = args.includes("--batch") ? flag("--batch") : existsSync(`${report}.json`) ? JSON.parse(readFileSync(`${report}.json`, "utf8")).id : randomUUID();
  const batch = createImport(member, kind, rows.map(r => r.input), `已核对${kind === "movie" ? "片单" : "书单"} · ${rows.length} 部`, batchId);
  if (batch.items.length !== rows.length || batch.items.some((i, n) => JSON.stringify(i.input) !== JSON.stringify(rows[n].input))) throw new Error("Existing task differs from this reviewed manifest; use the original file or a new batch.");
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const protectedData = () => ({
    otherRecords: hash(sqlite.prepare("SELECT * FROM personal_records WHERE user_id<>? ORDER BY entry_id,user_id").all(member.id)),
    reviews: hash(sqlite.prepare("SELECT * FROM reviews ORDER BY id").all()),
    memories: hash(sqlite.prepare("SELECT * FROM memories ORDER BY id").all()),
    together: hash(sqlite.prepare("SELECT * FROM together_confirmations ORDER BY entry_id").all()),
    challengeEntries: hash(sqlite.prepare("SELECT * FROM challenge_entries ORDER BY challenge_id,entry_id").all()),
  });
  const before = protectedData();
  writeFileSync(`${report}.protected-before.json`, JSON.stringify(before, null, 2), { mode: 0o600 });
  const save = () => { const current = getImport(member, batchId); writeFileSync(`${report}.json`, JSON.stringify(current, null, 2), { mode: 0o600 }); writeFileSync(`${report}.csv`, importReport(current), { mode: 0o600 }); return current; };
  save();
  for (let i = 0; i < rows.length; i += 2) {
    await Promise.all(rows.slice(i, i + 2).map(async (reviewed, j) => {
      let item = getImport(member, batchId).items[i + j];
      if (item.state === "done" || item.state === "skipped") return;
      try {
        item = await chooseImport(member, batchId, item.id, item.revision, reviewed.ref, reuse[reviewed.input.title]);
        if (matchText(item.catalog!.title) !== matchText(reviewed.input.title) || reviewed.input.year && item.catalog!.year !== reviewed.input.year) throw new Error("Source title/year differs from reviewed manifest; no entry written.");
        if (args.includes("--execute") && ["ready", "existing"].includes(item.state)) item = await processImportItem(member, batchId, item.id, "commit");
        if (!["done", "ready", "existing"].includes(item.state) || item.warning) console.log(`${item.position}. ${item.input.title}: ${item.state} ${item.error || item.warning}`);
      } catch (e) { console.log(`${i + j + 1}. ${reviewed.input.title}: ${e instanceof Error ? e.message : "failed"}`); }
    }));
    save(); if (i % 10 === 0 || i + 2 >= rows.length) console.log(`Processed ${Math.min(i + 2, rows.length)} / ${rows.length}`);
  }
  const after = protectedData();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Protected data changed during import. Check concurrent edits against the backup before proceeding.");
  const final = save(), counts: Record<string, number> = {};
  for (const row of final.items) counts[row.outcome || row.state] = (counts[row.outcome || row.state] || 0) + 1;
  console.log(JSON.stringify({ batchId, total: rows.length, counts, coverWarnings: final.items.filter(i => i.warning).length, protectedDataUnchanged: true, report: `${report}.csv` }, null, 2));
  if (args.includes("--execute") && final.items.some(i => i.state !== "done")) process.exitCode = 2;
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; });
