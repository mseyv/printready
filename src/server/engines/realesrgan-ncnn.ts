import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { EngineError, type UpscaleEngine, type UpscaleRequest } from "./types";

/** Models shipped with the official Real-ESRGAN ncnn-vulkan release and their native scales. */
const MODEL_SCALES: Record<string, number[]> = {
  "realesrgan-x4plus": [4],
  "realesrgan-x4plus-anime": [4],
  "realesr-animevideov3": [2, 4],
};

export interface RealEsrganNcnnOptions {
  binPath?: string;
  modelsDir?: string;
  model: string;
  gpu: string;
  tile: number;
}

/**
 * Local inference with the Real-ESRGAN ncnn-vulkan binary
 * (https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan). Runs on any Vulkan GPU.
 */
export function createRealEsrganNcnnEngine(opts: RealEsrganNcnnOptions): UpscaleEngine {
  const nativeScales = MODEL_SCALES[opts.model];
  const reason = checkInstall(opts, nativeScales);

  return {
    capabilities: {
      id: "realesrgan-ncnn",
      label: `Real-ESRGAN (${opts.model}, local GPU)`,
      configured: reason === null,
      reason: reason ?? undefined,
      nativeScales: nativeScales ?? [],
      maxInputPixels: null,
      reportsProgress: true,
    },
    upscale: (req) => run(opts, req),
  };
}

function checkInstall(opts: RealEsrganNcnnOptions, scales: number[] | undefined): string | null {
  if (!opts.binPath) return "AI upscaling is not configured: REALESRGAN_BIN is not set.";
  try {
    accessSync(opts.binPath, constants.X_OK);
  } catch {
    return "AI upscaling is not configured: the Real-ESRGAN binary was not found or is not executable.";
  }
  if (!scales) return `AI upscaling is not configured: unknown model "${opts.model}".`;
  const modelsDir = opts.modelsDir ?? path.join(path.dirname(opts.binPath), "models");
  if (!existsSync(path.join(modelsDir, `${modelName(opts.model, scales[0])}.param`))) {
    return "AI upscaling is not configured: model files are missing.";
  }
  return null;
}

/** animevideov3 ships one file per scale; the x4 models have a single file. */
function modelName(model: string, scale: number) {
  return model === "realesr-animevideov3" ? `${model}-x${scale}` : model;
}

function run(opts: RealEsrganNcnnOptions, req: UpscaleRequest): Promise<void> {
  const modelsDir = opts.modelsDir ?? path.join(path.dirname(opts.binPath!), "models");
  const args = [
    "-i", req.inputPath,
    "-o", req.outputPath,
    "-n", opts.model,
    "-s", String(req.scale),
    "-m", modelsDir,
    "-f", "png",
    "-t", String(opts.tile),
  ];
  if (opts.gpu !== "auto") args.push("-g", opts.gpu);

  return new Promise((resolve, reject) => {
    if (req.signal.aborted) return reject(req.signal.reason);

    // No shell: arguments are passed verbatim, and paths are server-generated.
    const child = spawn(opts.binPath!, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    let settled = false;

    const onAbort = () => child.kill("SIGKILL");
    req.signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
      // The binary prints per-tile progress like "37.50%".
      const matches = chunk.match(/(\d+(?:\.\d+)?)%/g);
      if (matches && req.onProgress) {
        const pct = parseFloat(matches[matches.length - 1]);
        if (Number.isFinite(pct)) req.onProgress(Math.min(1, pct / 100));
      }
    });

    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      req.signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };

    child.on("error", (err) => {
      console.error("[upscaler] realesrgan spawn failed:", err.message);
      finish(new EngineError("The AI engine could not be started."));
    });
    child.on("close", (code) => {
      if (req.signal.aborted) return finish(req.signal.reason);
      // The binary sometimes exits 0 after a failure, so the output is also checked.
      if (code !== 0 || !existsSync(req.outputPath)) {
        console.error(`[upscaler] realesrgan exited with code ${code}:`, stderrTail.split("\n").slice(-5).join(" | "));
        const gpuIssue = /vkCreateInstance|invalid gpu|vkAllocateMemory|out of memory/i.test(stderrTail);
        return finish(
          new EngineError(
            gpuIssue
              ? "The AI engine ran out of GPU resources. Try a smaller image or output size."
              : "AI inference failed.",
          ),
        );
      }
      finish();
    });
  });
}
