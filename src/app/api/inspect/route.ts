import path from "node:path";
import type { NextRequest } from "next/server";
import type { InspectResponse } from "@/lib/shared/schema";
import { getConfig } from "@/server/config";
import { toErrorResponse } from "@/server/errors";
import { NO_STORE, rateLimit, readImageUpload } from "@/server/http";
import { getJobManager } from "@/server/jobs";
import { probeImage, renderInspectPreview, writeUpload } from "@/server/pipeline";

/**
 * POST /api/inspect — read dimensions and render a preview for formats the
 * browser cannot decode itself (TIFF). The file is deleted before responding.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "uploads");
  if (limited) return limited;
  const manager = getJobManager();
  let dir: string | null = null;
  try {
    const { file } = await readImageUpload(request);
    dir = (await manager.allocate()).dir;
    const source = path.join(dir, "source");
    await writeUpload(source, new Uint8Array(await file.arrayBuffer()));
    const probe = await probeImage(source, getConfig().limits);
    const body: InspectResponse = { source: probe.source, preview: await renderInspectPreview(source) };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    return toErrorResponse(err, "inspect");
  } finally {
    if (dir) await manager.discard(dir);
  }
}
