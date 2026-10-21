/**
 * Image pipeline: probe → normalise → AI pass → resample/alpha → encode → verify.
 *
 * Inference is delegated to an `UpscaleEngine`; everything that affects file
 * semantics (orientation, colour profile, transparency, exact pixel size, DPI)
 * happens here with sharp/libvips, so every engine produces identical output.
 */
import { open, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { orientedSize, type Size } from "@/lib/shared/dimensions";
import { OUTPUT_FORMAT_INFO, SNIFF_BYTES, sniffImageFormat, type OutputFormat } from "@/lib/shared/formats";
import type { ProcessingLimits, UpscalePlan } from "@/lib/shared/plan";
import type { JobStage, SourceInfo } from "@/lib/shared/schema";
import { PublicError } from "./errors";
import { readExifResolution, readJfifDensity, setPngIccProfile, withJfifDensity } from "./metadata";
import type { UpscaleEngine } from "./engines/types";
import { EngineError } from "./engines/types";

sharp.cache(false);

export interface ProbeResult {
  source: SourceInfo;
  /** ICC profile to carry through to the output (only for RGB sources). */
  icc: Buffer | null;
  multiPage: boolean;
}

/** Validate signature + decodability and read oriented dimensions. Does not decode pixels. */
export async function probeImage(file: string, limits: ProcessingLimits): Promise<ProbeResult> {
  const head = Buffer.alloc(SNIFF_BYTES);
  const fh = await open(file, "r");
  let bytes: number;
  try {
    await fh.read(head, 0, SNIFF_BYTES, 0);
    bytes = (await fh.stat()).size;
  } finally {
    await fh.close();
  }

  const format = sniffImageFormat(head);
  if (!format) {
    throw new PublicError("UNSUPPORTED_FORMAT", "Unsupported file type. Upload a JPEG, PNG, WebP or TIFF image.", 415);
  }

  let meta: Metadata;
  try {
    meta = await sharp(file, { limitInputPixels: false }).metadata();
  } catch {
    throw new PublicError("INVALID_IMAGE", "The image could not be read. It may be corrupted or truncated.", 422);
  }
  if (meta.format !== format) {
    throw new PublicError("INVALID_IMAGE", "The file contents do not match a supported image format.", 422);
  }
  if (!meta.width || !meta.height) {
    throw new PublicError("INVALID_IMAGE", "The image has no readable dimensions.", 422);
  }

  const orientation = meta.orientation ?? 1;
  const size = orientedSize({ width: meta.width, height: meta.height }, orientation);
  if (size.width * size.height > limits.maxInputPixels) {
    throw new PublicError(
      "INPUT_TOO_LARGE",
      `The image is ${size.width.toLocaleString("en-US")} × ${size.height.toLocaleString("en-US")} px; sources are limited to ${limits.maxInputPixels.toLocaleString("en-US")} pixels.`,
      413,
    );
  }

  const isRgb = meta.space === "srgb" || meta.space === "rgb16" || meta.space === "rgb";
  const icc = meta.icc && isRgb ? meta.icc : null;
  const colorProfile: SourceInfo["colorProfile"] = icc
    ? "preserved"
    : meta.icc || meta.space === "cmyk"
      ? "converted-to-srgb"
      : "none";

  return {
    source: {
      format,
      bytes,
      width: size.width,
      height: size.height,
      hasAlpha: Boolean(meta.hasAlpha),
      orientation,
      colorProfile,
    },
    icc,
    multiPage: (meta.pages ?? 1) > 1,
  };
}

export interface ProcessOptions {
  workDir: string;
  sourcePath: string;
  probe: ProbeResult;
  plan: UpscalePlan;
  format: OutputFormat;
  quality: number;
  dpi: number;
  engine: UpscaleEngine;
  signal: AbortSignal;
  onStage: (stage: JobStage) => void;
  onProgress: (fraction: number) => void;
}

export interface ProcessResult {
  outputPath: string;
  /** Browser-displayable rendition (the output itself unless the format can't be shown). */
  previewPath: string;
  width: number;
  height: number;
  bytes: number;
  dpi: number;
  dpiStorage: "native" | "exif";
  alphaFlattened: boolean;
}

export async function processImage(o: ProcessOptions): Promise<ProcessResult> {
  const p = (name: string) => path.join(o.workDir, name);
  const { plan, probe } = o;

  // 1. Decode once: apply EXIF orientation, normalise to 8-bit RGB(A). With a kept ICC
  //    profile pixel values stay in the source colour space; otherwise libvips converts
  //    to sRGB (CMYK, greyscale-with-profile).
  o.onStage("preparing");
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    let img = sharp(o.sourcePath, { limitInputPixels: false, failOn: "error", page: 0 }).autoOrient();
    if (probe.icc) img = img.keepIccProfile();
    decoded = await img.toColourspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new PublicError("INVALID_IMAGE", "The image data is corrupted and could not be decoded.", 422);
  }
  const { data, info } = decoded;
  const src: Size = { width: info.width, height: info.height };
  if (src.width !== probe.source.width || src.height !== probe.source.height) {
    throw new Error(`decoded size ${src.width}x${src.height} differs from probe`);
  }

  const raw = { width: info.width, height: info.height, channels: info.channels };
  const hasAlpha = info.channels === 4 && !isOpaque(data, 4);
  await sharp(data, { raw }).removeAlpha().png({ compressionLevel: 1 }).toFile(p("rgb.png"));
  if (hasAlpha) {
    await sharp(data, { raw }).extractChannel(3).png({ compressionLevel: 1 }).toFile(p("alpha.png"));
  }
  o.signal.throwIfAborted();

  // 2. AI inference at the model's native scale, then verify its output size.
  o.onStage("upscaling");
  try {
    await o.engine.upscale({
      inputPath: p("rgb.png"),
      outputPath: p("ai.png"),
      scale: plan.aiScale,
      signal: o.signal,
      onProgress: o.onProgress,
    });
  } catch (err) {
    if (o.signal.aborted) throw o.signal.reason;
    if (err instanceof EngineError) throw new PublicError(err.code, err.message, 502);
    throw err;
  }
  o.signal.throwIfAborted();

  let aiMeta: Metadata;
  try {
    aiMeta = await sharp(p("ai.png"), { limitInputPixels: false }).metadata();
  } catch {
    throw new PublicError("INFERENCE_FAILED", "The AI engine returned an unreadable image.", 502);
  }
  if (aiMeta.width !== plan.aiOutput.width || aiMeta.height !== plan.aiOutput.height) {
    console.error(`[printready] engine returned ${aiMeta.width}x${aiMeta.height}, expected ${plan.aiOutput.width}x${plan.aiOutput.height}`);
    throw new PublicError("INFERENCE_FAILED", "The AI engine returned an image with unexpected dimensions.", 502);
  }

  // 3. Resample to the exact requested size (Lanczos) and re-attach alpha.
  const { width, height } = plan.target;
  let stage = p("ai.png");
  if (plan.resampled) {
    o.onStage("resampling");
    await sharp(stage, { limitInputPixels: false })
      .removeAlpha()
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png({ compressionLevel: 1 })
      .toFile(p("resized.png"));
    stage = p("resized.png");
  }
  if (hasAlpha) {
    // Alpha is a mask, not image content: Lanczos upscaling keeps edges clean without AI artefacts.
    const alpha = await sharp(p("alpha.png"), { limitInputPixels: false })
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .png({ compressionLevel: 1 })
      .toBuffer();
    // Stage is RGB by the engine contract (and verified above); removeAlpha() here would run after joinChannel.
    await sharp(stage, { limitInputPixels: false })
      .joinChannel(alpha)
      .png({ compressionLevel: 1 })
      .toFile(p("stage.png"));
    stage = p("stage.png");
  }
  if (probe.icc) await setPngIccProfile(stage, probe.icc);
  o.signal.throwIfAborted();

  // 4. Encode with DPI metadata.
  o.onStage("encoding");
  const info2 = OUTPUT_FORMAT_INFO[o.format];
  const outputPath = p(`output.${info2.extension}`);
  const alphaFlattened = hasAlpha && !info2.alpha;
  let enc = sharp(stage, { limitInputPixels: false });
  if (probe.icc) enc = enc.keepIccProfile();
  if (alphaFlattened) enc = enc.flatten({ background: "#ffffff" });
  switch (o.format) {
    case "png":
      enc = enc.withDensity(o.dpi).png({ compressionLevel: 6 });
      break;
    case "jpeg":
      enc = enc
        .withDensity(o.dpi)
        .jpeg({ quality: o.quality, chromaSubsampling: o.quality >= 90 ? "4:4:4" : "4:2:0", mozjpeg: true });
      break;
    case "webp":
      enc = enc.withDensity(o.dpi).webp({ quality: o.quality, alphaQuality: 100, effort: 4 });
      break;
    case "tiff":
      // withDensity() drops alpha for TIFF in libvips; set resolution via TIFF options instead.
      enc = enc.tiff({ compression: "lzw", predictor: "horizontal", xres: o.dpi / 25.4, yres: o.dpi / 25.4, resolutionUnit: "inch" });
      break;
  }
  if (o.format === "jpeg") {
    await writeFile(outputPath, withJfifDensity(await enc.toBuffer(), o.dpi));
  } else {
    await enc.toFile(outputPath);
  }
  o.signal.throwIfAborted();

  // 5. Read the written file back and verify what we promise the user.
  o.onStage("verifying");
  const out = await sharp(outputPath, { limitInputPixels: false }).metadata();
  const problems: string[] = [];
  if (out.width !== width || out.height !== height) problems.push(`size ${out.width}x${out.height}`);
  if (hasAlpha && info2.alpha && !out.hasAlpha) problems.push("alpha lost");
  let writtenDpi: number | undefined;
  if (info2.dpi === "native") writtenDpi = out.density;
  else writtenDpi = readExifResolution(out.exif)?.x;
  if (writtenDpi === undefined || Math.abs(writtenDpi - o.dpi) > 0.5) problems.push(`dpi ${writtenDpi}`);
  if (o.format === "jpeg") {
    const head = Buffer.alloc(20);
    const fh = await open(outputPath, "r");
    await fh.read(head, 0, 20, 0).finally(() => fh.close());
    if (readJfifDensity(head) !== o.dpi) problems.push("jfif density");
  }
  if (probe.icc && !out.icc) problems.push("icc lost");
  if (problems.length) {
    console.error("[printready] output verification failed:", problems.join(", "));
    throw new PublicError("OUTPUT_VERIFICATION_FAILED", "The output file failed verification and was discarded.", 500);
  }

  let previewPath = outputPath;
  if (!info2.browserPreview) {
    previewPath = p("preview.webp");
    await sharp(outputPath, { limitInputPixels: false })
      .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toFile(previewPath);
  }

  return {
    outputPath,
    previewPath,
    width,
    height,
    bytes: (await stat(outputPath)).size,
    dpi: o.dpi,
    dpiStorage: info2.dpi,
    alphaFlattened,
  };
}

function isOpaque(data: Buffer, channels: number): boolean {
  for (let i = channels - 1; i < data.length; i += channels) if (data[i] !== 255) return false;
  return true;
}

/** Small JPEG preview for sources browsers cannot display (TIFF). */
export async function renderInspectPreview(file: string): Promise<string> {
  const buf = await sharp(file, { limitInputPixels: false, page: 0 })
    .autoOrient()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

export async function writeUpload(file: string, data: Uint8Array) {
  await writeFile(file, data, { mode: 0o600, flag: "wx" });
}
