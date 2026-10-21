import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { jsonError } from "./errors";
import { rateLimit } from "./http";
import { getJobManager } from "./jobs";
import { getConfig } from "./config";
import { verifySignedUrl, type UrlKind } from "./signing";

/** Serve a completed job's file behind a signed, expiring URL. */
export async function serveJobFile(request: Request, jobId: string, kind: UrlKind): Promise<Response> {
  const limited = rateLimit(request, "requests");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const verdict = verifySignedUrl(getConfig().secret, jobId, kind, params);
  if (verdict === "invalid") return jsonError("INVALID_LINK", "This link is invalid.", 403);
  if (verdict === "expired") return jsonError("LINK_EXPIRED", "This link has expired. Please process the image again.", 410);

  const manager = getJobManager();
  const job = manager.get(jobId);
  if (!job) {
    return manager.isExpired(jobId)
      ? jsonError("JOB_EXPIRED", "This result has expired and its files were deleted.", 410)
      : jsonError("JOB_NOT_FOUND", "Job not found.", 404);
  }
  if (job.status !== "completed" || !job.output) {
    return jsonError("NOT_READY", "The result is not ready yet.", 409);
  }

  const file = kind === "download" ? job.output.path : job.output.previewPath;
  const mime = file === job.output.path ? job.output.mime : "image/webp";
  const { size } = await stat(file);
  const disposition =
    kind === "download"
      ? `attachment; filename="${job.output.filename.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(job.output.filename)}`
      : "inline";

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
