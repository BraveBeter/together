import type { Photo } from "./photo-types";

type UploadResult = { ok: true; photo: Photo; duplicate: boolean } | { ok: false; error: string };
const unknownResult = "未能确认上传结果，重试会自动查重。";

// Proxies can reject a request before the app responds, returning HTML or an
// empty body. HTTP errors must remain useful without a JSON response.
export function readPhotoUploadResult(status: number, text: string): UploadResult {
  let body: { error?: unknown; photo?: Photo; duplicate?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* Use the HTTP status below. */ }
  if (status === 200 && body?.photo && typeof body.photo.id === "string" && typeof body.photo.assetId === "string") {
    return { ok: true, photo: body.photo, duplicate: body.duplicate === true };
  }
  if (typeof body?.error === "string" && body.error.trim()) return { ok: false, error: body.error };
  if (status === 413) return { ok: false, error: "服务器拒绝了这张照片的大小，照片仍在列表中，请稍后重试。" };
  if (status === 401) return { ok: false, error: "登录已过期，请重新登录后重试。" };
  if (status === 403) return { ok: false, error: "上传被拒绝，请重新登录后重试。" };
  if (status >= 500) return { ok: false, error: "服务器暂时无法处理照片，照片仍在列表中，可以稍后重试。" };
  return { ok: false, error: status === 200 ? unknownResult : "上传失败，照片仍在列表中，可以重试。" };
}
