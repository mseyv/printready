import type { NextRequest } from "next/server";
import { toErrorResponse } from "@/server/errors";
import { serveJobFile } from "@/server/files";

/** GET /api/upscale/:jobId/preview?exp=…&sig=… — browser-displayable rendition for the comparison view. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/upscale/[jobId]/preview">) {
  try {
    return await serveJobFile(request, (await ctx.params).jobId, "preview");
  } catch (err) {
    return toErrorResponse(err, "preview");
  }
}
