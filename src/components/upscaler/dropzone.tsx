"use client";

import { ImageUp, Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { ACCEPT_ATTRIBUTE } from "@/lib/shared/formats";
import { formatBytes } from "@/lib/client/source-image";
import { cn } from "@/lib/utils";

/** First image file from a drop/paste, if any. */
export function pickFile(list: FileList | DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === "file" ? entry.getAsFile() : null;
    if (file) return file;
  }
  return null;
}

export function Dropzone({
  onFile,
  loading,
  disabled,
  maxBytes,
  compact,
}: {
  onFile: (file: File) => void;
  loading: boolean;
  disabled?: boolean;
  maxBytes?: number;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = pickFile(e.dataTransfer.files);
      if (file && !disabled) onFile(file);
    },
    [onFile, disabled],
  );

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        dragging ? "border-foreground/60 bg-muted" : "border-foreground/20 hover:border-foreground/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <div className="grid size-11 place-items-center rounded-full bg-muted" aria-hidden>
        {loading ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {loading ? "Reading image…" : dragging ? "Drop to upload" : "Drag an image here, or"}
        </p>
        {!loading && !dragging && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-sm font-medium underline underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            choose a file
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP or TIFF{maxBytes ? ` · up to ${formatBytes(maxBytes)}` : ""} · or paste with{" "}
        <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">Ctrl</kbd>+
        <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">V</kbd>
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose an image file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
