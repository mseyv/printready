import { describe, expect, it } from "vitest";
import { buildOutputFilename, safeStem } from "@/lib/shared/filename";
import { sniffImageFormat } from "@/lib/shared/formats";
import { upscaleFieldsSchema, type UpscaleFields } from "@/lib/shared/schema";
import { PublicError } from "@/server/errors";
import { clientKey, RateLimiter } from "@/server/rate-limit";
import { signedUrl, verifySignedUrl } from "@/server/signing";
import { resolveTarget } from "@/server/target";

describe("request schema", () => {
  const ok = { scale: "2", dpi: "300", format: "png", lockAspect: "true" };

  it("parses valid fields", () => {
    expect(upscaleFieldsSchema.parse({ ...ok, width: "3000", quality: "80" })).toEqual({
      scale: 2,
      dpi: 300,
      format: "png",
      lockAspect: true,
      width: 3000,
      quality: 80,
      faceEnhance: null,
    });
  });

  it("parses enhancement options", () => {
    expect(upscaleFieldsSchema.parse({ ...ok, model: "realesrgan-x4plus-anime", faceEnhance: "codeformer", tileSize: "400" })).toMatchObject({
      model: "realesrgan-x4plus-anime",
      faceEnhance: "codeformer",
      tileSize: 400,
    });
    expect(upscaleFieldsSchema.parse({ ...ok, faceEnhance: "none" }).faceEnhance).toBeNull();
  });

  it.each([
    [{ ...ok, scale: "3" }],
    [{ ...ok, scale: "8" }],
    [{ ...ok, dpi: "-5" }],
    [{ ...ok, dpi: "72.5" }],
    [{ ...ok, dpi: "abc" }],
    [{ ...ok, format: "gif" }],
    [{ ...ok, format: "../etc/passwd" }],
    [{ ...ok, width: "1e5" }],
    [{ ...ok, quality: "0" }],
    [{ ...ok, quality: "101" }],
    [{ ...ok, lockAspect: "yes" }],
    [{ ...ok, model: "RealESRGAN_x4plus.pth" }],
    [{ ...ok, faceEnhance: "true" }],
    [{ ...ok, tileSize: "300" }],
    [{ ...ok, tileSize: "0" }],
    [{ ...ok, extra: "1" }],
    [{ scale: "2", format: "png" }],
  ])("rejects %o", (fields) => {
    expect(upscaleFieldsSchema.safeParse(fields).success).toBe(false);
  });
});

describe("resolveTarget (server-side dimension resolution)", () => {
  const original = { width: 1920, height: 1080 };
  const p = (x: Partial<UpscaleFields>): UpscaleFields => ({ scale: 2, dpi: 300, format: "png", lockAspect: true, faceEnhance: null, ...x });

  it("defaults to the preset factor", () => {
    expect(resolveTarget(original, p({ scale: 4 }))).toEqual({ width: 7680, height: 4320 });
  });
  it("derives the missing side when locked", () => {
    expect(resolveTarget(original, p({ width: 3000 }))).toEqual({ width: 3000, height: 1688 });
    expect(resolveTarget(original, p({ height: 1000 }))).toEqual({ width: 1778, height: 1000 });
  });
  it("rejects inconsistent sizes when locked", () => {
    expect(() => resolveTarget(original, p({ width: 3000, height: 3000 }))).toThrow(PublicError);
  });
  it("accepts independent sizes when unlocked", () => {
    expect(resolveTarget(original, p({ width: 3000, height: 3000, lockAspect: false }))).toEqual({ width: 3000, height: 3000 });
  });
  it("requires both sides when unlocked", () => {
    expect(() => resolveTarget(original, p({ width: 3000, lockAspect: false }))).toThrow(PublicError);
  });
});

describe("file signature sniffing", () => {
  const b = (...x: number[]) => new Uint8Array([...x, ...new Array(16).fill(0)]);
  it("detects supported formats by magic bytes", () => {
    expect(sniffImageFormat(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageFormat(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImageFormat(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]))).toBe("webp");
    expect(sniffImageFormat(b(0x49, 0x49, 0x2a, 0x00))).toBe("tiff");
    expect(sniffImageFormat(b(0x4d, 0x4d, 0x00, 0x2a))).toBe("tiff");
  });
  it("rejects everything else, regardless of name", () => {
    expect(sniffImageFormat(new Uint8Array(Buffer.from("GIF89a........")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(Buffer.from("<svg xmlns=...>")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(Buffer.from("RIFF....WAVEfmt ")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("output filenames", () => {
  it("builds descriptive names", () => {
    expect(buildOutputFilename({ originalName: "original-name.jpg", preset: 2, width: 3840, height: 2160, dpi: 300, format: "png" })).toBe(
      "original-name_upscaled-2x_3840x2160_300dpi.png",
    );
    expect(buildOutputFilename({ originalName: "a.png", preset: null, width: 3000, height: 1688, dpi: 72, format: "jpeg" })).toBe(
      "a_upscaled-custom_3000x1688_72dpi.jpg",
    );
  });
  it("sanitises hostile names", () => {
    expect(safeStem("../../etc/passwd")).toBe("passwd");
    expect(safeStem("C:\\Users\\x\\My Photo (1).JPG")).toBe("My-Photo-1");
    expect(safeStem('a"b<c>|d.png')).toBe("a-b-c-d");
    expect(safeStem(".....")).toBe("image");
    expect(safeStem("Фото отпуск.tiff")).toBe("Фото-отпуск");
    expect(safeStem("x".repeat(300) + ".png")).toHaveLength(80);
  });
});

describe("signed URLs", () => {
  const secret = Buffer.from("s".repeat(32));
  const id = "AAAAAAAAAAAAAAAAAAAAAA";
  const params = (url: string) => new URL(url, "http://x").searchParams;

  it("verifies untampered URLs before expiry", () => {
    const url = signedUrl(secret, id, "download", Date.now() + 60_000);
    expect(verifySignedUrl(secret, id, "download", params(url))).toBe("ok");
  });
  it("rejects other jobs, kinds, secrets and edited expiry", () => {
    const url = signedUrl(secret, id, "download", Date.now() + 60_000);
    expect(verifySignedUrl(secret, "BBBBBBBBBBBBBBBBBBBBBB", "download", params(url))).toBe("invalid");
    expect(verifySignedUrl(secret, id, "preview", params(url))).toBe("invalid");
    expect(verifySignedUrl(Buffer.from("t".repeat(32)), id, "download", params(url))).toBe("invalid");
    const p = params(url);
    p.set("exp", String(Number(p.get("exp")) + 3600));
    expect(verifySignedUrl(secret, id, "download", p)).toBe("invalid");
  });
  it("reports expiry", () => {
    const url = signedUrl(secret, id, "download", Date.now() - 1000);
    expect(verifySignedUrl(secret, id, "download", params(url))).toBe("expired");
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window, then reports retry-after", () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.hit("a", 0)).toBe(0);
    expect(rl.hit("a", 1)).toBe(0);
    expect(rl.hit("a", 2)).toBe(60);
    expect(rl.hit("b", 2)).toBe(0);
    expect(rl.hit("a", 60_000)).toBe(0);
  });

  it("takes the client address appended by trusted proxies, ignoring spoofed entries", () => {
    // Client sent "1.1.1.1"; our proxy appended the real peer 203.0.113.9.
    expect(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    // CDN appended the client, then our proxy appended the CDN edge.
    expect(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 10.0.0.5" }), 2)).toBe("203.0.113.9");
    expect(clientKey(new Headers({ "x-forwarded-for": "198.51.100.7" }), 0)).toBe("198.51.100.7");
    expect(clientKey(new Headers(), 1)).toBe("unknown");
  });
});
