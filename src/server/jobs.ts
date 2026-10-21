/**
 * In-process job queue with temporary on-disk storage.
 *
 * Single-instance by design: jobs, queue and files live in this Node process.
 * For multiple replicas, move the queue to Redis/BullMQ and storage to an object
 * store — the `JobManager` surface is what the route handlers depend on.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { buildOutputFilename } from "@/lib/shared/filename";
import { OUTPUT_FORMAT_INFO } from "@/lib/shared/formats";
import type { Issue, UpscalePlan } from "@/lib/shared/plan";
import type {
  JobStage,
  JobStatus,
  JobStatusResponse,
  OutputInfo,
  UpscaleFields,
} from "@/lib/shared/schema";
import { getConfig } from "./config";
import { getEngine } from "./engines";
import { PublicError } from "./errors";
import { processImage, type ProbeResult } from "./pipeline";
import { signedUrl } from "./signing";

const JOB_DIR_PREFIX = "job-";
/** 128 bits of randomness, base64url: unguessable, so job IDs cannot be enumerated. */
const JOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = 60_000;

export interface Job {
  id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number | null;
  createdAt: number;
  expiresAt: number;
  dir: string;
  sourcePath: string;
  originalName: string;
  params: Required<Omit<UpscaleFields, "quality" | "lockAspect">> & { quality: number; lockAspect: boolean };
  probe: ProbeResult;
  plan: UpscalePlan;
  warnings: Issue[];
  output: (OutputInfo & { path: string; previewPath: string }) | null;
  error: { code: string; message: string } | null;
  abort: AbortController;
  idempotencyKey: string | null;
}

export interface NewJob {
  workDir: string;
  sourcePath: string;
  originalName: string;
  params: Job["params"];
  probe: ProbeResult;
  plan: UpscalePlan;
  warnings: Issue[];
  idempotencyKey: string | null;
  id: string;
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = 0;
  private idempotency = new Map<string, string>();
  /** Recently expired job IDs → time of expiry, so clients get "expired" instead of "not found". */
  private tombstones = new Map<string, number>();
  private sweeper: NodeJS.Timeout | null = null;
  private ready: Promise<void>;

  constructor(private readonly root = getConfig().UPSCALE_TMP_DIR) {
    this.ready = this.init();
  }

  private async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Files from a previous process can never be served again: remove them.
    for (const name of await readdir(this.root).catch(() => [])) {
      if (name.startsWith(JOB_DIR_PREFIX) && JOB_ID_RE.test(name.slice(JOB_DIR_PREFIX.length))) {
        await rm(path.join(this.root, name), { recursive: true, force: true });
      }
    }
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  /** Reserve an ID and a private working directory for an upload. */
  async allocate(): Promise<{ id: string; dir: string }> {
    await this.ready;
    const cfg = getConfig();
    const fs = await statfs(this.root);
    if (fs.bavail * fs.bsize < cfg.MIN_FREE_DISK_MB * 1024 * 1024) {
      throw new PublicError("INSUFFICIENT_STORAGE", "The server is low on storage. Please try again later.", 507);
    }
    if (this.queue.length >= cfg.MAX_QUEUED_JOBS) {
      throw new PublicError("SERVER_BUSY", "The server is busy processing other images. Please try again in a minute.", 503);
    }
    const id = randomBytes(16).toString("base64url");
    const dir = path.join(this.root, `${JOB_DIR_PREFIX}${id}`);
    await mkdir(dir, { mode: 0o700 });
    return { id, dir };
  }

  /** Release a directory allocated for an upload that was rejected before becoming a job. */
  async discard(dir: string) {
    await rm(dir, { recursive: true, force: true });
  }

  /** An earlier submission with the same key, unless it failed (a retry should then run again). */
  findByIdempotencyKey(key: string): Job | undefined {
    const id = this.idempotency.get(key);
    const job = id ? this.jobs.get(id) : undefined;
    return job?.status === "failed" ? undefined : job;
  }

  create(n: NewJob): Job {
    const cfg = getConfig();
    const now = Date.now();
    const job: Job = {
      id: n.id,
      status: "queued",
      stage: "queued",
      progress: null,
      createdAt: now,
      // Generous while active; reset to now + TTL when the job finishes.
      expiresAt: now + (cfg.JOB_TIMEOUT_SECONDS + cfg.JOB_TTL_MINUTES * 60) * 1000,
      dir: n.workDir,
      sourcePath: n.sourcePath,
      originalName: n.originalName,
      params: n.params,
      probe: n.probe,
      plan: n.plan,
      warnings: n.warnings,
      output: null,
      error: null,
      abort: new AbortController(),
      idempotencyKey: n.idempotencyKey,
    };
    this.jobs.set(job.id, job);
    if (job.idempotencyKey) this.idempotency.set(job.idempotencyKey, job.id);
    this.queue.push(job.id);
    this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    return JOB_ID_RE.test(id) ? this.jobs.get(id) : undefined;
  }

  isExpired(id: string): boolean {
    return this.tombstones.has(id);
  }

  /** Cancel (if running) and delete a job and its files. */
  async remove(id: string): Promise<boolean> {
    const job = this.get(id);
    if (!job) return false;
    job.abort.abort(new PublicError("CANCELLED", "Processing was cancelled.", 409));
    this.queue = this.queue.filter((q) => q !== id);
    this.forget(job);
    await rm(job.dir, { recursive: true, force: true });
    return true;
  }

  private forget(job: Job) {
    this.jobs.delete(job.id);
    if (job.idempotencyKey && this.idempotency.get(job.idempotencyKey) === job.id) {
      this.idempotency.delete(job.idempotencyKey);
    }
  }

  queuePosition(id: string): number | null {
    const i = this.queue.indexOf(id);
    return i === -1 ? null : i + 1;
  }

  private pump() {
    const cfg = getConfig();
    while (this.running < cfg.MAX_CONCURRENT_JOBS && this.queue.length > 0) {
      const job = this.jobs.get(this.queue.shift()!);
      if (!job || job.abort.signal.aborted) continue;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async run(job: Job) {
    const cfg = getConfig();
    const timeout = setTimeout(
      () => job.abort.abort(new PublicError("PROCESSING_TIMEOUT", "Processing took too long and was stopped. Try a smaller output size.", 504)),
      cfg.JOB_TIMEOUT_SECONDS * 1000,
    );
    const started = Date.now();
    job.status = "processing";
    try {
      const result = await processImage({
        workDir: job.dir,
        sourcePath: job.sourcePath,
        probe: job.probe,
        plan: job.plan,
        format: job.params.format,
        quality: job.params.quality,
        dpi: job.params.dpi,
        engine: getEngine(),
        signal: job.abort.signal,
        onStage: (stage) => {
          job.stage = stage;
          if (stage !== "upscaling") job.progress = null;
        },
        onProgress: (p) => {
          job.progress = p;
        },
      });
      const fmt = OUTPUT_FORMAT_INFO[job.params.format];
      job.output = {
        path: result.outputPath,
        previewPath: result.previewPath,
        width: result.width,
        height: result.height,
        format: job.params.format,
        mime: fmt.mime,
        bytes: result.bytes,
        dpi: result.dpi,
        dpiStorage: result.dpiStorage,
        filename: buildOutputFilename({
          originalName: job.originalName,
          preset: job.plan.preset,
          width: result.width,
          height: result.height,
          dpi: result.dpi,
          format: job.params.format,
        }),
        aiScale: job.plan.aiScale,
        resampled: job.plan.resampled,
        preset: job.plan.preset,
        alphaFlattened: result.alphaFlattened,
        colorProfile: job.probe.source.colorProfile,
        quality: fmt.lossy ? job.params.quality : null,
      };
      job.status = "completed";
      console.info(`[upscaler] job ${job.id} completed in ${Date.now() - started} ms (${result.width}x${result.height})`);
      // Intermediates are no longer needed; keep only source, output and preview.
      await this.pruneIntermediates(job);
    } catch (err) {
      const reason = job.abort.signal.aborted ? job.abort.signal.reason : err;
      job.status = "failed";
      if (reason instanceof PublicError) {
        job.error = { code: reason.code, message: reason.message };
      } else {
        console.error(`[upscaler] job ${job.id} failed:`, reason instanceof Error ? reason.message : reason);
        job.error = { code: "PROCESSING_FAILED", message: "Processing failed due to an internal error." };
      }
      if (this.jobs.has(job.id)) await this.pruneIntermediates(job, true);
    } finally {
      clearTimeout(timeout);
      job.progress = null;
      job.expiresAt = Date.now() + cfg.JOB_TTL_MINUTES * 60 * 1000;
    }
  }

  private async pruneIntermediates(job: Job, all = false) {
    const keep = all ? new Set<string>() : new Set([job.sourcePath, job.output?.path, job.output?.previewPath]);
    for (const name of await readdir(job.dir).catch(() => [] as string[])) {
      const file = path.join(job.dir, name);
      if (!keep.has(file)) await rm(file, { force: true });
    }
  }

  /** Delete expired jobs and their files. */
  async sweep(now = Date.now()) {
    for (const job of [...this.jobs.values()]) {
      if (job.status !== "queued" && job.status !== "processing" && job.expiresAt <= now) {
        this.forget(job);
        this.tombstones.set(job.id, now);
        await rm(job.dir, { recursive: true, force: true });
      }
    }
    for (const [id, at] of this.tombstones) if (now - at > TOMBSTONE_MS) this.tombstones.delete(id);
  }

  toResponse(job: Job): JobStatusResponse {
    const { secret } = getConfig();
    const done = job.status === "completed" && job.output;
    let output: OutputInfo | null = null;
    if (done) {
      // Internal paths stay on the server.
      const { path, previewPath, ...publicInfo } = job.output!;
      void path;
      void previewPath;
      output = publicInfo;
    }
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      queuePosition: job.status === "queued" ? this.queuePosition(job.id) : null,
      createdAt: new Date(job.createdAt).toISOString(),
      expiresAt: new Date(job.expiresAt).toISOString(),
      engine: getEngine().capabilities.label,
      requested: {
        scale: job.params.scale,
        width: job.params.width,
        height: job.params.height,
        dpi: job.params.dpi,
        format: job.params.format,
      },
      source: job.probe.source,
      warnings: job.warnings,
      output,
      downloadUrl: done ? signedUrl(secret, job.id, "download", job.expiresAt) : null,
      previewUrl: done ? signedUrl(secret, job.id, "preview", job.expiresAt) : null,
      error: job.error,
    };
  }
}

// Route handlers may be bundled separately; keep one manager per process.
const globalForJobs = globalThis as unknown as { __upscalerJobs?: JobManager };

export function getJobManager(): JobManager {
  return (globalForJobs.__upscalerJobs ??= new JobManager());
}

export function isValidJobId(id: string) {
  return JOB_ID_RE.test(id);
}
