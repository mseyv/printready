import path from "node:path";
import type { NextRequest } from "next/server";
import type { Size } from "@/lib/shared/dimensions";
import type { EnhanceOptions } from "@/lib/shared/models";
import { planUpscale, type Issue } from "@/lib/shared/plan";
import { DEFAULT_QUALITY, upscaleFieldsSchema, type CreateJobResponse, type UpscaleFields } from "@/lib/shared/schema";
import { getConfig } from "@/server/config";
import { getEngine } from "@/server/engines";
import { jsonError, PublicError, toErrorResponse } from "@/server/errors";
import { NO_STORE, rateLimit, readImageUpload, requesterKey } from "@/server/http";
import { getJobManager } from "@/server/jobs";
import { probeImage, writeUpload } from "@/server/pipeline";
import { resolveTarget } from "@/server/target";

const POLL_INTERVAL_SECONDS = 1;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * POST /api/upscale — multipart form:
 *   image (file), scale (2|4), width?, height?, lockAspect (true|false), dpi, format, quality?,
 *   model?, faceEnhance (none|gfpgan|codeformer), tileSize? (256|400|512|1024)
 * Header `Idempotency-Key` makes retries/double-clicks return the same job.
 * Responds 202 with the job status; poll GET /api/upscale/:jobId.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "uploads");
  if (limited) return limited;

  const manager = getJobManager();
  let allocatedDir: string | null = null;
  try {
    const cfg = getConfig();
    const engine = getEngine();

    const idemHeader = request.headers.get("idempotency-key");
    if (idemHeader !== null && !IDEMPOTENCY_RE.test(idemHeader)) {
      return jsonError("INVALID_REQUEST", "Invalid Idempotency-Key header.", 400);
    }
    const idemKey = idemHeader ? `${requesterKey(request)}:${idemHeader}` : null;
    const existing = idemKey ? manager.findByIdempotencyKey(idemKey) : undefined;
    if (existing) return created(manager.toResponse(existing), 200);

    const { file, fields } = await readImageUpload(request);

    const parsed = upscaleFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      const issues: Issue[] = parsed.error.issues.map((i) => ({
        code: "INVALID_PARAMETER",
        field: fieldOf(i.path[0]),
        message: `${String(i.path[0] ?? "request")}: ${i.message}`,
      }));
      return jsonError("INVALID_PARAMETERS", "Some settings are invalid.", 422, { issues });
    }
    const params = parsed.data as UpscaleFields;

    if (!engine.capabilities.configured) {
      return jsonError("ENGINE_NOT_CONFIGURED", engine.capabilities.reason ?? "AI upscaling is not configured.", 503);
    }

    const { id, dir } = await manager.allocate();
    allocatedDir = dir;
    // Server-generated name; the client filename is only used (sanitised) for the download name.
    const sourcePath = path.join(dir, "source");
    await writeUpload(sourcePath, new Uint8Array(await file.arrayBuffer()));

    const probe = await probeImage(sourcePath, cfg.limits);
    const original: Size = { width: probe.source.width, height: probe.source.height };
    const target = resolveTarget(original, params);
    const options: EnhanceOptions = {
      model: params.model ?? engine.capabilities.defaultModel,
      faceEnhance: params.faceEnhance,
      tileSize: params.tileSize ?? null,
    };

    const result = planUpscale({
      original,
      target,
      format: params.format,
      dpi: params.dpi,
      hasAlpha: probe.source.hasAlpha,
      options,
      engine: engine.capabilities,
      limits: cfg.limits,
    });
    if (!result.plan) {
      throw new PublicError("INVALID_SETTINGS", result.errors[0]?.message ?? "Unsupported settings.", 422, result.errors);
    }

    const warnings = [...result.warnings];
    if (probe.multiPage) {
      warnings.push({ code: "MULTI_PAGE", field: "image", message: "Only the first page/frame of this image is processed." });
    }
    if (probe.source.colorProfile === "converted-to-srgb") {
      warnings.push({ code: "COLOR_CONVERTED", field: "image", message: "The image's colour space (CMYK or greyscale profile) was converted to sRGB for processing." });
    }

    const job = manager.create({
      id,
      workDir: dir,
      sourcePath,
      originalName: file.name || "image",
      params: {
        scale: params.scale,
        width: target.width,
        height: target.height,
        lockAspect: params.lockAspect,
        dpi: params.dpi,
        format: params.format,
        quality: params.quality ?? DEFAULT_QUALITY,
        ...options,
      },
      probe,
      plan: result.plan,
      warnings,
      idempotencyKey: idemKey,
    });
    allocatedDir = null;
    return created(manager.toResponse(job), 202);
  } catch (err) {
    if (allocatedDir) await manager.discard(allocatedDir);
    return toErrorResponse(err, "create job");
  }
}

function created(job: CreateJobResponse["job"], status: number) {
  const body: CreateJobResponse = { job, pollInterval: POLL_INTERVAL_SECONDS };
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, Location: `/api/upscale/${job.id}` },
  });
}

function fieldOf(key: PropertyKey | undefined): Issue["field"] {
  if (key === "width" || key === "height" || key === "dpi" || key === "format" || key === "model" || key === "faceEnhance" || key === "tileSize") return key;
  return undefined;
}
