"use client";

import { Loader2, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JobStage } from "@/lib/shared/schema";
import type { RunState } from "./use-upscaler";

const STAGE_LABEL: Record<JobStage, string> = {
  queued: "Waiting in queue",
  preparing: "Preparing image (orientation, colour, transparency)",
  upscaling: "Running AI super-resolution",
  resampling: "Resampling to the exact output size",
  encoding: "Encoding file and writing DPI metadata",
  verifying: "Verifying dimensions and metadata",
};

function useElapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ProcessingPanel({
  run,
  onCancel,
}: {
  run: Extract<RunState, { phase: "uploading" | "processing" }>;
  onCancel: () => void;
}) {
  const elapsed = useElapsed();
  let label: string;
  let progress: number | null;
  let detail: string | null = null;

  if (run.phase === "uploading") {
    label = run.progress < 1 ? "Uploading image" : "Validating upload";
    progress = run.progress < 1 ? run.progress : null;
  } else {
    const { job } = run;
    label = STAGE_LABEL[job.stage];
    progress = job.stage === "upscaling" ? job.progress : null;
    if (job.status === "queued" && job.queuePosition) detail = `Position ${job.queuePosition} in queue`;
    else if (job.stage === "upscaling") detail = job.engine;
  }

  return (
    <div className="w-full max-w-sm rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}…</p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {detail ? `${detail} · ` : ""}
            {elapsed} elapsed
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel processing">
          <X />
        </Button>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
      >
        {progress === null ? (
          <div className="animate-indeterminate h-full w-2/5 rounded-full bg-foreground/70" />
        ) : (
          <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${Math.max(2, progress * 100)}%` }} />
        )}
      </div>
      {progress !== null && <p className="mt-1.5 text-right text-xs tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</p>}

      {run.phase === "processing" && run.connectionLost && (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
          <WifiOff className="size-3.5 shrink-0" aria-hidden /> Connection lost — retrying. Processing continues on the server.
        </p>
      )}
    </div>
  );
}
