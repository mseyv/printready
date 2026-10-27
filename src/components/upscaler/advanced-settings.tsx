"use client";

import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TILE_SIZES, type TileSize } from "@/lib/shared/models";
import type { EngineCapabilities, Issue } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";
import type { Settings } from "./use-upscaler";

/** Collapsible memory settings. Opens by itself when tiling is on, so an active setting is never hidden. */
export function AdvancedSettings({
  engine,
  tiling,
  tileSize,
  onChange,
  errors,
  disabled,
}: {
  engine: EngineCapabilities | null;
  tiling: boolean;
  tileSize: TileSize;
  onChange: (patch: Partial<Pick<Settings, "tiling" | "tileSize">>) => void;
  errors: Issue[];
  disabled?: boolean;
}) {
  const supported = engine?.tiling ?? false;
  return (
    <details className="group rounded-xl border bg-card" open={tiling || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight">Advanced settings</span>
          <span className="block text-[13px] text-muted-foreground">
            Memory and tiling{tiling ? ` · tiles ${tileSize} px` : ""}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="space-y-4 border-t px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Use tiling</span>
            <span className="block text-xs text-muted-foreground">
              {supported
                ? "Processes the image in pieces. Use it on GPUs with little memory or for very large photos."
                : "Tile size is managed by this server's AI engine."}
            </span>
          </span>
          <Switch
            checked={tiling}
            onCheckedChange={(checked) => onChange({ tiling: checked })}
            disabled={disabled || !supported}
            className="mt-0.5"
          />
        </label>

        {tiling && (
          <fieldset disabled={disabled} className="space-y-2">
            <legend className="mb-2 text-xs text-muted-foreground">Tile size</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {TILE_SIZES.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-sm font-semibold tabular-nums transition-colors",
                    "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                    tileSize === t ? "border-foreground bg-muted/60 shadow-[inset_0_0_0_1px_var(--foreground)]" : "hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="tileSize"
                    value={t}
                    checked={tileSize === t}
                    onChange={() => onChange({ tileSize: t })}
                    className="sr-only"
                  />
                  {t}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Smaller tiles use less GPU memory but take longer.</p>
          </fieldset>
        )}
        <IssueList issues={errors.filter((i) => i.field === "tileSize")} tone="error" />
      </div>
    </details>
  );
}
