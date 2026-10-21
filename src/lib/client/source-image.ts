import { INPUT_FORMAT_LABEL, sniffImageFormat, type InputFormat } from "@/lib/shared/formats";
import type { InspectResponse, PublicConfig } from "@/lib/shared/schema";
import { ApiError, inspectImage } from "./api";

export interface SourceImage {
  file: File;
  name: string;
  bytes: number;
  format: InputFormat;
  /** Oriented (as displayed) pixel dimensions. */
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Object URL (or server-rendered preview for TIFF) used for display only. */
  previewUrl: string;
  /** True when previewUrl is an object URL that must be revoked. */
  ownsUrl: boolean;
}

export class SourceError extends Error {}

const HEAD_BYTES = 64 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/**
 * Validate and inspect a user-selected file without uploading it (except TIFF, which
 * browsers cannot decode — it is inspected by the server and immediately discarded).
 * Only the first 64 KB are read into memory; the browser decodes the image itself
 * via an object URL.
 */
export async function loadSourceImage(file: File, config: PublicConfig): Promise<SourceImage> {
  const { limits } = config;
  if (file.size === 0) throw new SourceError("The file is empty.");
  if (file.size > limits.maxUploadBytes) {
    throw new SourceError(
      `The file is ${formatBytes(file.size)}; the maximum upload size is ${formatBytes(limits.maxUploadBytes)}.`,
    );
  }

  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const format = sniffImageFormat(head);
  if (!format) {
    throw new SourceError("Unsupported file type. Choose a JPEG, PNG, WebP or TIFF image.");
  }

  let width: number;
  let height: number;
  let hasAlpha: boolean;
  let previewUrl: string;
  let ownsUrl = false;

  if (format === "tiff") {
    let info: InspectResponse;
    try {
      info = await inspectImage(file);
    } catch (err) {
      throw new SourceError(err instanceof ApiError ? err.message : "The TIFF file could not be inspected.");
    }
    ({ width, height, hasAlpha } = info.source);
    previewUrl = info.preview;
  } else {
    previewUrl = URL.createObjectURL(file);
    ownsUrl = true;
    try {
      // naturalWidth/Height respect EXIF orientation (CSS image-orientation: from-image).
      ({ width, height } = await decodeSize(previewUrl));
    } catch {
      URL.revokeObjectURL(previewUrl);
      throw new SourceError(`The ${INPUT_FORMAT_LABEL[format]} file could not be read. It may be corrupted.`);
    }
    hasAlpha = detectAlpha(head, format);
  }

  if (width * height > limits.maxInputPixels) {
    if (ownsUrl) URL.revokeObjectURL(previewUrl);
    throw new SourceError(
      `The image is ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} px. Sources are limited to ${(limits.maxInputPixels / 1e6).toFixed(0)} megapixels.`,
    );
  }

  return { file, name: file.name || "pasted-image", bytes: file.size, format, width, height, hasAlpha, previewUrl, ownsUrl };
}

function decodeSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () =>
      img.naturalWidth > 0 ? resolve({ width: img.naturalWidth, height: img.naturalHeight }) : reject(new Error("empty"));
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });
}

/** Best-effort transparency detection from file headers (used for UI warnings only). */
export function detectAlpha(head: Uint8Array, format: InputFormat): boolean {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...head.subarray(o, o + n));
  if (format === "png" && head.length > 26) {
    const colorType = head[25];
    if (colorType === 4 || colorType === 6) return true;
    // Palette/greyscale/RGB with a tRNS chunk before the image data.
    let pos = 8;
    while (pos + 8 <= head.length) {
      const len = view.getUint32(pos);
      const type = ascii(pos + 4, 4);
      if (type === "tRNS") return true;
      if (type === "IDAT") return false;
      pos += 12 + len;
    }
    return false;
  }
  if (format === "webp" && head.length > 30) {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return (head[20] & 0x10) !== 0;
    if (chunk === "VP8L") return ((view.getUint32(21, true) >>> 28) & 1) === 1;
  }
  return false;
}
