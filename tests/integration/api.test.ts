import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ApiErrorBody, CreateJobResponse, JobStatusResponse } from "@/lib/shared/schema";
import { POST as inspect } from "@/app/api/inspect/route";
import { POST as create } from "@/app/api/upscale/route";
import { DELETE as remove, GET as status } from "@/app/api/upscale/[jobId]/route";
import { GET as download } from "@/app/api/upscale/[jobId]/download/route";
import { GET as preview } from "@/app/api/upscale/[jobId]/preview/route";
import { setEngineForTests } from "@/server/engines";
import { getJobManager } from "@/server/jobs";
import { createFakeEngine } from "../helpers/fake-engine";
import { rgbaImage, rgbImage } from "../helpers/fixtures";

const BASE = "http://localhost:3000";

function upload(image: Buffer | null, fields: Record<string, string>, headers: Record<string, string> = {}, name = "holiday photo.png") {
  const form = new FormData();
  if (image) form.append("image", new Blob([new Uint8Array(image)]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest(`${BASE}/api/upscale`, { method: "POST", body: form, headers });
}

const ctx = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
const get = (path: string) => new NextRequest(`${BASE}${path}`);
const defaults = { scale: "2", dpi: "300", format: "png", lockAspect: "true" };

async function waitFor(jobId: string, timeoutMs = 20_000): Promise<JobStatusResponse> {
  const start = Date.now();
  for (;;) {
    const res = await status(get(`/api/upscale/${jobId}`), ctx(jobId));
    const job = (await res.json()) as JobStatusResponse;
    if (job.status === "completed" || job.status === "failed") return job;
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for job");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function submit(image: Buffer, fields: Record<string, string> = defaults) {
  const res = await create(upload(image, fields));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(202);
  return ((await res.json()) as CreateJobResponse).job;
}

beforeAll(() => setEngineForTests(createFakeEngine()));
afterEach(() => setEngineForTests(createFakeEngine()));

describe("POST /api/upscale → status → download", () => {
  it("processes a ×2 PNG at 300 DPI end to end", async () => {
    const job = await submit(await rgbImage(80, 45).png().toBuffer());
    expect(job.status === "queued" || job.status === "processing").toBe(true);
    expect(job.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(job.downloadUrl).toBeNull();
    expect(job.source).toMatchObject({ width: 80, height: 45, format: "png" });

    const done = await waitFor(job.id);
    expect(done.status).toBe("completed");
    expect(done.output).toMatchObject({
      width: 160,
      height: 90,
      dpi: 300,
      format: "png",
      preset: 2,
      filename: "holiday-photo_upscaled-2x_160x90_300dpi.png",
    });
    expect(JSON.stringify(done)).not.toMatch(/\/tmp|printready-test|job-/); // no filesystem paths leak

    const res = await download(get(done.downloadUrl!), ctx(job.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="holiday-photo_upscaled-2x_160x90_300dpi.png"');
    const file = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(file.length);
    expect(file.length).toBe(done.output!.bytes);
    const meta = await sharp(file).metadata();
    expect(meta).toMatchObject({ width: 160, height: 90, density: 300, format: "png" });

    const pv = await preview(get(done.previewUrl!), ctx(job.id));
    expect(pv.status).toBe(200);
    expect(pv.headers.get("content-disposition")).toBe("inline");
  });

  it("honours custom dimensions, format, quality and DPI", async () => {
    const job = await submit(await rgbImage(100, 50).jpeg().toBuffer(), {
      scale: "4",
      width: "300",
      height: "150",
      lockAspect: "true",
      dpi: "150",
      format: "jpeg",
      quality: "80",
    });
    const done = await waitFor(job.id);
    expect(done.output).toMatchObject({ width: 300, height: 150, dpi: 150, preset: null, aiScale: 4, resampled: true, quality: 80 });
    expect(done.output!.filename).toBe("holiday-photo_upscaled-custom_300x150_150dpi.jpg");
    const file = Buffer.from(await (await download(get(done.downloadUrl!), ctx(job.id))).arrayBuffer());
    expect(await sharp(file).metadata()).toMatchObject({ width: 300, height: 150, density: 150, format: "jpeg" });
  });

  it("derives height server-side when only width is sent", async () => {
    const job = await submit(await rgbImage(64, 48).png().toBuffer(), { ...defaults, width: "100" });
    expect(job.requested).toMatchObject({ width: 100, height: 75 });
  });

  it("reports alpha flattening for JPEG and keeps alpha for PNG", async () => {
    const src = await rgbaImage(40, 20).png().toBuffer();
    const jpg = await waitFor((await submit(src, { ...defaults, format: "jpeg" })).id);
    expect(jpg.output?.alphaFlattened).toBe(true);
    expect(jpg.warnings.map((w) => w.code)).toContain("ALPHA_FLATTENED");
    const pngJob = await waitFor((await submit(src)).id);
    expect(pngJob.output?.alphaFlattened).toBe(false);
  });

  it("serves TIFF output with a WebP preview", async () => {
    const done = await waitFor((await submit(await rgbImage(40, 20).png().toBuffer(), { ...defaults, format: "tiff" })).id);
    const dl = await download(get(done.downloadUrl!), ctx(done.id));
    expect(dl.headers.get("content-type")).toBe("image/tiff");
    expect((await sharp(Buffer.from(await dl.arrayBuffer())).metadata()).density).toBe(300);
    const pv = await preview(get(done.previewUrl!), ctx(done.id));
    expect(pv.headers.get("content-type")).toBe("image/webp");
  });
});

describe("validation", () => {
  const err = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

  it("rejects missing files and bad parameters", async () => {
    const png = await rgbImage(40, 20).png().toBuffer();
    let res = await create(upload(null, defaults));
    expect(res.status).toBe(400);

    res = await create(upload(png, { ...defaults, scale: "3" }));
    expect(res.status).toBe(422);
    expect((await err(res)).code).toBe("INVALID_PARAMETERS");

    res = await create(upload(png, { ...defaults, dpi: "0" }));
    expect(res.status).toBe(422);

    res = await create(upload(png, { ...defaults, format: "gif" }));
    expect(res.status).toBe(422);
  });

  it("validates file signatures, not names", async () => {
    const res = await create(upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), defaults, {}, "evil.png"));
    expect(res.status).toBe(415);
    expect((await err(res)).code).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects corrupted images", async () => {
    const res = await create(upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), defaults));
    expect(res.status).toBe(422);
    expect((await err(res)).code).toBe("INVALID_IMAGE");
  });

  it("rejects inconsistent locked dimensions and oversize outputs", async () => {
    const png = await rgbImage(40, 20).png().toBuffer();
    let res = await create(upload(png, { ...defaults, width: "80", height: "80" }));
    expect(res.status).toBe(422);
    expect((await err(res)).code).toBe("ASPECT_MISMATCH");

    res = await create(upload(png, { ...defaults, width: "400", height: "200" }));
    expect(res.status).toBe(422);
    expect((await err(res)).issues?.[0].code).toBe("SCALE_TOO_LARGE");

    res = await create(upload(png, { ...defaults, width: "80", height: "80", lockAspect: "false" }));
    expect(res.status).toBe(202);
  });

  it("returns 503 when no engine is configured — never a fake result", async () => {
    setEngineForTests({ ...createFakeEngine(), capabilities: { ...createFakeEngine().capabilities, configured: false, reason: "not configured" } });
    const res = await create(upload(await rgbImage(40, 20).png().toBuffer(), defaults));
    expect(res.status).toBe(503);
    expect((await err(res)).code).toBe("ENGINE_NOT_CONFIGURED");
  });

  it("rejects unsigned, tampered and foreign download links", async () => {
    const done = await waitFor((await submit(await rgbImage(40, 20).png().toBuffer())).id);
    const other = await waitFor((await submit(await rgbImage(40, 20).png().toBuffer())).id);
    expect((await download(get(`/api/upscale/${done.id}/download`), ctx(done.id))).status).toBe(403);
    expect((await download(get(done.downloadUrl!.replace(/sig=./, "sig=A")), ctx(done.id))).status).toBe(403);
    // A valid link for one job cannot be replayed against another.
    expect((await download(get(done.downloadUrl!), ctx(other.id))).status).toBe(403);
    expect((await download(get(done.previewUrl!), ctx(done.id))).status).toBe(403); // preview URL used for download kind
  });

  it("returns 404 for unknown and malformed job IDs", async () => {
    expect((await status(get("/api/upscale/AAAAAAAAAAAAAAAAAAAAAA"), ctx("AAAAAAAAAAAAAAAAAAAAAA"))).status).toBe(404);
    expect((await status(get("/api/upscale/..%2F..%2Fetc"), ctx("../../etc"))).status).toBe(404);
  });
});

describe("job lifecycle", () => {
  it("deduplicates submissions with the same Idempotency-Key", async () => {
    const png = await rgbImage(40, 20).png().toBuffer();
    const a = await create(upload(png, defaults, { "idempotency-key": "same-key-123" }));
    const b = await create(upload(png, defaults, { "idempotency-key": "same-key-123" }));
    expect(a.status).toBe(202);
    expect(b.status).toBe(200);
    expect(((await b.json()) as CreateJobResponse).job.id).toBe(((await a.json()) as CreateJobResponse).job.id);
  });

  it("reports engine failures as failed jobs with a safe message", async () => {
    setEngineForTests(createFakeEngine({ behaviour: "fail" }));
    const done = await waitFor((await submit(await rgbImage(40, 20).png().toBuffer())).id);
    expect(done.status).toBe("failed");
    expect(done.error).toEqual({ code: "INFERENCE_FAILED", message: "AI inference failed." });
    expect(done.downloadUrl).toBeNull();
  });

  it("cancels and deletes a job on DELETE", async () => {
    setEngineForTests(createFakeEngine({ behaviour: "hang" }));
    const job = await submit(await rgbImage(40, 20).png().toBuffer());
    await new Promise((r) => setTimeout(r, 50));
    const res = await remove(new NextRequest(`${BASE}/api/upscale/${job.id}`, { method: "DELETE" }), ctx(job.id));
    expect(res.status).toBe(204);
    expect((await status(get(`/api/upscale/${job.id}`), ctx(job.id))).status).toBe(404);
  });

  it("expires completed jobs: files deleted, status 410", async () => {
    const done = await waitFor((await submit(await rgbImage(40, 20).png().toBuffer())).id);
    await getJobManager().sweep(Date.now() + 365 * 24 * 3600 * 1000);
    const res = await status(get(`/api/upscale/${done.id}`), ctx(done.id));
    expect(res.status).toBe(410);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("JOB_EXPIRED");
  });
});

describe("POST /api/inspect", () => {
  it("returns oriented dimensions and a preview for TIFF", async () => {
    const tiff = await rgbImage(60, 30).tiff().toBuffer();
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(tiff)]), "scan.tif");
    const res = await inspect(new NextRequest(`${BASE}/api/inspect`, { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toMatchObject({ width: 60, height: 30, format: "tiff" });
    expect(body.preview).toMatch(/^data:image\/jpeg;base64,/);
  });
});
