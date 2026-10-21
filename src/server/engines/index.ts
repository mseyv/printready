import { getConfig } from "../config";
import { createRealEsrganNcnnEngine } from "./realesrgan-ncnn";
import { createReplicateEngine } from "./replicate";
import type { UpscaleEngine } from "./types";

const notConfigured: UpscaleEngine = {
  capabilities: {
    id: "none",
    label: "Not configured",
    configured: false,
    reason: "AI upscaling is not configured on this server. Set UPSCALE_ENGINE to enable processing.",
    nativeScales: [],
    maxInputPixels: null,
    reportsProgress: false,
  },
  upscale: async () => {
    throw new Error("No upscale engine configured");
  },
};

let engine: UpscaleEngine | null = null;

export function getEngine(): UpscaleEngine {
  if (engine) return engine;
  const cfg = getConfig();
  switch (cfg.UPSCALE_ENGINE) {
    case "realesrgan-ncnn":
      engine = createRealEsrganNcnnEngine({
        binPath: cfg.REALESRGAN_BIN,
        modelsDir: cfg.REALESRGAN_MODELS_DIR,
        model: cfg.REALESRGAN_MODEL,
        gpu: cfg.REALESRGAN_GPU,
        tile: cfg.REALESRGAN_TILE,
      });
      break;
    case "replicate":
      engine = createReplicateEngine({
        token: cfg.REPLICATE_API_TOKEN,
        version: cfg.REPLICATE_MODEL_VERSION,
        maxInputPixels: cfg.REPLICATE_MAX_INPUT_PIXELS,
      });
      break;
    default:
      engine = notConfigured;
  }
  return engine;
}

/** Test hook: inject an engine (e.g. a deterministic fake) or reset to env-based selection. */
export function setEngineForTests(next: UpscaleEngine | null) {
  engine = next;
}
