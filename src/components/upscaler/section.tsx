import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  step,
  title,
  description,
  aside,
  children,
  className,
}: {
  step?: number;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-xl border bg-card p-4 sm:p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {step !== undefined && (
              <span aria-hidden className="grid size-5 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                {step}
              </span>
            )}
            {title}
          </h2>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Key–value row used in summaries. */
export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
