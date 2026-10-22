"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentMember } from "./session";
import { InputError, ConflictError } from "./records";
import { updatePhotos, photoTrash, writePhotoComment, writeTrip } from "./photo-server";
import type { Member, Result } from "./types";
async function change<T>(fn: (member: Member) => T): Promise<Result<T>> {
  const member = await currentMember();
  if (!member) return { ok: false, error: "登录已过期，请重新登录。输入已保留。" };
  try { const data = fn(member); revalidatePath("/", "layout"); return { ok: true, data }; }
  catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message || "请检查填写内容。" };
    if (e instanceof InputError) return { ok: false, error: e.message, conflict: e instanceof ConflictError };
    return { ok: false, error: "暂时无法保存，请重试。输入已保留。" };
  }
}
export async function savePhotos(input: unknown) { return change(() => updatePhotos(input)); }
export async function changePhotoTrash(input: unknown) { return change(() => photoTrash(input)); }
export async function savePhotoComment(input: unknown) { return change(member => writePhotoComment(member, input)); }
export async function saveTrip(input: unknown) { return change(member => writeTrip(member, input)); }
