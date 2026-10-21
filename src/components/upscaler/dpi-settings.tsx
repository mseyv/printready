"use client";

import { Info } from "lucide-react";
import { formatNumber, printSize, type Size } from "@/lib/shared/dimensions";
import { DPI_PRESETS } from "@/lib/shared/schema";
import type { Issue } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";
import { NumberField } from "./number-field";

const PRESET_HINT: Record<number, string> = {
  72: "Legacy screen",
  96: "Screen",
  150: "Large prints, posters",
  300: "Photo & offset print",
  600: "Fine art, line art",
};

export function DpiSettings({
  size,
  dpi,
  onChange,
  errors,
  warnings,
  disabled,
}: {
  size: Size;
  dpi: number;
  onChange: (dpi: number) => void;
  errors: Issue[];
  warnings: Issue[];
  disabled?: boolean;
}) {
  const valid = errors.length === 0 && dpi > 0;
  const print = valid ? printSize(size, dpi) : null;
  const hasSize = size.width > 0 && size.height > 0;

  return (
    <div className="space-y-4">
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-xs text-muted-foreground">Presets</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {DPI_PRESETS.map((p) => (
            <label
              key={p}
              title={PRESET_HINT[p]}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors",
                "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                dpi === p ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="dpi-preset"
                value={p}
                checked={dpi === p}
                onChange={() => onChange(p)}
                className="sr-only"
                aria-label={`${p} DPI — ${PRESET_HINT[p]}`}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <NumberField
        id="dpi"
        label={
          <>
            Target DPI {DPI_PRESETS.includes(dpi as (typeof DPI_PRESETS)[number]) ? `· ${PRESET_HINT[dpi]}` : "· custom"}
          </>
        }
        unit="DPI"
        value={dpi}
        onCommit={onChange}
        invalid={errors.length > 0}
        describedBy="dpi-help"
        disabled={disabled}
      />
      <IssueList issues={errors} tone="error" />

      <div className="rounded-lg border bg-muted/40 p-3" aria-live="polite">
        <p className="text-xs text-muted-foreground">Estimated print size</p>
        {print && hasSize ? (
          <p className="mt-1 text-sm font-medium tabular-nums">
            {formatNumber(print.widthCm)} × {formatNumber(print.heightCm)} cm
            <span className="mx-1.5 text-muted-foreground">·</span>
            {formatNumber(print.widthIn)} × {formatNumber(print.heightIn)} in
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">—</p>
        )}
        {hasSize && valid && (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {size.width.toLocaleString("en-US")} px ÷ {dpi} DPI = {formatNumber(size.width / dpi)} in wide
          </p>
        )}
      </div>

      <p id="dpi-help" className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          DPI is print metadata. It does not add pixels or detail — the pixel dimensions above do. Together they determine the
          physical size at which the image prints.
        </span>
      </p>
      <IssueList issues={warnings} tone="warning" />
    </div>
  );
}
