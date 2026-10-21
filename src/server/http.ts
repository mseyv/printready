import { getConfig } from "./config";
import { jsonError, PublicError } from "./errors";
import { clientKey, RateLimiter } from "./rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

const globalForLimits = globalThis as unknown as {
  __upscalerLimits?: { uploads: RateLimiter; requests: RateLimiter };
};

function limiters() {
  const cfg = getConfig();
  return (globalForLimits.__upscalerLimits ??= {
    uploads: new RateLimiter(cfg.RATE_LIMIT_UPLOADS_PER_MINUTE),
    requests: new RateLimiter(cfg.RATE_LIMIT_REQUESTS_PER_MINUTE),
  });
}

/** Returns a 429 response when the client is over its budget, otherwise null. */
export function rateLimit(request: Request, kind: "uploads" | "requests"): Response | null {
  const key = clientKey(request.headers, getConfig().TRUST_PROXY_HOPS);
  const retryAfter = limiters()[kind].hit(key);
  if (retryAfter === 0) return null;
  return jsonError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", 429, {
    headers: { "Retry-After": String(retryAfter) },
  });
}

export function requesterKey(request: Request) {
  return clientKey(request.headers, getConfig().TRUST_PROXY_HOPS);
}

/** Parse a multipart upload with an `image` file field, enforcing the size limit before buffering. */
export async function readImageUpload(request: Request): Promise<{ file: File; fields: Record<string, string> }> {
  const { maxUploadBytes } = getConfig().limits;
  const mb = Math.round(maxUploadBytes / 1024 / 1024);

  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    throw new PublicError("INVALID_REQUEST", "Expected a multipart/form-data upload.", 415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  // Allow some room for multipart boundaries and the other fields.
  if (declared > maxUploadBytes + 64 * 1024) {
    throw new PublicError("FILE_TOO_LARGE", `The file exceeds the ${mb} MB upload limit.`, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new PublicError("INVALID_REQUEST", "The upload could not be read. Please try again.", 400);
  }

  const file = form.get("image");
  if (!(file instanceof File)) throw new PublicError("INVALID_REQUEST", "No image was uploaded.", 400);
  if (file.size === 0) throw new PublicError("INVALID_IMAGE", "The uploaded file is empty.", 422);
  if (file.size > maxUploadBytes) {
    throw new PublicError("FILE_TOO_LARGE", `The file exceeds the ${mb} MB upload limit.`, 413);
  }

  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k === "image") continue;
    if (typeof v !== "string") throw new PublicError("INVALID_REQUEST", `Unexpected file field "${k.slice(0, 40)}".`, 400);
    fields[k] = v;
  }
  return { file, fields };
}

export { NO_STORE };
