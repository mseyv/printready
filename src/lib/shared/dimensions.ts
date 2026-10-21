/**
 * Pure dimension, aspect-ratio and print-size math.
 * Used by the UI for live feedback and by the server for authoritative validation.
 */

export interface Size {
  width: number;
  height: number;
}

export const UPSCALE_FACTORS = [2, 4] as const;
export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number];
export const DEFAULT_FACTOR: UpscaleFactor = 2;

export const CM_PER_INCH = 2.54;

/** Output size for a preset factor. Factors apply to both axes (×2 → 4× the pixels). */
export function scaleSize(original: Size, factor: number): Size {
  return { width: original.width * factor, height: original.height * factor };
}

/** Height that keeps `original`'s aspect ratio for a given width (never below 1 px). */
export function heightForWidth(original: Size, width: number): number {
  return Math.max(1, Math.round((width * original.height) / original.width));
}

/** Width that keeps `original`'s aspect ratio for a given height (never below 1 px). */
export function widthForHeight(original: Size, height: number): number {
  return Math.max(1, Math.round((height * original.width) / original.height));
}

/**
 * Apply an edit to one dimension. When `locked`, the other dimension follows the
 * original aspect ratio; otherwise it is left untouched.
 */
export function applyDimensionEdit(
  original: Size,
  current: Size,
  edit: { axis: "width" | "height"; value: number },
  locked: boolean,
): Size {
  if (edit.axis === "width") {
    return {
      width: edit.value,
      height: locked ? heightForWidth(original, edit.value) : current.height,
    };
  }
  return {
    width: locked ? widthForHeight(original, edit.value) : current.width,
    height: edit.value,
  };
}

/**
 * Whether `target` has the same aspect ratio as `original`, allowing for the
 * ±1 px rounding that integer pixel dimensions force on us.
 */
export function preservesAspectRatio(original: Size, target: Size): boolean {
  return (
    Math.abs(target.height - heightForWidth(original, target.width)) <= 1 ||
    Math.abs(target.width - widthForHeight(original, target.height)) <= 1
  );
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

const COMMON_RATIOS: Array<[number, number]> = [
  [1, 1], [5, 4], [4, 3], [3, 2], [16, 10], [16, 9], [2, 1], [21, 9], [3, 1],
];

/**
 * Human-readable aspect ratio: an exact reduced ratio when it is small (e.g. "16:9"),
 * otherwise a nearby common ratio ("≈ 3:2") or a decimal ("1.62:1").
 */
export function formatAspectRatio({ width, height }: Size): string {
  if (width <= 0 || height <= 0) return "—";
  const d = gcd(width, height);
  const rw = width / d;
  const rh = height / d;
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;

  const value = width / height;
  for (const [a, b] of COMMON_RATIOS) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (Math.abs(value - x / y) / (x / y) < 0.005) return `≈ ${x}:${y}`;
    }
  }
  return value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`;
}

export function pixelCount({ width, height }: Size): number {
  return width * height;
}

/** "8,294,400 px (8.3 MP)" */
export function formatPixelCount(size: Size): string {
  const count = pixelCount(size);
  const mp = count / 1_000_000;
  const mpText = mp >= 10 ? mp.toFixed(1) : mp >= 0.1 ? mp.toFixed(2) : mp.toFixed(3);
  return `${count.toLocaleString("en-US")} px (${mpText.replace(/\.?0+$/, "")} MP)`;
}

export interface PrintSize {
  widthIn: number;
  heightIn: number;
  widthCm: number;
  heightCm: number;
}

/**
 * Nominal print size. DPI is metadata only: it does not add pixels, it just tells
 * printing software how many pixels to place per inch.
 */
export function printSize({ width, height }: Size, dpi: number): PrintSize {
  const widthIn = width / dpi;
  const heightIn = height / dpi;
  return {
    widthIn,
    heightIn,
    widthCm: widthIn * CM_PER_INCH,
    heightCm: heightIn * CM_PER_INCH,
  };
}

/** Round to at most `digits` decimals, without trailing zeros: 12.80 → "12.8". */
export function formatNumber(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

/** Which preset (if any) the requested output corresponds to. */
export function matchPreset(original: Size, target: Size): UpscaleFactor | null {
  for (const factor of UPSCALE_FACTORS) {
    const s = scaleSize(original, factor);
    if (s.width === target.width && s.height === target.height) return factor;
  }
  return null;
}

/** Per-axis scale of target relative to original. */
export function effectiveScale(original: Size, target: Size): { x: number; y: number } {
  return { x: target.width / original.width, y: target.height / original.height };
}

export function formatScale(value: number): string {
  return `×${formatNumber(value, 2)}`;
}

/** Swap width/height for EXIF orientations 5–8 (rotated 90°/270°). */
export function orientedSize(size: Size, orientation: number | undefined): Size {
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: size.height, height: size.width }
    : size;
}
