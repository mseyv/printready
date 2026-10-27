"use client";

import { CheckCircle2, Download, ImagePlus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatNumber, formatPixelCount, formatScale, printSize } from "@/lib/shared/dimensions";
import { INPUT_FORMAT_LABEL, OUTPUT_FORMAT_INFO } from "@/lib/shared/formats";
import { FACE_ENHANCER_LABEL, MODEL_INFO } from "@/lib/shared/models";
import type { JobStatusResponse } from "@/lib/shared/schema";
import { formatBytes } from "@/lib/client/source-image";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";
import { Stat } from "./section";

const fmtSize = (w: number, h: number) => `${w.toLocaleString("en-US")} × ${h.toLocaleString("en-US")} px`;

export function ResultPanel({
  job,
  expired,
  onAdjust,
  onUploadAnother,
  onRemove,
}: {
  job: JobStatusResponse;
  expired: boolean;
  onAdjust: () => void;
  onUploadAnother: () => void;
  onRemove: () => void;
}) {
  const out = job.output!;
  const src = job.source;
  const print = printSize(out, out.dpi);
  const scaleX = out.width / src.width;
  const scaleY = out.height / src.height;
  const fmt = OUTPUT_FORMAT_INFO[out.format];
  const expiresAt = new Date(job.expiresAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Upscaled and verified
        </p>
        <p className="text-xs text-muted-foreground">
          {expired ? "This result has expired." : `Available until ${expiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, then deleted`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4 sm:grid-cols-3">
        <Stat label="Original" value={fmtSize(src.width, src.height)} />
        <Stat label="Final" value={fmtSize(out.width, out.height)} />
        <Stat
          label="Upscale"
          value={
            out.preset ? (
              `×${out.preset} preset`
            ) : (
              <span>
                Custom {Math.abs(scaleX - scaleY) < 0.01 ? formatScale(scaleX) : `${formatScale(scaleX)} × ${formatScale(scaleY)}`}
              </span>
            )
          }
        />
        <Stat label="Output DPI" value={`${out.dpi} DPI${out.dpiStorage === "exif" ? " (EXIF)" : ""}`} />
        <Stat
          label="Print size"
          value={`${formatNumber(print.widthCm)} × ${formatNumber(print.heightCm)} cm`}
        />
        <Stat label="Print size (in)" value={`${formatNumber(print.widthIn)} × ${formatNumber(print.heightIn)} in`} />
        <Stat label="Format" value={`${fmt.label}${out.quality ? ` · quality ${out.quality}` : ""}`} />
        <Stat label="File size" value={formatBytes(out.bytes)} />
        <Stat label="Pixels" value={formatPixelCount(out).replace(/^.*\(/, "").replace(")", "")} />
      </dl>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="outline">{MODEL_INFO[job.requested.model].label} ×{out.aiScale}{out.resampled ? " + Lanczos" : ""}</Badge>
        {job.requested.faceEnhance && <Badge variant="outline">{FACE_ENHANCER_LABEL[job.requested.faceEnhance]} face enhancement</Badge>}
        {job.requested.tileSize && <Badge variant="outline">Tiles {job.requested.tileSize} px</Badge>}
        <Badge variant="outline">Source {INPUT_FORMAT_LABEL[src.format]}</Badge>
        {src.orientation !== 1 && <Badge variant="outline">EXIF orientation applied</Badge>}
        {out.colorProfile === "preserved" && <Badge variant="outline">Colour profile preserved</Badge>}
        {out.colorProfile === "converted-to-srgb" && <Badge variant="outline">Converted to sRGB</Badge>}
        {out.alphaFlattened && <Badge variant="outline">Transparency → white</Badge>}
        {src.hasAlpha && !out.alphaFlattened && <Badge variant="outline">Transparency preserved</Badge>}
      </div>

      <IssueList issues={job.warnings.filter((w) => w.code !== "DPI_EXIF_ONLY")} tone="warning" />

      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={expired ? undefined : job.downloadUrl!}
          download={out.filename}
          aria-disabled={expired}
          className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1 text-[15px]", expired && "pointer-events-none opacity-50")}
        >
          <Download /> Download {fmt.label}
          <span className="font-normal opacity-70">· {formatBytes(out.bytes)}</span>
        </a>
        <Button variant="outline" size="lg" className="h-11" onClick={onAdjust}>
          <SlidersHorizontal /> Adjust & process again
        </Button>
      </div>
      <p className="truncate text-xs text-muted-foreground" title={out.filename}>
        {out.filename}
      </p>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button variant="ghost" size="lg" onClick={onUploadAnother}>
          <ImagePlus /> Upload another image
        </Button>
        <Button variant="ghost" size="lg" onClick={onRemove}>
          <Trash2 /> Remove image
        </Button>
      </div>
    </div>
  );
}
