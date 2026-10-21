"use client";

import { UPSCALE_FACTORS, formatPixelCount, scaleSize, type Size, type UpscaleFactor } from "@/lib/shared/dimensions";
import { cn } from "@/lib/utils";

export function FactorPicker({
  original,
  value,
  custom,
  onChange,
  disabled,
}: {
  original: Size | null;
  value: UpscaleFactor;
  /** True when the output dimensions were edited away from the selected preset. */
  custom: boolean;
  onChange: (f: UpscaleFactor) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Upscale factor</legend>
      {UPSCALE_FACTORS.map((f) => {
        const out = original ? scaleSize(original, f) : null;
        return (
          <label
            key={f}
            className={cn(
              "relative flex cursor-pointer flex-col rounded-lg border p-3 transition-colors outline-none",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
              value === f
                ? custom
                  ? "border-dashed border-foreground/50 bg-muted/40"
                  : "border-foreground bg-muted/60 shadow-[inset_0_0_0_1px_var(--foreground)]"
                : "hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name="factor"
              value={f}
              checked={value === f}
              onChange={() => onChange(f)}
              className="sr-only"
              aria-describedby={`factor-${f}-desc`}
            />
            <span className="text-lg font-semibold tabular-nums">×{f}</span>
            <span id={`factor-${f}-desc`} className="mt-1 text-xs text-muted-foreground tabular-nums">
              {out ? (
                <>
                  {out.width.toLocaleString("en-US")} × {out.height.toLocaleString("en-US")} px
                  <span className="block">{formatPixelCount(out).replace(/^.*\(/, "").replace(")", "")} · {f * f}× pixels</span>
                </>
              ) : (
                <>
                  {f}× width and height
                  <span className="block">{f * f}× the pixels</span>
                </>
              )}
            </span>
            {value === f && custom && (
              <span className="absolute top-2 right-2 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                base preset
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
