"use client";

import { AlertCircle, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { matchPreset } from "@/lib/shared/dimensions";
import { ACCEPT_ATTRIBUTE, OUTPUT_FORMAT_INFO } from "@/lib/shared/formats";
import type { Issue } from "@/lib/shared/plan";
import { CompareViewer } from "./compare-viewer";
import { DpiSettings } from "./dpi-settings";
import { Dropzone, pickFile } from "./dropzone";
import { ExportSettings } from "./export-settings";
import { FactorPicker } from "./factor-picker";
import { IssueList } from "./issue-list";
import { OutputDimensions } from "./output-dimensions";
import { ProcessingPanel } from "./processing-panel";
import { ResultPanel } from "./result-panel";
import { Section } from "./section";
import { SourceSummary } from "./source-summary";
import { useUpscaler } from "./use-upscaler";

const by = (issues: Issue[] | undefined, pred: (i: Issue) => boolean) => (issues ?? []).filter(pred);

export function Upscaler() {
  const u = useUpscaler();
  const { config, source, settings, validation, run, busy } = u;
  const fileInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Clipboard paste anywhere on the page (ignored while typing in a field).
  const { selectFile } = u;
  useEffect(() => {
    if (busy) return;
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]")) return;
      const file = pickFile(e.clipboardData?.items);
      if (!file) return;
      e.preventDefault();
      const name = file.name && file.name !== "image.png" ? file.name : "pasted-image.png";
      void selectFile(new File([file], name, { type: file.type }));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [selectFile, busy]);

  // On narrow screens the workspace is below the button: bring results into view.
  useEffect(() => {
    if (run.phase !== "completed" && run.phase !== "failed") return;
    const el = resultRef.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [run.phase]);

  const errors = validation?.errors;
  const warnings = validation?.warnings;
  const dpiErrors = by(errors, (i) => i.field === "dpi");
  const dpiWarnings = by(warnings, (i) => i.field === "dpi");
  const formatWarnings = by(warnings, (i) => i.field === "format");
  const generalErrors = by(errors, (i) => i.field === "image" || i.field === "engine" || (i.field === "format" && i.code !== "FORMAT_SIDE_LIMIT"));
  const canSubmit = Boolean(source && validation?.plan && !busy);
  const custom = source ? matchPreset(source, settings.size) !== settings.factor : false;

  const settingsDisabled = busy || !source;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* ---------------- Settings column ---------------- */}
      <div className="space-y-4">
        {u.configError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Service unavailable</AlertTitle>
            <AlertDescription>
              {u.configError}
              <Button variant="outline" size="sm" className="mt-2" onClick={u.reloadConfig}>
                <RotateCw /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {config && !config.engine.configured && (
          <Alert>
            <AlertCircle />
            <AlertTitle>AI processing is not configured</AlertTitle>
            <AlertDescription>
              {config.engine.reason} You can still explore the settings; see the README to configure Real-ESRGAN or a hosted
              inference provider.
            </AlertDescription>
          </Alert>
        )}

        <Section step={1} title="Image" description={source ? undefined : "Your image is only uploaded when you start upscaling."}>
          {source ? (
            <SourceSummary source={source} onReplace={u.selectFile} onRemove={u.removeSource} disabled={busy || u.loadingSource} />
          ) : (
            <>
              <div className="lg:hidden">
                <Dropzone onFile={u.selectFile} loading={u.loadingSource} maxBytes={config?.limits.maxUploadBytes} compact />
              </div>
              <p className="hidden text-sm text-muted-foreground lg:block">
                Drop an image on the preview area, paste it, or{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => fileInput.current?.click()}
                  disabled={!config}
                >
                  choose a file
                </button>
                .
              </p>
            </>
          )}
          {u.sourceError && (
            <p role="alert" className="mt-3 flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-[13px] text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {u.sourceError}
            </p>
          )}
        </Section>

        <Section step={2} title="Upscale factor" description="Applies to width and height.">
          <FactorPicker original={source} value={settings.factor} custom={custom} onChange={u.setFactor} disabled={settingsDisabled} />
        </Section>

        <Section step={3} title="Output Dimensions" description="Exact pixel size of the final image.">
          {source ? (
            <OutputDimensions
              original={source}
              size={settings.size}
              factor={settings.factor}
              locked={settings.locked}
              plan={validation?.plan ?? null}
              errors={errors ?? []}
              warnings={warnings ?? []}
              onEdit={u.editDimension}
              onLockChange={u.setLocked}
              onReset={u.resetToPreset}
              disabled={busy}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Upload an image to set the output size.</p>
          )}
        </Section>

        <Section step={4} title="Output Resolution (DPI)" description="Print metadata written into the file.">
          <DpiSettings
            size={settings.size}
            dpi={settings.dpi}
            onChange={(dpi) => u.update({ dpi })}
            errors={dpiErrors}
            warnings={dpiWarnings}
            disabled={busy}
          />
        </Section>

        <Section step={5} title="Export">
          <ExportSettings
            format={settings.format}
            quality={settings.quality}
            onChange={u.update}
            warnings={formatWarnings}
            disabled={busy}
          />
        </Section>

        <div className="space-y-3 lg:sticky lg:bottom-0 lg:z-20 lg:-mx-2 lg:rounded-t-xl lg:border-x lg:border-t lg:bg-background/95 lg:p-3 lg:pb-4 lg:shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)] lg:backdrop-blur">
          <IssueList issues={generalErrors} tone="error" />
          <Button size="lg" className="h-12 w-full text-base shadow-sm" disabled={!canSubmit} onClick={() => void u.submit()}>
            <Sparkles className="size-4" />
            {busy ? "Processing…" : run.phase === "completed" ? "Upscale again with these settings" : "Upscale Image"}
          </Button>
          {source && validation?.plan && (
            <p className="text-center text-xs text-muted-foreground tabular-nums">
              {settings.size.width.toLocaleString("en-US")} × {settings.size.height.toLocaleString("en-US")} px · {settings.dpi} DPI ·{" "}
              {OUTPUT_FORMAT_INFO[settings.format].label}
            </p>
          )}
        </div>
      </div>

      {/* ---------------- Workspace column ---------------- */}
      <div ref={resultRef} className="scroll-mt-4 space-y-4 lg:sticky lg:top-4" aria-label="Preview and results" role="region">
        {!source && (
          <div className="hidden lg:block">
            <Dropzone onFile={u.selectFile} loading={u.loadingSource} maxBytes={config?.limits.maxUploadBytes} />
          </div>
        )}

        {source && run.phase === "completed" && (
          <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-label="Result">
            <CompareViewer
              beforeSrc={source.previewUrl}
              afterSrc={run.job.previewUrl!}
              width={run.job.output!.width}
              height={run.job.output!.height}
            />
            <ResultPanel
              job={run.job}
              expired={run.expired}
              onAdjust={u.backToSettings}
              onUploadAnother={() => fileInput.current?.click()}
              onRemove={u.removeSource}
            />
          </section>
        )}

        {source && run.phase !== "completed" && (
          <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-label="Original preview">
            {run.phase === "failed" && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{run.code === "JOB_EXPIRED" ? "Result expired" : "Upscaling failed"}</AlertTitle>
                <AlertDescription>
                  <p>{run.message}</p>
                  {run.issues && run.issues.length > 1 && (
                    <ul className="mt-1 list-disc pl-4">
                      {run.issues.slice(1).map((i) => (
                        <li key={i.code + i.message}>{i.message}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    {run.retryable ? (
                      <Button variant="outline" size="sm" onClick={() => void u.submit()} disabled={!canSubmit}>
                        <RotateCw /> Try again
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => void u.checkAgain()}>
                        <RotateCw /> Check again
                      </Button>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <div className="relative">
              <div className="checkerboard grid max-h-[70vh] min-h-56 place-items-center overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img
                  src={source.previewUrl}
                  alt={`Original image, ${source.width} by ${source.height} pixels`}
                  className={`max-h-[70vh] w-auto max-w-full object-contain transition-opacity ${busy ? "opacity-40" : ""}`}
                />
              </div>
              {(run.phase === "uploading" || run.phase === "processing") && (
                <div className="absolute inset-0 grid place-items-center p-4">
                  <ProcessingPanel run={run} onCancel={u.cancel} />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              Original · {source.width.toLocaleString("en-US")} × {source.height.toLocaleString("en-US")} px
              {run.phase === "idle" && config?.engine.configured ? ` · will be processed by ${config.engine.label}` : ""}
            </p>
          </section>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void u.selectFile(file);
        }}
      />
    </div>
  );
}
