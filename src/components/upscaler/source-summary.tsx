"use client";

import { RefreshCw, Trash2 } from "lucide-react";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE, INPUT_FORMAT_LABEL } from "@/lib/shared/formats";
import { formatAspectRatio, formatPixelCount } from "@/lib/shared/dimensions";
import { formatBytes, type SourceImage } from "@/lib/client/source-image";
import { Stat } from "./section";

export function SourceSummary({
  source,
  onReplace,
  onRemove,
  disabled,
}: {
  source: SourceImage;
  onReplace: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not optimisable */}
        <img
          src={source.previewUrl}
          alt=""
          className="checkerboard size-16 shrink-0 rounded-lg border object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={source.name}>
            {source.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatBytes(source.bytes)} · {INPUT_FORMAT_LABEL[source.format]}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {source.hasAlpha && <Badge variant="secondary">Transparency</Badge>}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/60 p-3">
        <Stat label="Original size" value={`${source.width.toLocaleString("en-US")} × ${source.height.toLocaleString("en-US")} px`} />
        <Stat label="Aspect ratio" value={formatAspectRatio(source)} />
        <Stat label="Pixels" value={formatPixelCount(source)} className="col-span-2" />
      </dl>

      <div className="flex gap-2">
        <Button variant="outline" size="lg" className="flex-1" onClick={() => input.current?.click()} disabled={disabled}>
          <RefreshCw /> Replace
        </Button>
        <Button variant="outline" size="lg" className="flex-1" onClick={onRemove} disabled={disabled}>
          <Trash2 /> Remove
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a replacement image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onReplace(file);
        }}
      />
    </div>
  );
}
