import type { NextRequest } from "next/server";
import { toErrorResponse } from "@/server/errors";
import { serveJobFile } from "@/server/files";

/** GET /api/upscale/:jobId/download?exp=…&sig=… — the processed file as an attachment. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/upscale/[jobId]/download">) {
  try {
    return await serveJobFile(request, (await ctx.params).jobId, "download");
  } catch (err) {
    return toErrorResponse(err, "download");
  }
}
