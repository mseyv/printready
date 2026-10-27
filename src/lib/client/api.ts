import type { Issue } from "@/lib/shared/plan";
import type {
  ApiErrorBody,
  CreateJobResponse,
  InspectResponse,
  JobStatusResponse,
  PublicConfig,
} from "@/lib/shared/schema";
import type { OutputFormat } from "@/lib/shared/formats";
import type { EnhanceOptions } from "@/lib/shared/models";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly issues?: Issue[],
  ) {
    super(message);
  }
  /** Network-level failure (no HTTP response). */
  get isNetwork() {
    return this.status === 0;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error (e.g. proxy page) */
  }
  throw new ApiError(
    body?.error.code ?? "HTTP_ERROR",
    body?.error.message ?? `The server responded with an error (${res.status}).`,
    res.status,
    body?.error.issues,
  );
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Network error. Check your connection.", 0);
  }
  return parse<T>(res);
}

export const getConfig = () => request<PublicConfig>("/api/config");
export const getJob = (id: string, signal?: AbortSignal) =>
  request<JobStatusResponse>(`/api/upscale/${encodeURIComponent(id)}`, { signal });
export const deleteJob = (id: string) =>
  fetch(`/api/upscale/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);

export function inspectImage(file: File) {
  const form = new FormData();
  form.append("image", file, file.name || "image.tif");
  return request<InspectResponse>("/api/inspect", { method: "POST", body: form });
}

export interface CreateJobInput {
  file: File;
  scale: 2 | 4;
  width: number;
  height: number;
  lockAspect: boolean;
  dpi: number;
  format: OutputFormat;
  quality: number;
  options: EnhanceOptions;
  idempotencyKey: string;
}

/** Upload with XHR so real upload progress can be shown. */
export function createJob(
  input: CreateJobInput,
  onUploadProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<CreateJobResponse> {
  const form = new FormData();
  form.append("image", input.file, input.file.name || "image");
  form.append("scale", String(input.scale));
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  form.append("lockAspect", String(input.lockAspect));
  form.append("dpi", String(input.dpi));
  form.append("format", input.format);
  form.append("quality", String(input.quality));
  form.append("model", input.options.model);
  form.append("faceEnhance", input.options.faceEnhance ?? "none");
  if (input.options.tileSize !== null) form.append("tileSize", String(input.options.tileSize));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upscale");
    xhr.setRequestHeader("Idempotency-Key", input.idempotencyKey);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const res = new Response(xhr.responseText, {
        status: xhr.status,
        headers: { "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json" },
      });
      parse<CreateJobResponse>(res).then(resolve, reject);
    };
    xhr.onerror = () => reject(new ApiError("NETWORK_ERROR", "The upload was interrupted. Check your connection and try again.", 0));
    xhr.ontimeout = xhr.onerror;
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new ApiError("ABORTED", "Upload cancelled.", 0));
    xhr.send(form);
  });
}
