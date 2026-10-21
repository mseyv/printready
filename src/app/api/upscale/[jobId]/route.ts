import type { NextRequest } from "next/server";
import { jsonError, toErrorResponse } from "@/server/errors";
import { NO_STORE, rateLimit } from "@/server/http";
import { getJobManager } from "@/server/jobs";

/** GET /api/upscale/:jobId — job status, output metadata and signed URLs when completed. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/upscale/[jobId]">) {
  const limited = rateLimit(request, "requests");
  if (limited) return limited;
  try {
    const { jobId } = await ctx.params;
    const manager = getJobManager();
    const job = manager.get(jobId);
    if (!job) return notFound(manager.isExpired(jobId));
    return Response.json(manager.toResponse(job), { headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err, "job status");
  }
}

/** DELETE /api/upscale/:jobId — cancel processing and delete all files immediately. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/upscale/[jobId]">) {
  const limited = rateLimit(request, "requests");
  if (limited) return limited;
  try {
    const { jobId } = await ctx.params;
    const manager = getJobManager();
    if (!(await manager.remove(jobId))) return notFound(manager.isExpired(jobId));
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err, "delete job");
  }
}

function notFound(expired: boolean) {
  return expired
    ? jsonError("JOB_EXPIRED", "This result has expired and its files were deleted. Please process the image again.", 410)
    : jsonError("JOB_NOT_FOUND", "Job not found.", 404);
}
