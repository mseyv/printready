import { describe, expect, it } from "vitest";
import {
  applyDimensionEdit,
  effectiveScale,
  formatAspectRatio,
  formatNumber,
  formatPixelCount,
  heightForWidth,
  matchPreset,
  orientedSize,
  pixelCount,
  preservesAspectRatio,
  printSize,
  scaleSize,
  widthForHeight,
} from "@/lib/shared/dimensions";

const FHD = { width: 1920, height: 1080 };

describe("preset scaling", () => {
  it("×2 doubles both axes (4× the pixels)", () => {
    expect(scaleSize(FHD, 2)).toEqual({ width: 3840, height: 2160 });
    expect(pixelCount(scaleSize(FHD, 2))).toBe(pixelCount(FHD) * 4);
  });

  it("×4 quadruples both axes (16× the pixels)", () => {
    expect(scaleSize(FHD, 4)).toEqual({ width: 7680, height: 4320 });
    expect(pixelCount(scaleSize(FHD, 4))).toBe(pixelCount(FHD) * 16);
  });

  it("recognises presets and custom sizes", () => {
    expect(matchPreset(FHD, { width: 3840, height: 2160 })).toBe(2);
    expect(matchPreset(FHD, { width: 7680, height: 4320 })).toBe(4);
    expect(matchPreset(FHD, { width: 3000, height: 1688 })).toBeNull();
    expect(matchPreset(FHD, { width: 3840, height: 2161 })).toBeNull();
  });

  it("reports per-axis effective scale", () => {
    expect(effectiveScale(FHD, { width: 2880, height: 2160 })).toEqual({ x: 1.5, y: 2 });
  });
});

describe("aspect ratio lock", () => {
  it("locked width edit recomputes height", () => {
    expect(applyDimensionEdit(FHD, { width: 3840, height: 2160 }, { axis: "width", value: 3000 }, true)).toEqual({
      width: 3000,
      height: 1688, // 1687.5 rounds half up
    });
  });

  it("locked height edit recomputes width", () => {
    expect(applyDimensionEdit(FHD, { width: 3840, height: 2160 }, { axis: "height", value: 1000 }, true)).toEqual({
      width: 1778,
      height: 1000,
    });
  });

  it("unlocked edits change only one axis", () => {
    const current = { width: 3840, height: 2160 };
    expect(applyDimensionEdit(FHD, current, { axis: "width", value: 5000 }, false)).toEqual({ width: 5000, height: 2160 });
    expect(applyDimensionEdit(FHD, current, { axis: "height", value: 100 }, false)).toEqual({ width: 3840, height: 100 });
  });

  it("uses the original ratio, not the current (possibly distorted) one", () => {
    const distorted = { width: 4000, height: 1000 };
    expect(applyDimensionEdit(FHD, distorted, { axis: "width", value: 1920 }, true)).toEqual(FHD);
  });

  it("never produces a zero dimension", () => {
    expect(heightForWidth({ width: 10_000, height: 10 }, 1)).toBe(1);
    expect(widthForHeight({ width: 10, height: 10_000 }, 1)).toBe(1);
  });

  it("accepts ±1 px rounding as aspect-preserving", () => {
    expect(preservesAspectRatio(FHD, { width: 3000, height: 1688 })).toBe(true);
    expect(preservesAspectRatio(FHD, { width: 3000, height: 1687 })).toBe(true);
    expect(preservesAspectRatio(FHD, { width: 3000, height: 1690 })).toBe(false);
    // Odd sizes: 333×111 (3:1) → 1000×333 rounds both ways
    expect(preservesAspectRatio({ width: 333, height: 111 }, { width: 1000, height: 333 })).toBe(true);
  });
});

describe("display helpers", () => {
  it("formats aspect ratios", () => {
    expect(formatAspectRatio(FHD)).toBe("16:9");
    expect(formatAspectRatio({ width: 4000, height: 3000 })).toBe("4:3");
    expect(formatAspectRatio({ width: 1000, height: 1000 })).toBe("1:1");
    expect(formatAspectRatio({ width: 3000, height: 1688 })).toBe("≈ 16:9");
    expect(formatAspectRatio({ width: 1000, height: 617 })).toBe("1.62:1");
    expect(formatAspectRatio({ width: 617, height: 1000 })).toBe("1:1.62");
  });

  it("formats pixel counts", () => {
    expect(formatPixelCount({ width: 3840, height: 2160 })).toBe("8,294,400 px (8.29 MP)");
    expect(formatPixelCount({ width: 7680, height: 4320 })).toBe("33,177,600 px (33.2 MP)");
  });

  it("swaps dimensions for rotated EXIF orientations", () => {
    expect(orientedSize({ width: 40, height: 20 }, 6)).toEqual({ width: 20, height: 40 });
    expect(orientedSize({ width: 40, height: 20 }, 3)).toEqual({ width: 40, height: 20 });
    expect(orientedSize({ width: 40, height: 20 }, undefined)).toEqual({ width: 40, height: 20 });
  });
});

describe("print size", () => {
  it("matches the specification example (3840 × 2160 @ 300 DPI)", () => {
    const p = printSize({ width: 3840, height: 2160 }, 300);
    expect(p.widthIn).toBeCloseTo(12.8, 10);
    expect(p.heightIn).toBeCloseTo(7.2, 10);
    expect(formatNumber(p.widthCm)).toBe("32.51");
    expect(formatNumber(p.heightCm)).toBe("18.29");
  });

  it("is inversely proportional to DPI and independent of pixels added", () => {
    const at72 = printSize(FHD, 72);
    const at144 = printSize(FHD, 144);
    expect(at72.widthIn).toBeCloseTo(at144.widthIn * 2, 10);
    expect(formatNumber(printSize(FHD, 96).widthIn)).toBe("20");
  });
});
