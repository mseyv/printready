import type { UpscaleFactor } from "./dimensions";
import { OUTPUT_FORMAT_INFO, type OutputFormat } from "./formats";

/** Reduce an arbitrary user filename to a safe, readable stem. */
export function safeStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "");
  const cleaned = stem
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);
  return cleaned || "image";
}

/** e.g. `holiday_upscaled-2x_3840x2160_300dpi.png` */
export function buildOutputFilename(opts: {
  originalName: string;
  preset: UpscaleFactor | null;
  width: number;
  height: number;
  dpi: number;
  format: OutputFormat;
}): string {
  const tag = opts.preset ? `${opts.preset}x` : "custom";
  const ext = OUTPUT_FORMAT_INFO[opts.format].extension;
  return `${safeStem(opts.originalName)}_upscaled-${tag}_${opts.width}x${opts.height}_${opts.dpi}dpi.${ext}`;
}
