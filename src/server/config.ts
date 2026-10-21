import "server-only";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ProcessingLimits } from "@/lib/shared/plan";

const int = (def: number) => z.coerce.number().int().positive().default(def);

const envSchema = z.object({
  UPSCALE_ENGINE: z.enum(["none", "realesrgan-ncnn", "replicate"]).default("none"),

  // Real-ESRGAN ncnn-vulkan (local GPU)
  REALESRGAN_BIN: z.string().optional(),
  REALESRGAN_MODELS_DIR: z.string().optional(),
  REALESRGAN_MODEL: z.string().default("realesrgan-x4plus"),
  REALESRGAN_GPU: z.string().regex(/^(auto|-?\d+(,\d+)*)$/).default("auto"),
  REALESRGAN_TILE: z.coerce.number().int().min(0).default(0),

  // Replicate (hosted)
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_MODEL_VERSION: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .default("f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa"),
  REPLICATE_MAX_INPUT_PIXELS: int(2_000_000),

  // Limits
  MAX_UPLOAD_MB: int(25),
  MAX_INPUT_PIXELS: int(25_000_000),
  MIN_OUTPUT_SIDE: int(16),
  MAX_OUTPUT_SIDE: int(16_384),
  MAX_OUTPUT_PIXELS: int(64_000_000),
  MAX_AI_OUTPUT_PIXELS: int(100_000_000),
  MIN_DPI: int(1),
  MAX_DPI: int(10_000),

  // Jobs & storage
  UPSCALE_TMP_DIR: z.string().default(path.join(os.tmpdir(), "upscaler-jobs")),
  JOB_TTL_MINUTES: int(30),
  JOB_TIMEOUT_SECONDS: int(900),
  MAX_CONCURRENT_JOBS: int(1),
  MAX_QUEUED_JOBS: int(20),
  MIN_FREE_DISK_MB: int(1024),
  DOWNLOAD_URL_SECRET: z.string().min(32).optional(),

  // Rate limiting (per client IP, per minute)
  RATE_LIMIT_UPLOADS_PER_MINUTE: int(10),
  RATE_LIMIT_REQUESTS_PER_MINUTE: int(240),
  /** Reverse proxies in front of the app that append to X-Forwarded-For (set ≥1 in production). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
});

export type ServerConfig = z.output<typeof envSchema> & {
  limits: ProcessingLimits;
  secret: Buffer;
};

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loudly at startup with the variable names only (never values).
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  const env = parsed.data;
  if (!env.DOWNLOAD_URL_SECRET && process.env.NODE_ENV === "production") {
    console.warn("[upscaler] DOWNLOAD_URL_SECRET is not set; using a per-process random secret.");
  }
  cached = {
    ...env,
    secret: env.DOWNLOAD_URL_SECRET ? Buffer.from(env.DOWNLOAD_URL_SECRET) : randomBytes(32),
    limits: {
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      maxInputPixels: env.MAX_INPUT_PIXELS,
      minOutputSide: env.MIN_OUTPUT_SIDE,
      maxOutputSide: env.MAX_OUTPUT_SIDE,
      maxOutputPixels: env.MAX_OUTPUT_PIXELS,
      maxAiOutputPixels: env.MAX_AI_OUTPUT_PIXELS,
      minDpi: env.MIN_DPI,
      maxDpi: env.MAX_DPI,
    },
  };
  return cached;
}

/** Test hook: drop the cached config so changed env vars take effect. */
export function resetConfigForTests() {
  cached = null;
}
