"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  FACE_ENHANCER_LABEL,
  FACE_ENHANCERS,
  MODEL_IDS,
  MODEL_INFO,
  type FaceEnhancer,
  type ModelId,
} from "@/lib/shared/models";
import type { EngineCapabilities, Issue } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";
import { IssueList } from "./issue-list";
import type { Settings } from "./use-upscaler";

type Patch = Partial<Pick<Settings, "model" | "faceEnhance" | "faceModel">>;

const MODEL_LABELS = Object.fromEntries(MODEL_IDS.map((id) => [id, MODEL_INFO[id].label]));

export function ModelSettings({
  engine,
  settings,
  onChange,
  errors,
  disabled,
}: {
  engine: EngineCapabilities | null;
  settings: Settings;
  onChange: (patch: Patch) => void;
  errors: Issue[];
  disabled?: boolean;
}) {
  const modelOf = (id: ModelId) => engine?.models.find((m) => m.id === id);
  const current = modelOf(settings.model);
  const faceSupported = (f: FaceEnhancer) => engine?.faceEnhancers.includes(f) ?? false;
  const anyFace = FACE_ENHANCERS.some(faceSupported);
  const scales = current?.available ? current.nativeScales.map((s) => `×${s}`).join(" / ") : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label id="model-label" className="text-xs text-muted-foreground">
          Model
        </label>
        <Select
          items={MODEL_LABELS}
          value={settings.model}
          onValueChange={(v) => v && onChange({ model: v as ModelId })}
          disabled={disabled || !engine}
        >
          <SelectTrigger aria-labelledby="model-label" className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_IDS.map((id) => {
              const m = modelOf(id);
              const available = m?.available ?? false;
              return (
                <SelectItem key={id} value={id} disabled={!available} className="py-1.5">
                  <span className="flex flex-col items-start gap-0.5 whitespace-normal">
                    <span>{MODEL_INFO[id].label}</span>
                    <span className="text-xs text-muted-foreground">
                      {available ? MODEL_INFO[id].hint : (m?.reason ?? "Not available on this server.")}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {MODEL_INFO[settings.model].hint}
          {scales && ` · native ${scales}`}
        </p>
        <IssueList issues={errors.filter((i) => i.field === "model")} tone="error" />
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Face enhancement</span>
            <span className="block text-xs text-muted-foreground">
              {anyFace ? "Restores faces in photos. Can over-smooth skin and artwork." : "Not available with this server's AI engine."}
            </span>
          </span>
          <Switch
            checked={settings.faceEnhance}
            onCheckedChange={(checked) => onChange({ faceEnhance: checked })}
            disabled={disabled || !anyFace}
            className="mt-0.5"
          />
        </label>
        {settings.faceEnhance && (
          <fieldset disabled={disabled} className="grid grid-cols-2 gap-1.5">
            <legend className="sr-only">Face restoration model</legend>
            {FACE_ENHANCERS.map((f) => (
              <label
                key={f}
                className={cn(
                  "flex cursor-pointer flex-col rounded-lg border px-3 py-2 transition-colors",
                  "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                  settings.faceModel === f ? "border-foreground bg-muted/60 shadow-[inset_0_0_0_1px_var(--foreground)]" : "hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="faceModel"
                  value={f}
                  checked={settings.faceModel === f}
                  onChange={() => onChange({ faceModel: f })}
                  disabled={!faceSupported(f)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">{FACE_ENHANCER_LABEL[f]}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {!faceSupported(f) ? "Not available" : f === "gfpgan" ? "Natural, fast" : "Stronger on damaged faces"}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <IssueList issues={errors.filter((i) => i.field === "faceEnhance")} tone="error" />
      </div>
    </div>
  );
}
