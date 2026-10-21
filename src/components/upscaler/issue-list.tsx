import { AlertTriangle, CircleX } from "lucide-react";
import type { Issue } from "@/lib/shared/plan";
import { cn } from "@/lib/utils";

export function IssueList({ issues, tone, id }: { issues: Issue[]; tone: "error" | "warning"; id?: string }) {
  if (issues.length === 0) return null;
  const Icon = tone === "error" ? CircleX : AlertTriangle;
  return (
    <ul id={id} className="space-y-1.5" aria-live="polite">
      {issues.map((issue) => (
        <li
          key={issue.code + issue.message}
          className={cn(
            "flex gap-2 rounded-md px-2.5 py-2 text-[13px] leading-snug",
            tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">{tone === "error" ? "Error: " : "Warning: "}</span>
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
