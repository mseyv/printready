"use client";

import { Slider } from "@/components/ui/slider";
import { OUTPUT_FORMATS, OUTPUT_FORMAT_INFO, type OutputFormat } from "@/lib/shared/formats";
import type { Issue } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";

const FORMAT_HINT: Record<OutputFormat, string> = {
  png: "Lossless · recommended",
  jpeg: "Small · no transparency",
  webp: "Small · transparency",
  tiff: "Lossless · print workflows",
};

export function ExportSettings({
  format,
  quality,
  onChange,
  warnings,
  disabled,
}: {
  format: OutputFormat;
  quality: number;
  onChange: (patch: { format?: OutputFormat; quality?: number }) => void;
  warnings: Issue[];
  disabled?: boolean;
}) {
  const info = OUTPUT_FORMAT_INFO[format];
  return (
    <div className="space-y-4">
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <legend className="sr-only">Output format</legend>
        {OUTPUT_FORMATS.map((f) => (
          <label
            key={f}
            className={cn(
              "flex cursor-pointer flex-col rounded-lg border px-3 py-2 transition-colors",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
              format === f ? "border-foreground bg-muted/60 shadow-[inset_0_0_0_1px_var(--foreground)]" : "hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name="format"
              value={f}
              checked={format === f}
              onChange={() => onChange({ format: f })}
              className="sr-only"
            />
            <span className="text-sm font-semibold">{OUTPUT_FORMAT_INFO[f].label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{FORMAT_HINT[f]}</span>
          </label>
        ))}
      </fieldset>

      {info.lossy && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span id="quality-label" className="text-xs text-muted-foreground">
              {info.label} quality
            </span>
            <span className="text-sm font-medium tabular-nums">{quality}</span>
          </div>
          <Slider
            aria-labelledby="quality-label"
            min={50}
            max={100}
            step={1}
            value={[quality]}
            onValueChange={(v) => onChange({ quality: Array.isArray(v) ? v[0] : (v as number) })}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {quality >= 90 ? "High quality, full chroma resolution." : quality >= 75 ? "Balanced size and quality." : "Smaller file, visible compression."}
          </p>
        </div>
      )}
      <IssueList issues={warnings} tone="warning" />
    </div>
  );
}
