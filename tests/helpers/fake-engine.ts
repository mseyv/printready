import sharp from "sharp";
import type { UpscaleEngine, UpscaleRequest } from "@/server/engines/types";
import { EngineError } from "@/server/engines/types";

/**
 * TEST-ONLY stand-in for an AI model: a deterministic Lanczos enlargement that honours
 * the engine contract (RGB PNG in, RGB PNG of exactly input × scale out). It lets the
 * pipeline, metadata and API be tested without a GPU. Never registered in production.
 */
export function createFakeEngine(
  opts: {
    nativeScales?: number[];
    behaviour?: "ok" | "fail" | "wrong-size" | "hang";
    onCall?: (req: UpscaleRequest) => void;
  } = {},
): UpscaleEngine {
  return {
    capabilities: {
      id: "fake",
      label: "Fake (tests)",
      configured: true,
      nativeScales: opts.nativeScales ?? [2, 4],
      maxInputPixels: null,
      reportsProgress: true,
    },
    async upscale(req) {
      opts.onCall?.(req);
      const meta = await sharp(req.inputPath).metadata();
      if (meta.hasAlpha) throw new Error("engine received alpha");
      switch (opts.behaviour) {
        case "fail":
          throw new EngineError("AI inference failed.");
        case "hang":
          await new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason)));
          return;
        case "wrong-size":
          await sharp(req.inputPath).resize(meta.width! * req.scale + 1, meta.height! * req.scale).png().toFile(req.outputPath);
          return;
      }
      req.onProgress?.(0.5);
      await sharp(req.inputPath)
        .resize(meta.width! * req.scale, meta.height! * req.scale, { kernel: "lanczos3" })
        .png()
        .toFile(req.outputPath);
      req.onProgress?.(1);
    },
  };
}
