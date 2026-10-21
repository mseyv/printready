"use client";

import { Link2, Link2Off, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  effectiveScale,
  formatAspectRatio,
  formatPixelCount,
  formatScale,
  matchPreset,
  type Size,
  type UpscaleFactor,
} from "@/lib/shared/dimensions";
import type { Issue, UpscalePlan } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";
import { NumberField } from "./number-field";
import { Stat } from "./section";

const DIMENSION_CODES = new Set([
  "OUTPUT_TOO_SMALL",
  "OUTPUT_SIDE_TOO_LARGE",
  "FORMAT_SIDE_LIMIT",
  "OUTPUT_PIXELS_TOO_LARGE",
  "NOT_AN_UPSCALE",
  "SCALE_TOO_LARGE",
  "AI_PASS_TOO_LARGE",
  "ASPECT_CHANGED",
]);

export function OutputDimensions({
  original,
  size,
  factor,
  locked,
  plan,
  errors,
  warnings,
  onEdit,
  onLockChange,
  onReset,
  disabled,
}: {
  original: Size;
  size: Size;
  factor: UpscaleFactor;
  locked: boolean;
  plan: UpscalePlan | null;
  errors: Issue[];
  warnings: Issue[];
  onEdit: (axis: "width" | "height", value: number) => void;
  onLockChange: (locked: boolean) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  const preset = matchPreset(original, size);
  const custom = preset !== factor;
  const scale = effectiveScale(original, size);
  const uniform = Math.abs(scale.x - scale.y) < 0.01;
  const dimErrors = errors.filter((e) => DIMENSION_CODES.has(e.code));
  const dimWarnings = warnings.filter((w) => DIMENSION_CODES.has(w.code));
  const widthInvalid = dimErrors.some((e) => e.field === "width");
  const heightInvalid = dimErrors.some((e) => e.field === "height");

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <NumberField
          id="out-width"
          label="Final width"
          unit="px"
          value={size.width}
          onCommit={(v) => onEdit("width", v)}
          invalid={widthInvalid}
          describedBy="dims-status"
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant={locked ? "secondary" : "outline"}
          size="icon-lg"
          className="mb-0.5 size-10"
          aria-pressed={locked}
          aria-label={locked ? "Aspect ratio locked. Click to unlock." : "Aspect ratio unlocked. Click to lock."}
          title={locked ? "Aspect ratio locked" : "Aspect ratio unlocked"}
          onClick={() => onLockChange(!locked)}
          disabled={disabled}
        >
          {locked ? <Link2 /> : <Link2Off />}
        </Button>
        <NumberField
          id="out-height"
          label="Final height"
          unit="px"
          value={size.height}
          onCommit={(v) => onEdit("height", v)}
          invalid={heightInvalid}
          describedBy="dims-status"
          disabled={disabled}
          className="flex-1"
        />
      </div>

      <div
        id="dims-status"
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px]",
          custom ? "bg-sky-500/10 text-sky-900 dark:text-sky-200" : "bg-muted/60",
        )}
        aria-live="polite"
      >
        {custom ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge className="bg-sky-600 text-white dark:bg-sky-500">Custom size</Badge>
            <span>
              {preset ? (
                <>Matches the ×{preset} preset, not the selected ×{factor}.</>
              ) : uniform ? (
                <>Effective scale {formatScale(scale.x)} — overrides the ×{factor} preset.</>
              ) : (
                <>
                  {formatScale(scale.x)} wide × {formatScale(scale.y)} high — overrides ×{factor}.
                </>
              )}
            </span>
          </span>
        ) : (
          <span>
            Exactly <strong className="font-semibold">×{factor}</strong> of the original
          </span>
        )}
        {custom && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled} className="-my-1">
            <RotateCcw /> Reset to ×{factor}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Aspect ratio" value={`${formatAspectRatio(size)}${locked ? " · locked" : ""}`} />
        <Stat label="Total pixels" value={formatPixelCount(size)} />
        {plan && (
          <Stat
            className="col-span-2 [&>dd]:whitespace-normal"
            label="Processing"
            value={
              <span className="font-normal text-muted-foreground">
                AI super-resolution ×{plan.aiScale}
                {plan.resampled ? `, then Lanczos resample to ${size.width.toLocaleString("en-US")} × ${size.height.toLocaleString("en-US")} px` : " — no resampling"}
              </span>
            }
          />
        )}
      </dl>

      <IssueList issues={dimErrors} tone="error" />
      <IssueList issues={dimWarnings} tone="warning" />
    </div>
  );
}
