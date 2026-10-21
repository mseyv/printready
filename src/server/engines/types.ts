import type { EngineCapabilities } from "@/lib/shared/plan";

export interface UpscaleRequest {
  /** 8-bit RGB PNG (no alpha; alpha is upscaled separately by the pipeline). */
  inputPath: string;
  /** Where the engine must write an RGB PNG of exactly input × scale. */
  outputPath: string;
  /** One of `capabilities.nativeScales`. */
  scale: number;
  signal: AbortSignal;
  /** Report progress in [0, 1]. Engines that cannot measure progress never call it. */
  onProgress?: (fraction: number) => void;
}

/**
 * A super-resolution backend. Engines only do inference: orientation, colour
 * management, alpha, resampling to the exact target, encoding and DPI metadata
 * are handled by the pipeline so every engine produces identical file semantics.
 */
export interface UpscaleEngine {
  readonly capabilities: EngineCapabilities;
  upscale(request: UpscaleRequest): Promise<void>;
}

/** Thrown by engines for failures whose message is safe to show to users. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly code = "INFERENCE_FAILED",
  ) {
    super(message);
    this.name = "EngineError";
  }
}
