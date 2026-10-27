"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyDimensionEdit,
  DEFAULT_FACTOR,
  heightForWidth,
  scaleSize,
  type Size,
  type UpscaleFactor,
} from "@/lib/shared/dimensions";
import type { OutputFormat } from "@/lib/shared/formats";
import { DEFAULT_TILE_SIZE, type EnhanceOptions, type FaceEnhancer, type ModelId, type TileSize } from "@/lib/shared/models";
import { planUpscale, type Issue, type PlanResult } from "@/lib/shared/plan";
import {
  DEFAULT_DPI,
  DEFAULT_FORMAT,
  DEFAULT_QUALITY,
  type JobStatusResponse,
  type PublicConfig,
} from "@/lib/shared/schema";
import { ApiError, createJob, deleteJob, getConfig, getJob } from "@/lib/client/api";
import { loadSourceImage, SourceError, type SourceImage } from "@/lib/client/source-image";

export interface Settings {
  factor: UpscaleFactor;
  size: Size;
  locked: boolean;
  dpi: number;
  format: OutputFormat;
  quality: number;
  model: ModelId;
  faceEnhance: boolean;
  faceModel: FaceEnhancer;
  tiling: boolean;
  tileSize: TileSize;
}

export type RunState =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "processing"; job: JobStatusResponse; connectionLost: boolean }
  | { phase: "completed"; job: JobStatusResponse; expired: boolean }
  | { phase: "failed"; code: string; message: string; issues?: Issue[]; retryable: boolean };

const INITIAL_SETTINGS: Settings = {
  factor: DEFAULT_FACTOR,
  size: { width: 0, height: 0 },
  locked: true,
  dpi: DEFAULT_DPI,
  format: DEFAULT_FORMAT,
  quality: DEFAULT_QUALITY,
  model: "realesrgan-x4plus",
  faceEnhance: false,
  faceModel: "gfpgan",
  tiling: false,
  tileSize: DEFAULT_TILE_SIZE,
};

/** What the server receives for the enhancement settings (switches off → null). */
export function enhanceOptions(s: Settings): EnhanceOptions {
  return {
    model: s.model,
    faceEnhance: s.faceEnhance ? s.faceModel : null,
    tileSize: s.tiling ? s.tileSize : null,
  };
}

/** Give up polling after this long without any successful response. */
const MAX_OFFLINE_MS = 120_000;

/** Random request key. `crypto.randomUUID` only exists in secure contexts (HTTPS/localhost), so it breaks on plain-HTTP LAN access. */
function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useUpscaler() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [run, setRun] = useState<RunState>({ phase: "idle" });

  const idempotencyKey = useRef<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);

  // ---- configuration --------------------------------------------------------
  // Resolves with the config (or null on failure), so a file chosen before it loads is not dropped.
  const configPromise = useRef<Promise<PublicConfig | null> | null>(null);
  const fetchConfig = useCallback(
    () =>
      (configPromise.current = getConfig().then(
        (c) => {
          setConfig(c);
          const face = c.engine.faceEnhancers[0];
          setSettings((s) => ({ ...s, model: c.engine.defaultModel, faceModel: face ?? s.faceModel }));
          return c;
        },
        (err: unknown) => {
          setConfigError(err instanceof ApiError ? err.message : "Could not load the service configuration.");
          return null;
        },
      )),
    [],
  );
  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);
  const loadConfig = useCallback(() => {
    setConfigError(null);
    void fetchConfig();
  }, [fetchConfig]);

  // ---- source image ---------------------------------------------------------
  const discardJob = useCallback(() => {
    uploadAbort.current?.abort();
    if (jobId.current) void deleteJob(jobId.current);
    jobId.current = null;
    idempotencyKey.current = null;
    setRun({ phase: "idle" });
  }, []);

  const selectFile = useCallback(
    async (file: File) => {
      setSourceError(null);
      setLoadingSource(true);
      try {
        const cfg = config ?? (await configPromise.current);
        if (!cfg) throw new SourceError("The service configuration could not be loaded. Please retry.");
        const next = await loadSourceImage(file, cfg);
        discardJob();
        setSource((prev) => {
          if (prev?.ownsUrl) URL.revokeObjectURL(prev.previewUrl);
          return next;
        });
        setSettings((s) => ({ ...s, size: scaleSize(next, s.factor), locked: true }));
      } catch (err) {
        setSourceError(err instanceof SourceError ? err.message : "The file could not be opened.");
      } finally {
        setLoadingSource(false);
      }
    },
    [config, discardJob],
  );

  const removeSource = useCallback(() => {
    discardJob();
    setSource((prev) => {
      if (prev?.ownsUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setSourceError(null);
    setSettings((s) => ({ ...s, size: { width: 0, height: 0 } }));
  }, [discardJob]);

  // Revoke the object URL on unmount.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);
  useEffect(
    () => () => {
      if (sourceRef.current?.ownsUrl) URL.revokeObjectURL(sourceRef.current.previewUrl);
    },
    [],
  );

  // ---- settings -------------------------------------------------------------
  const settingsChanged = useCallback(() => {
    // New settings = new logical submission.
    idempotencyKey.current = null;
  }, []);

  const setFactor = useCallback(
    (factor: UpscaleFactor) => {
      settingsChanged();
      setSettings((s) => ({ ...s, factor, size: source ? scaleSize(source, factor) : s.size, locked: true }));
    },
    [source, settingsChanged],
  );

  const editDimension = useCallback(
    (axis: "width" | "height", value: number) => {
      if (!source) return;
      settingsChanged();
      setSettings((s) => ({ ...s, size: applyDimensionEdit(source, s.size, { axis, value }, s.locked) }));
    },
    [source, settingsChanged],
  );

  const setLocked = useCallback(
    (locked: boolean) => {
      settingsChanged();
      setSettings((s) => {
        // Re-locking snaps the height back to the original ratio for the current width.
        if (locked && source) return { ...s, locked, size: { width: s.size.width, height: heightForWidth(source, s.size.width) } };
        return { ...s, locked };
      });
    },
    [source, settingsChanged],
  );

  const resetToPreset = useCallback(() => {
    if (source) setFactor(settings.factor);
  }, [source, settings.factor, setFactor]);

  const update = useCallback(
    (patch: Partial<Omit<Settings, "factor" | "size" | "locked">>) => {
      settingsChanged();
      setSettings((s) => ({ ...s, ...patch }));
    },
    [settingsChanged],
  );

  // ---- validation -----------------------------------------------------------
  const validation: PlanResult | null = useMemo(() => {
    if (!source || !config) return null;
    return planUpscale({
      original: source,
      target: settings.size,
      format: settings.format,
      dpi: settings.dpi,
      hasAlpha: source.hasAlpha,
      options: enhanceOptions(settings),
      engine: config.engine,
      limits: config.limits,
    });
  }, [source, config, settings]);

  // ---- submission -----------------------------------------------------------
  const busy = run.phase === "uploading" || run.phase === "processing";

  const submit = useCallback(async () => {
    if (!source || !validation?.plan || busy) return;
    if (jobId.current && run.phase === "completed") void deleteJob(jobId.current);
    jobId.current = null;
    idempotencyKey.current ??= randomKey();
    const ac = new AbortController();
    uploadAbort.current = ac;
    setRun({ phase: "uploading", progress: 0 });
    try {
      const { job } = await createJob(
        {
          file: source.file,
          scale: settings.factor,
          width: settings.size.width,
          height: settings.size.height,
          lockAspect: settings.locked,
          dpi: settings.dpi,
          format: settings.format,
          quality: settings.quality,
          options: enhanceOptions(settings),
          idempotencyKey: idempotencyKey.current,
        },
        (progress) => setRun({ phase: "uploading", progress }),
        ac.signal,
      );
      jobId.current = job.id;
      setRun(stateForJob(job));
    } catch (err) {
      if (err instanceof ApiError && err.code === "ABORTED") return;
      const e = err instanceof ApiError ? err : new ApiError("UNKNOWN", "Upload failed.", 0);
      setRun({
        phase: "failed",
        code: e.code,
        message: e.message,
        issues: e.issues,
        // Same idempotency key is reused on retry, so a request that did reach the server is not duplicated.
        retryable: e.isNetwork || e.status === 429 || e.status === 503 || e.status >= 500,
      });
    } finally {
      uploadAbort.current = null;
    }
  }, [source, validation, busy, run.phase, settings]);

  const cancel = useCallback(() => discardJob(), [discardJob]);

  const backToSettings = useCallback(() => {
    if (jobId.current) void deleteJob(jobId.current);
    jobId.current = null;
    idempotencyKey.current = null;
    setRun({ phase: "idle" });
  }, []);

  // ---- polling --------------------------------------------------------------
  const pollingId = run.phase === "processing" ? run.job.id : null;
  useEffect(() => {
    if (!pollingId) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastOk = Date.now();
    let delay = 1000;

    const tick = async () => {
      try {
        const job = await getJob(pollingId, ac.signal);
        lastOk = Date.now();
        delay = 1000;
        setRun(stateForJob(job));
        if (job.status === "queued" || job.status === "processing") timer = setTimeout(tick, delay);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
          setRun({ phase: "failed", code: err.code, message: err.message, retryable: true });
          return;
        }
        if (Date.now() - lastOk > MAX_OFFLINE_MS) {
          setRun({
            phase: "failed",
            code: "NETWORK_ERROR",
            message: "Lost connection to the server while processing. Your image may still be processing — try checking again.",
            retryable: false,
          });
          return;
        }
        setRun((r) => (r.phase === "processing" ? { ...r, connectionLost: true } : r));
        delay = Math.min(delay * 2, 10_000);
        timer = setTimeout(tick, delay);
      }
    };
    timer = setTimeout(tick, delay);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [pollingId]);

  /** Resume polling after a lost connection. */
  const checkAgain = useCallback(async () => {
    if (!jobId.current) return;
    try {
      setRun(stateForJob(await getJob(jobId.current)));
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("UNKNOWN", "Could not reach the server.", 0);
      setRun({ phase: "failed", code: e.code, message: e.message, retryable: e.status === 404 || e.status === 410 });
    }
  }, []);

  // ---- expiry ---------------------------------------------------------------
  const expiresAt = run.phase === "completed" ? run.job.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const mark = () => setRun((r) => (r.phase === "completed" ? { ...r, expired: true } : r));
    if (ms <= 0) {
      mark();
      return;
    }
    const t = setTimeout(mark, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [expiresAt]);

  return {
    config,
    configError,
    reloadConfig: loadConfig,
    source,
    loadingSource,
    sourceError,
    selectFile,
    removeSource,
    settings,
    setFactor,
    editDimension,
    setLocked,
    resetToPreset,
    update,
    validation,
    run,
    busy,
    submit,
    cancel,
    backToSettings,
    checkAgain,
  };
}

function stateForJob(job: JobStatusResponse): RunState {
  switch (job.status) {
    case "completed":
      return { phase: "completed", job, expired: false };
    case "failed":
      return {
        phase: "failed",
        code: job.error?.code ?? "PROCESSING_FAILED",
        message: job.error?.message ?? "Processing failed.",
        retryable: true,
      };
    default:
      return { phase: "processing", job, connectionLost: false };
  }
}

export type Upscaler = ReturnType<typeof useUpscaler>;
