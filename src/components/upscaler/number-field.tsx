"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const MAX_INPUT = 1_000_000;

/**
 * Integer input that lets users type freely (including clearing the field) and
 * commits only valid whole numbers. While focused it shows the user's draft;
 * otherwise it shows the committed value, so dependent fields update live.
 */
export function NumberField({
  id,
  label,
  value,
  onCommit,
  unit,
  invalid,
  describedBy,
  disabled,
  className,
  labelHidden,
}: {
  id: string;
  label: ReactNode;
  value: number;
  onCommit: (value: number) => void;
  unit?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
  labelHidden?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = focused ? draft : value ? String(value) : "";
  const draftInvalid = focused && !/^\d+$/.test(draft.trim());

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={id} className={cn("text-xs text-muted-foreground", labelHidden && "sr-only")}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          disabled={disabled}
          aria-invalid={invalid || draftInvalid || undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            setDraft(value ? String(value) : "");
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
              const next = Math.min(MAX_INPUT, Math.max(1, (Number(draft) || value) + step));
              setDraft(String(next));
              onCommit(next);
            }
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(/[\s,]/g, "");
            setDraft(raw);
            if (/^\d+$/.test(raw)) {
              const n = Number(raw);
              if (n >= 1 && n <= MAX_INPUT) onCommit(n);
            }
          }}
          className={cn("h-10 text-base tabular-nums sm:text-sm", unit && "pr-9")}
        />
        {unit && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
