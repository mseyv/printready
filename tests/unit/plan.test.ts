import { describe, expect, it } from "vitest";
import { planUpscale, type EngineCapabilities, type PlanInput, type ProcessingLimits } from "@/lib/shared/plan";

const limits: ProcessingLimits = {
  maxUploadBytes: 25 * 1024 * 1024,
  maxInputPixels: 25_000_000,
  minOutputSide: 16,
  maxOutputSide: 16_384,
  maxOutputPixels: 64_000_000,
  maxAiOutputPixels: 100_000_000,
  minDpi: 1,
  maxDpi: 10_000,
};
const x4only: EngineCapabilities = {
  id: "t",
  label: "T",
  configured: true,
  nativeScales: [4],
  maxInputPixels: null,
  reportsProgress: false,
};
const both = { ...x4only, nativeScales: [2, 4] };

const base: PlanInput = {
  original: { width: 1920, height: 1080 },
  target: { width: 3840, height: 2160 },
  format: "png",
  dpi: 300,
  hasAlpha: false,
  engine: both,
  limits,
};
const codes = (r: ReturnType<typeof planUpscale>) => r.errors.map((e) => e.code);

describe("planUpscale", () => {
  it("uses the native ×2 model when available", () => {
    const r = planUpscale(base);
    expect(r.errors).toEqual([]);
    expect(r.plan).toMatchObject({ aiScale: 2, resampled: false, preset: 2, aspectPreserved: true });
  });

  it("runs ×4 then downsamples when the model is ×4 only", () => {
    const r = planUpscale({ ...base, engine: x4only });
    expect(r.plan).toMatchObject({ aiScale: 4, aiOutput: { width: 7680, height: 4320 }, resampled: true, preset: 2 });
  });

  it("picks the smallest native scale covering a custom size", () => {
    const r = planUpscale({ ...base, target: { width: 5000, height: 2813 } });
    expect(r.plan).toMatchObject({ aiScale: 4, resampled: true, preset: null });
  });

  it("rejects sizes beyond the largest native scale", () => {
    expect(codes(planUpscale({ ...base, target: { width: 8000, height: 4500 } }))).toContain("SCALE_TOO_LARGE");
  });

  it("rejects downscales", () => {
    expect(codes(planUpscale({ ...base, target: { width: 1000, height: 563 } }))).toContain("NOT_AN_UPSCALE");
  });

  it("enforces output limits", () => {
    expect(codes(planUpscale({ ...base, target: { width: 10, height: 10 } }))).toContain("OUTPUT_TOO_SMALL");
    expect(codes(planUpscale({ ...base, target: { width: 20_000, height: 2160 } }))).toContain("OUTPUT_SIDE_TOO_LARGE");
    expect(
      codes(planUpscale({ ...base, original: { width: 3000, height: 3000 }, target: { width: 12_000, height: 12_000 } })),
    ).toContain("OUTPUT_PIXELS_TOO_LARGE");
    expect(codes(planUpscale({ ...base, target: { width: 3840.5, height: 2160 } }))).toContain("OUTPUT_TOO_SMALL");
  });

  it("enforces the AI intermediate limit", () => {
    const r = planUpscale({
      ...base,
      engine: x4only,
      original: { width: 4000, height: 3000 },
      target: { width: 6000, height: 4500 },
      limits: { ...limits, maxAiOutputPixels: 100_000_000 },
    });
    expect(codes(r)).toEqual(["AI_PASS_TOO_LARGE"]);
  });

  it("enforces the WebP side limit", () => {
    const r = planUpscale({ ...base, format: "webp", original: { width: 5000, height: 1000 }, target: { width: 20_000, height: 4000 }, limits: { ...limits, maxOutputSide: 30_000, maxOutputPixels: 100_000_000 } });
    expect(codes(r)).toContain("FORMAT_SIDE_LIMIT");
  });

  it("validates DPI", () => {
    expect(codes(planUpscale({ ...base, dpi: 0 }))).toContain("INVALID_DPI");
    expect(codes(planUpscale({ ...base, dpi: 72.5 }))).toContain("INVALID_DPI");
    expect(codes(planUpscale({ ...base, dpi: 20_000 }))).toContain("INVALID_DPI");
  });

  it("reports an unconfigured engine", () => {
    const r = planUpscale({ ...base, engine: { ...both, configured: false, nativeScales: [] } });
    expect(codes(r)).toContain("ENGINE_NOT_CONFIGURED");
  });

  it("respects engine input limits", () => {
    const r = planUpscale({ ...base, engine: { ...both, maxInputPixels: 1_000_000 } });
    expect(codes(r)).toContain("ENGINE_INPUT_TOO_LARGE");
  });

  it("warns about distortion, alpha flattening and EXIF-only DPI", () => {
    const w = planUpscale({ ...base, target: { width: 3840, height: 1080 } }).warnings.map((x) => x.code);
    expect(w).toContain("ASPECT_CHANGED");
    expect(planUpscale({ ...base, format: "jpeg", hasAlpha: true }).warnings.map((x) => x.code)).toContain("ALPHA_FLATTENED");
    expect(planUpscale({ ...base, format: "webp" }).warnings.map((x) => x.code)).toContain("DPI_EXIF_ONLY");
    expect(planUpscale(base).warnings).toEqual([]);
  });
});
