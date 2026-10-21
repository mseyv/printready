import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { scaleSize, type Size } from "@/lib/shared/dimensions";
import type { OutputFormat } from "@/lib/shared/formats";
import { planUpscale, type ProcessingLimits } from "@/lib/shared/plan";
import { PublicError } from "@/server/errors";
import { readExifResolution } from "@/server/metadata";
import { probeImage, processImage, type ProcessResult } from "@/server/pipeline";
import type { UpscaleEngine } from "@/server/engines/types";
import { createFakeEngine } from "../helpers/fake-engine";
import { rgbaImage, rgbImage } from "../helpers/fixtures";

const limits: ProcessingLimits = {
  maxUploadBytes: 25 << 20,
  maxInputPixels: 25_000_000,
  minOutputSide: 16,
  maxOutputSide: 16_384,
  maxOutputPixels: 64_000_000,
  maxAiOutputPixels: 100_000_000,
  minDpi: 1,
  maxDpi: 10_000,
};

async function run(
  input: Buffer,
  opts: { target?: Size; scale?: 2 | 4; format?: OutputFormat; dpi?: number; quality?: number; engine?: UpscaleEngine; signal?: AbortSignal } = {},
): Promise<ProcessResult & { stages: string[] }> {
  const workDir = mkdtempSync(path.join(os.tmpdir(), "upscaler-pipe-"));
  const sourcePath = path.join(workDir, "source");
  writeFileSync(sourcePath, input);
  const engine = opts.engine ?? createFakeEngine();
  const probe = await probeImage(sourcePath, limits);
  const original = { width: probe.source.width, height: probe.source.height };
  const format = opts.format ?? "png";
  const { plan, errors } = planUpscale({
    original,
    target: opts.target ?? scaleSize(original, opts.scale ?? 2),
    format,
    dpi: opts.dpi ?? 300,
    hasAlpha: probe.source.hasAlpha,
    engine: engine.capabilities,
    limits,
  });
  if (!plan) throw new Error(errors.map((e) => e.code).join());
  const stages: string[] = [];
  const result = await processImage({
    workDir,
    sourcePath,
    probe,
    plan,
    format,
    quality: opts.quality ?? 90,
    dpi: opts.dpi ?? 300,
    engine,
    signal: opts.signal ?? new AbortController().signal,
    onStage: (s) => stages.push(s),
    onProgress: () => {},
  });
  return { ...result, stages };
}

describe("output dimensions", () => {
  it("×2 and ×4 produce exact pixel sizes", async () => {
    const src = await rgbImage(64, 36).png().toBuffer();
    const r2 = await run(src, { scale: 2 });
    expect(await sharp(r2.outputPath).metadata()).toMatchObject({ width: 128, height: 72 });
    const r4 = await run(src, { scale: 4 });
    expect(await sharp(r4.outputPath).metadata()).toMatchObject({ width: 256, height: 144 });
    expect(r2.stages).toEqual(["preparing", "upscaling", "encoding", "verifying"]);
  });

  it("custom sizes are resampled after the AI pass to the exact request", async () => {
    const src = await rgbImage(64, 36).png().toBuffer();
    const r = await run(src, { target: { width: 100, height: 56 } });
    expect(await sharp(r.outputPath).metadata()).toMatchObject({ width: 100, height: 56 });
    expect(r.stages).toContain("resampling");
  });

  it("×2 with a ×4-only model downsamples the ×4 result", async () => {
    const src = await rgbImage(40, 30).png().toBuffer();
    const calls: number[] = [];
    const engine = createFakeEngine({ nativeScales: [4], onCall: (req) => calls.push(req.scale) });
    const r = await run(src, { scale: 2, engine });
    expect(calls).toEqual([4]);
    expect(await sharp(r.outputPath).metadata()).toMatchObject({ width: 80, height: 60 });
  });

  it("unlocked aspect produces the requested (stretched) size, without cropping", async () => {
    const src = await rgbImage(40, 30).png().toBuffer();
    const r = await run(src, { target: { width: 160, height: 60 } });
    expect(await sharp(r.outputPath).metadata()).toMatchObject({ width: 160, height: 60 });
  });
});

describe("DPI metadata and formats", () => {
  it.each([
    ["png", "image/png", 300],
    ["png", "image/png", 72],
    ["jpeg", "image/jpeg", 300],
    ["jpeg", "image/jpeg", 600],
    ["tiff", "image/tiff", 300],
    ["tiff", "image/tiff", 150],
  ] as const)("%s stores %s native DPI %i", async (format, _mime, dpi) => {
    const r = await run(await rgbImage(32, 24).png().toBuffer(), { format, dpi });
    const meta = await sharp(r.outputPath).metadata();
    expect(meta.format).toBe(format);
    expect(meta.density).toBe(dpi);
    expect(r.dpiStorage).toBe("native");
  });

  it("webp stores DPI in EXIF", async () => {
    const r = await run(await rgbImage(32, 24).png().toBuffer(), { format: "webp", dpi: 96 });
    const meta = await sharp(r.outputPath).metadata();
    expect(meta.format).toBe("webp");
    expect(readExifResolution(meta.exif)).toEqual({ x: 96, y: 96 });
    expect(r.dpiStorage).toBe("exif");
  });

  it("writes both JFIF and EXIF density for JPEG", async () => {
    const r = await run(await rgbImage(32, 24).png().toBuffer(), { format: "jpeg", dpi: 300 });
    const raw = readFileSync(r.outputPath);
    // SOI, then APP0 "JFIF\0", version, units=1 (dpi), Xdensity, Ydensity
    expect(raw.toString("latin1", 6, 11)).toBe("JFIF\0");
    expect(raw[13]).toBe(1);
    expect(raw.readUInt16BE(14)).toBe(300);
    expect(raw.readUInt16BE(16)).toBe(300);
    expect(readExifResolution((await sharp(raw).metadata()).exif)).toEqual({ x: 300, y: 300 });
  });

  it("jpeg quality affects file size", async () => {
    const src = await rgbImage(128, 96).png().toBuffer();
    const low = await run(src, { format: "jpeg", quality: 30 });
    const high = await run(src, { format: "jpeg", quality: 95 });
    expect(low.bytes).toBeLessThan(high.bytes);
  });

  it("tiff gets a browser-displayable preview", async () => {
    const r = await run(await rgbImage(32, 24).png().toBuffer(), { format: "tiff" });
    expect(r.previewPath).not.toBe(r.outputPath);
    expect((await sharp(r.previewPath).metadata()).format).toBe("webp");
  });
});

describe("transparency", () => {
  it.each(["png", "webp", "tiff"] as const)("%s preserves alpha", async (format) => {
    const r = await run(await rgbaImage(32, 16).png().toBuffer(), { format });
    const meta = await sharp(r.outputPath).metadata();
    expect(meta.hasAlpha).toBe(true);
    const { data, info } = await sharp(r.outputPath).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(2, 2)).toBe(0); // transparent half stays transparent
    expect(alphaAt(info.width - 3, 2)).toBe(255);
    expect(r.alphaFlattened).toBe(false);
  });

  it("jpeg flattens transparency onto white and reports it", async () => {
    const r = await run(await rgbaImage(32, 16).png().toBuffer(), { format: "jpeg" });
    expect(r.alphaFlattened).toBe(true);
    const { data } = await sharp(r.outputPath).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245); // white where it was transparent
  });

  it("fully opaque alpha channels are not treated as transparency", async () => {
    const src = await rgbImage(32, 16).ensureAlpha(1).png().toBuffer();
    const r = await run(src, { format: "jpeg" });
    expect(r.alphaFlattened).toBe(false);
  });
});

describe("orientation and colour", () => {
  it("applies EXIF orientation before computing dimensions", async () => {
    // Stored landscape 40×20 with orientation 6 (rotate 90° CW) → displayed portrait 20×40.
    const src = await rgbImage(40, 20).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const workDir = mkdtempSync(path.join(os.tmpdir(), "upscaler-orient-"));
    writeFileSync(path.join(workDir, "s"), src);
    const probe = await probeImage(path.join(workDir, "s"), limits);
    expect(probe.source).toMatchObject({ width: 20, height: 40, orientation: 6 });

    const r = await run(src, { scale: 2 });
    const meta = await sharp(r.outputPath).metadata();
    expect(meta).toMatchObject({ width: 40, height: 80 });
    expect(meta.orientation ?? 1).toBe(1); // no double rotation by viewers
  });

  it("preserves an embedded RGB ICC profile and its pixel encoding", async () => {
    const src = await rgbImage(32, 16).withIccProfile("p3").png().toBuffer();
    const srcIcc = (await sharp(src).metadata()).icc!;
    for (const format of ["png", "jpeg", "webp", "tiff"] as const) {
      const r = await run(src, { format });
      expect((await sharp(r.outputPath).metadata()).icc?.equals(srcIcc), format).toBe(true);
    }
  });

  it("converts CMYK to sRGB", async () => {
    const src = await rgbImage(32, 16).withIccProfile("cmyk").jpeg().toBuffer();
    const r = await run(src, { format: "png" });
    const meta = await sharp(r.outputPath).metadata();
    expect(meta.space).toBe("srgb");
    expect(meta.channels).toBe(3);
  });

  it("handles 16-bit and greyscale sources", async () => {
    const grey = await rgbImage(32, 16).toColourspace("b-w").png().toBuffer();
    expect((await sharp((await run(grey)).outputPath).metadata()).width).toBe(64);
    const deep = await rgbImage(32, 16).toColourspace("rgb16").png().toBuffer();
    expect((await sharp((await run(deep)).outputPath).metadata()).width).toBe(64);
  });

  it("strips sensitive EXIF (e.g. GPS, camera) from the output", async () => {
    const src = await rgbImage(32, 16).withExif({ IFD0: { Make: "SecretCam", Model: "X1" } }).jpeg().toBuffer();
    const r = await run(src, { format: "jpeg" });
    const exif = (await sharp(r.outputPath).metadata()).exif;
    expect(exif?.toString("latin1") ?? "").not.toContain("SecretCam");
  });
});

describe("failures", () => {
  const src = () => rgbImage(32, 24).png().toBuffer();

  it("rejects unsupported and corrupted files", async () => {
    const workDir = mkdtempSync(path.join(os.tmpdir(), "upscaler-bad-"));
    const gif = path.join(workDir, "gif");
    writeFileSync(gif, Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"));
    await expect(probeImage(gif, limits)).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });

    const truncated = path.join(workDir, "trunc");
    writeFileSync(truncated, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]));
    await expect(probeImage(truncated, limits)).rejects.toMatchObject({ code: "INVALID_IMAGE" });

    const good = await rgbImage(64, 64).jpeg().toBuffer();
    // Header is readable, pixel data is not: fails at decode.
    await expect(run(good.subarray(0, Math.floor(good.length / 2)))).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects sources over the pixel limit", async () => {
    const workDir = mkdtempSync(path.join(os.tmpdir(), "upscaler-big-"));
    writeFileSync(path.join(workDir, "s"), await rgbImage(200, 200).png().toBuffer());
    await expect(probeImage(path.join(workDir, "s"), { ...limits, maxInputPixels: 10_000 })).rejects.toMatchObject({
      code: "INPUT_TOO_LARGE",
      status: 413,
    });
  });

  it("surfaces engine failures as user-facing errors", async () => {
    await expect(run(await src(), { engine: createFakeEngine({ behaviour: "fail" }) })).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
      message: "AI inference failed.",
    });
  });

  it("rejects engine output with the wrong dimensions (integrity check)", async () => {
    await expect(run(await src(), { engine: createFakeEngine({ behaviour: "wrong-size" }) })).rejects.toBeInstanceOf(PublicError);
  });

  it("aborts a hanging engine", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new PublicError("PROCESSING_TIMEOUT", "timeout", 504)), 100);
    await expect(run(await src(), { engine: createFakeEngine({ behaviour: "hang" }), signal: ac.signal })).rejects.toMatchObject({
      code: "PROCESSING_TIMEOUT",
    });
  });
});
