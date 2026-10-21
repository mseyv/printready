import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { EngineError, type UpscaleEngine, type UpscaleRequest } from "./types";

const API = "https://api.replicate.com/v1";
const POLL_MS = 1500;

export interface ReplicateOptions {
  token?: string;
  version: string;
  maxInputPixels: number;
  fetchImpl?: typeof fetch;
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
  urls: { get: string; cancel: string };
}

/**
 * Hosted inference via Replicate's `nightmareai/real-esrgan` model
 * (RealESRGAN_x4plus; ×2 is produced by the model's own outscale step).
 * The token stays server-side; clients never talk to Replicate directly.
 */
export function createReplicateEngine(opts: ReplicateOptions): UpscaleEngine {
  const configured = Boolean(opts.token);
  return {
    capabilities: {
      id: "replicate",
      label: "Real-ESRGAN (Replicate)",
      configured,
      reason: configured ? undefined : "AI upscaling is not configured: REPLICATE_API_TOKEN is not set.",
      nativeScales: [2, 4],
      maxInputPixels: opts.maxInputPixels,
      reportsProgress: false,
    },
    upscale: (req) => run(opts, req),
  };
}

async function run(opts: ReplicateOptions, req: UpscaleRequest): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.token}` };

  const call = async (url: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: req.signal });
    } catch (err) {
      if (req.signal.aborted) throw req.signal.reason;
      console.error("[printready] replicate network error:", (err as Error).message);
      throw new EngineError("Could not reach the AI inference service.", "INFERENCE_UNAVAILABLE");
    }
    if (!res.ok) {
      console.error(`[printready] replicate ${init.method ?? "GET"} ${new URL(url).pathname} -> ${res.status}`);
      if (res.status === 429) throw new EngineError("The AI inference service is busy. Please try again shortly.", "INFERENCE_BUSY");
      if (res.status === 401 || res.status === 403) throw new EngineError("The AI inference service rejected the server's credentials.", "INFERENCE_UNAVAILABLE");
      throw new EngineError("The AI inference service returned an error.");
    }
    return res;
  };

  // 1. Upload the prepared PNG.
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(await readFile(req.inputPath))], { type: "image/png" }), "input.png");
  const file = (await (await call(`${API}/files`, { method: "POST", body: form })).json()) as {
    id: string;
    urls: { get: string };
  };

  try {
    // 2. Start the prediction.
    let prediction = (await (
      await call(`${API}/predictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: opts.version,
          input: { image: file.urls.get, scale: req.scale, face_enhance: false },
        }),
      })
    ).json()) as Prediction;

    // 3. Poll until it finishes. Cancel remotely if the job is aborted.
    const cancel = () => {
      void doFetch(prediction.urls.cancel, { method: "POST", headers }).catch(() => {});
    };
    req.signal.addEventListener("abort", cancel, { once: true });
    try {
      while (prediction.status === "starting" || prediction.status === "processing") {
        await sleep(POLL_MS, req.signal);
        prediction = (await (await call(prediction.urls.get)).json()) as Prediction;
      }
    } finally {
      req.signal.removeEventListener("abort", cancel);
    }

    if (prediction.status !== "succeeded" || !prediction.output) {
      console.error(`[printready] replicate prediction ${prediction.status}:`, prediction.error ?? "no output");
      const oom = /out of memory|CUDA/i.test(prediction.error ?? "");
      throw new EngineError(oom ? "The image is too large for the AI inference service." : "AI inference failed.");
    }

    // 4. Download and normalise to an RGB PNG for the pipeline.
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    const output = Buffer.from(await (await call(outputUrl, { headers: {} })).arrayBuffer());
    await writeFile(req.outputPath, await sharp(output, { limitInputPixels: false }).removeAlpha().png().toBuffer());
  } finally {
    void doFetch(`${API}/files/${encodeURIComponent(file.id)}`, { method: "DELETE", headers }).catch(() => {});
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
