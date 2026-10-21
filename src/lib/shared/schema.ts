/**
 * Request/response contracts for the upscale API. Zod schemas are the single
 * source of truth for parameter parsing on the server.
 */
import { z } from "zod";
import { UPSCALE_FACTORS, type Size, type UpscaleFactor } from "./dimensions";
import { OUTPUT_FORMATS, type InputFormat, type OutputFormat } from "./formats";
import type { EngineCapabilities, Issue, ProcessingLimits } from "./plan";

export const DPI_PRESETS = [72, 96, 150, 300, 600] as const;
export const DEFAULT_DPI = 300;
export const DEFAULT_QUALITY = 92;
export const DEFAULT_FORMAT: OutputFormat = "png";

/** Multipart form fields arrive as strings; coerce strictly. */
const intField = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a positive whole number")
  .transform(Number);

const boolField = z.enum(["true", "false"]).transform((v) => v === "true");

export const upscaleFieldsSchema = z
  .object({
    scale: z.enum(UPSCALE_FACTORS.map(String) as ["2", "4"]).transform(Number),
    width: intField.optional(),
    height: intField.optional(),
    lockAspect: boolField.default(true),
    dpi: intField,
    format: z.enum(OUTPUT_FORMATS),
    quality: intField.pipe(z.number().int().min(1).max(100)).optional(),
  })
  .strict();

export type UpscaleFields = Omit<z.output<typeof upscaleFieldsSchema>, "scale"> & {
  scale: UpscaleFactor;
};

export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type JobStage = "queued" | "preparing" | "upscaling" | "resampling" | "encoding" | "verifying";

export interface SourceInfo extends Size {
  format: InputFormat;
  bytes: number;
  hasAlpha: boolean;
  /** EXIF orientation that was applied (1 = none). */
  orientation: number;
  colorProfile: "preserved" | "converted-to-srgb" | "none";
}

export interface OutputInfo extends Size {
  format: OutputFormat;
  mime: string;
  bytes: number;
  dpi: number;
  /** Where the DPI was stored, as read back from the written file. */
  dpiStorage: "native" | "exif";
  filename: string;
  aiScale: number;
  resampled: boolean;
  preset: UpscaleFactor | null;
  alphaFlattened: boolean;
  colorProfile: SourceInfo["colorProfile"];
  quality: number | null;
}

export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  stage: JobStage;
  /** 0–1 when the engine reports progress, otherwise null (indeterminate). */
  progress: number | null;
  queuePosition: number | null;
  createdAt: string;
  expiresAt: string;
  engine: string;
  requested: {
    scale: UpscaleFactor;
    width: number;
    height: number;
    dpi: number;
    format: OutputFormat;
  };
  source: SourceInfo;
  warnings: Issue[];
  output: OutputInfo | null;
  downloadUrl: string | null;
  previewUrl: string | null;
  error: { code: string; message: string } | null;
}

export interface CreateJobResponse {
  job: JobStatusResponse;
  /** Seconds the client should wait between status polls. */
  pollInterval: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: Issue[] };
}

export interface PublicConfig {
  engine: EngineCapabilities;
  limits: ProcessingLimits;
  jobTtlSeconds: number;
}

export interface InspectResponse {
  source: SourceInfo;
  /** Small data-URL preview, for formats browsers cannot display (TIFF). */
  preview: string;
}
