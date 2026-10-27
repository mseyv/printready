/**
 * Upscale planning and validation. The same function runs in the browser (live
 * feedback) and on the server (authoritative check before a job is queued).
 */
import {
  type Size,
  type UpscaleFactor,
  effectiveScale,
  formatScale,
  matchPreset,
  pixelCount,
  preservesAspectRatio,
  scaleSize,
} from "./dimensions";
import { OUTPUT_FORMAT_INFO, type OutputFormat } from "./formats";
import { FACE_ENHANCER_LABEL, MODEL_INFO, type EngineModel, type EnhanceOptions, type FaceEnhancer, type ModelId } from "./models";

export interface ProcessingLimits {
  maxUploadBytes: number;
  maxInputPixels: number;
  minOutputSide: number;
  maxOutputSide: number;
  maxOutputPixels: number;
  /** Cap on the raw AI pass result (may exceed the final size when downsampling after a ×4 model). */
  maxAiOutputPixels: number;
  minDpi: number;
  maxDpi: number;
}

export interface EngineCapabilities {
  id: string;
  label: string;
  configured: boolean;
  /** Human-readable reason when not configured. */
  reason?: string;
  /** Models the engine knows about; unavailable ones carry a reason. */
  models: EngineModel[];
  defaultModel: ModelId;
  /** Face restoration models the engine can apply (empty: none). */
  faceEnhancers: FaceEnhancer[];
  /** Whether the engine accepts a per-request tile size. */
  tiling: boolean;
  /** Largest source the engine accepts, if it has its own limit. */
  maxInputPixels: number | null;
  /** Whether the engine reports real progress (otherwise the UI stays indeterminate). */
  reportsProgress: boolean;
}

export type IssueField = "image" | "width" | "height" | "dpi" | "format" | "engine" | "model" | "faceEnhance" | "tileSize";

export interface Issue {
  code: string;
  message: string;
  field?: IssueField;
}

export interface UpscalePlan {
  target: Size;
  /** The native model scale used for the AI pass. */
  aiScale: number;
  /** Pixel size right after the AI pass. */
  aiOutput: Size;
  /** Whether a Lanczos resample follows the AI pass to hit the exact target. */
  resampled: boolean;
  /** The preset that exactly matches the target, if any. */
  preset: UpscaleFactor | null;
  aspectPreserved: boolean;
  scale: { x: number; y: number };
}

export interface PlanInput {
  original: Size;
  target: Size;
  format: OutputFormat;
  dpi: number;
  hasAlpha: boolean;
  options: EnhanceOptions;
  engine: EngineCapabilities;
  limits: ProcessingLimits;
}

export interface PlanResult {
  plan: UpscalePlan | null;
  errors: Issue[];
  warnings: Issue[];
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function planUpscale(input: PlanInput): PlanResult {
  const { original, target, format, dpi, hasAlpha, options, engine, limits } = input;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const formatInfo = OUTPUT_FORMAT_INFO[format];

  for (const axis of ["width", "height"] as const) {
    const v = target[axis];
    if (!Number.isInteger(v) || v < limits.minOutputSide) {
      errors.push({
        code: "OUTPUT_TOO_SMALL",
        field: axis,
        message: `Output ${axis} must be a whole number of at least ${fmt(limits.minOutputSide)} px.`,
      });
    } else if (v > limits.maxOutputSide) {
      errors.push({
        code: "OUTPUT_SIDE_TOO_LARGE",
        field: axis,
        message: `Output ${axis} exceeds the ${fmt(limits.maxOutputSide)} px limit.`,
      });
    } else if (v > formatInfo.maxSide) {
      errors.push({
        code: "FORMAT_SIDE_LIMIT",
        field: axis,
        message: `${formatInfo.label} supports at most ${fmt(formatInfo.maxSide)} px per side. Choose PNG or TIFF for this size.`,
      });
    }
  }

  // JFIF stores density as a 16-bit value.
  const maxDpi = Math.min(limits.maxDpi, 65_535);
  if (!Number.isInteger(dpi) || dpi < limits.minDpi || dpi > maxDpi) {
    errors.push({
      code: "INVALID_DPI",
      field: "dpi",
      message: `DPI must be a whole number between ${fmt(limits.minDpi)} and ${fmt(maxDpi)}.`,
    });
  }

  if (pixelCount(original) > limits.maxInputPixels) {
    errors.push({
      code: "INPUT_TOO_LARGE",
      field: "image",
      message: `The source image has ${fmt(pixelCount(original))} pixels; the limit is ${fmt(limits.maxInputPixels)}.`,
    });
  }

  if (errors.length > 0) return { plan: null, errors, warnings };

  if (pixelCount(target) > limits.maxOutputPixels) {
    errors.push({
      code: "OUTPUT_PIXELS_TOO_LARGE",
      field: "width",
      message: `Output would have ${fmt(pixelCount(target))} pixels; the limit is ${fmt(limits.maxOutputPixels)}.`,
    });
  }

  if (!engine.configured) {
    errors.push({
      code: "ENGINE_NOT_CONFIGURED",
      field: "engine",
      message: engine.reason ?? "AI upscaling is not configured on this server.",
    });
  }
  if (engine.maxInputPixels !== null && pixelCount(original) > engine.maxInputPixels) {
    errors.push({
      code: "ENGINE_INPUT_TOO_LARGE",
      field: "image",
      message: `${engine.label} accepts sources up to ${fmt(engine.maxInputPixels)} pixels.`,
    });
  }

  const model = engine.models.find((m) => m.id === options.model);
  if (engine.configured && !model?.available) {
    errors.push({
      code: "MODEL_UNAVAILABLE",
      field: "model",
      message: model?.reason ?? `${MODEL_INFO[options.model].label} is not available on this server.`,
    });
  }
  if (engine.configured && options.faceEnhance && !engine.faceEnhancers.includes(options.faceEnhance)) {
    errors.push({
      code: "FACE_ENHANCER_UNAVAILABLE",
      field: "faceEnhance",
      message: `${FACE_ENHANCER_LABEL[options.faceEnhance]} face enhancement is not available on this server.`,
    });
  }
  if (engine.configured && options.tileSize !== null && !engine.tiling) {
    errors.push({
      code: "TILING_UNSUPPORTED",
      field: "tileSize",
      message: `${engine.label} does not support a custom tile size.`,
    });
  }

  const scale = effectiveScale(original, target);
  const required = Math.max(scale.x, scale.y);
  if (scale.x < 1 && scale.y < 1) {
    errors.push({
      code: "NOT_AN_UPSCALE",
      field: "width",
      message: "The output is smaller than the original. Choose dimensions at least as large as the source.",
    });
  }

  const nativeScales = model?.nativeScales ?? [];
  const maxNative = nativeScales.at(-1) ?? 0;
  const aiScale = nativeScales.find((s) => s >= required - 1e-9);
  if (aiScale === undefined && model?.available) {
    errors.push({
      code: "SCALE_TOO_LARGE",
      field: "width",
      message: `This output needs ${formatScale(required)} enlargement; ${MODEL_INFO[options.model].label} supports up to ×${maxNative}.`,
    });
  }

  if (errors.length > 0 || aiScale === undefined) return { plan: null, errors, warnings };

  const aiOutput = scaleSize(original, aiScale);
  if (pixelCount(aiOutput) > limits.maxAiOutputPixels) {
    errors.push({
      code: "AI_PASS_TOO_LARGE",
      field: "width",
      message: `The ×${aiScale} AI pass would produce ${fmt(pixelCount(aiOutput))} pixels, above the ${fmt(limits.maxAiOutputPixels)} processing limit. Use a smaller source image.`,
    });
    return { plan: null, errors, warnings };
  }

  const aspectPreserved = preservesAspectRatio(original, target);
  const resampled = aiOutput.width !== target.width || aiOutput.height !== target.height;

  if (!aspectPreserved) {
    warnings.push({
      code: "ASPECT_CHANGED",
      field: "width",
      message: `The aspect ratio differs from the original: the image will be stretched (${formatScale(scale.x)} horizontally, ${formatScale(scale.y)} vertically). Lock the aspect ratio to avoid distortion.`,
    });
  }
  if (format === "jpeg" && hasAlpha) {
    warnings.push({
      code: "ALPHA_FLATTENED",
      field: "format",
      message: "JPEG has no transparency. Transparent areas will be filled with white. Choose PNG, WebP or TIFF to keep transparency.",
    });
  }
  if (formatInfo.dpi === "exif") {
    warnings.push({
      code: "DPI_EXIF_ONLY",
      field: "dpi",
      message: "WebP has no native DPI field. The DPI is written to EXIF, which some applications ignore.",
    });
  }

  return {
    plan: {
      target,
      aiScale,
      aiOutput,
      resampled,
      preset: matchPreset(original, target),
      aspectPreserved,
      scale,
    },
    errors,
    warnings,
  };
}
