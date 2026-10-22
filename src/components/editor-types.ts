import type { Entry, Kind, Memory, Result, Status } from "@/lib/types";
export type EditState = { type: "entry"; entry?: Entry; kind?: Kind; status?: Status }
  | { type: "review" | "personal" | "recommend" | "together"; entry: Entry; status?: Status }
  | { type: "memory"; entry: Entry; memory?: Memory }
  | null;
export type Run = (task: () => Promise<Result<unknown>>, message?: string) => Promise<boolean>;
