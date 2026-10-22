import { z } from "zod";
import { revalidatePath } from "next/cache";
import { currentMember } from "@/lib/session";
import { baseURL } from "@/lib/config";
import { catalogRefSchema, readLimited } from "@/lib/catalog-server";
import { createImport, getImport, listImports, chooseImport, editImport, setImportStatus, processImportItem, importReport } from "@/lib/import-server";
import { importInputSchema, importTemplate, ImportValidationError } from "@/lib/import-parser";
import { ConflictError, InputError } from "@/lib/records";
const id = z.string().uuid(), revision = z.number().int().min(1);
const common = { batchId: id, itemId: id };
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), id, kind: z.enum(["movie", "book"]), label: z.string().max(100), inputs: z.array(importInputSchema).min(1).max(500) }).strict(),
  z.object({ op: z.literal("choose"), ...common, revision, ref: catalogRefSchema, existingId: id.nullable().optional(), newWork: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("edit"), ...common, revision, command: z.enum(["select", "skip", "retry", "edit"]), input: importInputSchema.optional(), selected: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("status"), batchId: id, updatedAt: z.number(), status: z.enum(["planned", "in_progress", "completed"]) }).strict(),
  z.object({ op: z.literal("step"), ...common, operation: z.enum(["match", "commit", "cover"]) }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };
function fail(e: unknown) {
  const message = e instanceof z.ZodError ? e.issues[0]?.message : e instanceof Error ? e.message : "暂时无法处理，请重试。";
  return Response.json({ error: message }, { status: e instanceof ConflictError ? 409 : e instanceof InputError || e instanceof ImportValidationError || e instanceof SyntaxError || e instanceof z.ZodError ? 400 : 500, headers });
}
export async function GET(request: Request) {
  const me = await currentMember(); if (!me) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("format") === "template") return new Response(importTemplate, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="tongye-import-template.csv"' } });
    const batchId = params.get("id");
    if (!batchId) return Response.json({ batches: listImports(me) }, { headers });
    const batch = getImport(me, id.parse(batchId));
    if (params.get("format") === "csv") return new Response(importReport(batch), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tongye-import-${batch.id}.csv"` } });
    return Response.json({ batch }, { headers });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request) {
  const me = await currentMember(); if (!me) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(baseURL).origin) return Response.json({ error: "请求来源无效。" }, { status: 403, headers });
  try {
    const v = schema.parse(JSON.parse((await readLimited(new Response(request.body), 2 * 1024 * 1024)).toString("utf8")));
    if (v.op === "create") return Response.json({ batch: createImport(me, v.kind, v.inputs, v.label, v.id) }, { headers });
    if (v.op === "status") return Response.json({ batch: setImportStatus(me, v.batchId, v.updatedAt, v.status) }, { headers });
    const item = v.op === "choose" ? await chooseImport(me, v.batchId, v.itemId, v.revision, v.ref, v.existingId, v.newWork)
      : v.op === "edit" ? editImport(me, v.batchId, v.itemId, v.revision, v.command, v.input, v.selected)
      : await processImportItem(me, v.batchId, v.itemId, v.operation);
    revalidatePath("/", "layout");
    return Response.json({ item }, { headers });
  } catch (e) { return fail(e); }
}
