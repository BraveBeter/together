import { describe, expect, it } from "vitest";
import { readPhotoUploadResult } from "../src/lib/photo-upload-result";

describe("photo upload responses through a reverse proxy", () => {
  it.each(["", "<html>413 Request Entity Too Large</html>"])("explains a proxy size rejection without JSON (%s)", text => {
    const result = readPhotoUploadResult(413, text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("服务器拒绝了这张照片的大小");
  });
  it("preserves the app's actual file-size error", () => {
    expect(readPhotoUploadResult(413, '{"error":"单张照片不能超过 25 MB。"}')).toEqual({ ok: false, error: "单张照片不能超过 25 MB。" });
  });
  it.each([401, 403, 502, 503, 504])("handles non-JSON HTTP %s responses", status => {
    const result = readPhotoUploadResult(status, "<html>Upstream response</html>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(status < 500 ? "重新登录" : "稍后重试");
  });
  it.each(["not-json", "null", "{}", '{"photo":{}}'])("never marks an unconfirmed result as uploaded (%s)", text => {
    expect(readPhotoUploadResult(200, text)).toEqual({ ok: false, error: "未能确认上传结果，重试会自动查重。" });
  });
  it("retains a confirmed duplicate and its original photo ID", () => {
    const photo = { id: "existing-photo", assetId: "existing-asset", deletedAt: null };
    expect(readPhotoUploadResult(200, JSON.stringify({ photo, duplicate: true }))).toEqual({ ok: true, photo, duplicate: true });
  });
});
