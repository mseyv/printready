"use client";

import { Loader2, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface View {
  z: number;
  x: number;
  y: number;
}

type Gesture =
  | { kind: "slider" }
  | { kind: "pan"; sx: number; sy: number; view: View; moved: boolean }
  | { kind: "pinch"; dist: number; view: View; mx: number; my: number }
  | null;

const MAX_ACTUAL_ZOOM = 8; // up to 800% of actual output pixels

/**
 * Before/after comparison with a draggable divider, zoom (buttons, Ctrl/⌘+wheel,
 * pinch, double-tap) and panning. Both layers share one transform so details stay aligned.
 */
export function CompareViewer({
  beforeSrc,
  afterSrc,
  width,
  height,
}: {
  beforeSrc: string;
  afterSrc: string;
  /** Output pixel dimensions. */
  width: number;
  height: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState(50);
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxZ = box.w ? Math.max(1, (MAX_ACTUAL_ZOOM * width) / box.w) : 1;
  const actualPct = box.w ? (view.z * box.w * 100) / width : 0;

  const clamp = useCallback(
    (v: View): View => {
      const z = Math.min(maxZ, Math.max(1, v.z));
      return {
        z,
        x: Math.min(0, Math.max(box.w - box.w * z, v.x)),
        y: Math.min(0, Math.max(box.h - box.h * z, v.y)),
      };
    },
    [box, maxZ],
  );

  /** Zoom to `z`, keeping the point (px, py) in frame coordinates fixed. */
  const zoomAt = useCallback(
    (z: number, px = box.w / 2, py = box.h / 2, from?: View) =>
      setView((cur) => {
        const v = from ?? cur;
        const nz = Math.min(maxZ, Math.max(1, z));
        return clamp({ z: nz, x: px - ((px - v.x) * nz) / v.z, y: py - ((py - v.y) * nz) / v.z });
      }),
    [box, maxZ, clamp],
  );

  const fit = () => setView({ z: 1, x: 0, y: 0 });
  const actualSize = () => zoomAt(width / box.w);

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms; plain wheel pans when zoomed, otherwise scrolls the page.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setView((v) => {
          const nz = Math.min(maxZ, Math.max(1, v.z * Math.exp(-e.deltaY * 0.01)));
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          return clamp({ z: nz, x: px - ((px - v.x) * nz) / v.z, y: py - ((py - v.y) * nz) / v.z });
        });
      } else if (view.z > 1) {
        e.preventDefault();
        setView((v) => clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp, maxZ, view.z]);

  const local = (e: PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const setPosFrom = (x: number) => setPos(Math.min(100, Math.max(0, (x / box.w) * 100)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    frame.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), view, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }

    // Double-tap / double-click toggles between fit and 1:1 at the pointer.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (view.z > 1) fit();
      else zoomAt(Math.max(2, width / box.w), p.x, p.y);
      gesture.current = null;
      return;
    }
    lastTap.current = now;

    const onHandle = (e.target as HTMLElement).closest("[data-handle]");
    if (onHandle || view.z === 1) {
      gesture.current = { kind: "slider" };
      setPosFrom(p.x);
    } else {
      gesture.current = { kind: "pan", sx: p.x, sy: p.y, view, moved: false };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "slider") setPosFrom(p.x);
    else if (g.kind === "pan") setView(clamp({ ...g.view, x: g.view.x + p.x - g.sx, y: g.view.y + p.y - g.sy }));
    else if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      zoomAt((g.view.z * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, g.mx, g.my, g.view);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 || gesture.current?.kind === "pinch") gesture.current = null;
  };

  const onFrameKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 100 : 30;
    const keys: Record<string, () => void> = {
      "+": () => zoomAt(view.z * 1.5),
      "=": () => zoomAt(view.z * 1.5),
      "-": () => zoomAt(view.z / 1.5),
      "0": fit,
      "1": actualSize,
      ArrowLeft: () => setView((v) => clamp({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => clamp({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => clamp({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => clamp({ ...v, y: v.y - step })),
    };
    if (e.target !== e.currentTarget) return; // the divider handles its own keys
    const action = keys[e.key];
    if (action && (view.z > 1 || !e.key.startsWith("Arrow"))) {
      e.preventDefault();
      action();
    }
  };

  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const next: Record<string, number> = {
      ArrowLeft: pos - step,
      ArrowDown: pos - step,
      ArrowRight: pos + step,
      ArrowUp: pos + step,
      Home: 0,
      End: 100,
      PageDown: pos - 10,
      PageUp: pos + 10,
    };
    if (e.key in next) {
      e.preventDefault();
      setPos(Math.min(100, Math.max(0, next[e.key])));
    }
  };

  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  const rendering = actualPct >= 200 ? "pixelated" : "auto";
  const layer = "absolute inset-0 origin-top-left will-change-transform";
  const img = "absolute inset-0 size-full select-none object-fill";

  return (
    <div className="space-y-3">
      <div
        ref={frame}
        role="group"
        tabIndex={0}
        aria-label="Before and after comparison. Drag the divider to compare. Press plus or minus to zoom, arrow keys to pan when zoomed, 0 to fit, 1 for actual pixels."
        aria-roledescription="image comparison"
        className={cn(
          "checkerboard relative mx-auto overflow-hidden rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          view.z > 1 ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-ew-resize touch-pan-y",
        )}
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(70vh * ${width / height}))` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onFrameKey}
      >
        <div className={layer} style={{ transform }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, private, already-sized result */}
          <img
            src={afterSrc}
            alt="Upscaled result"
            draggable={false}
            className={img}
            style={{ imageRendering: rendering }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </div>
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <div className={layer} style={{ transform }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={beforeSrc} alt="Original" draggable={false} className={img} style={{ imageRendering: rendering }} />
          </div>
        </div>

        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          Before
        </span>
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          After
        </span>

        <div
          data-handle
          role="slider"
          tabIndex={0}
          aria-label="Comparison divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% original visible`}
          onKeyDown={onHandleKey}
          className="group absolute inset-y-0 z-10 -ml-5 flex w-10 cursor-ew-resize justify-center outline-none"
          style={{ left: `${pos}%` }}
        >
          <div className="h-full w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
          <div className="absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-neutral-900 shadow-md ring-1 ring-black/10 group-focus-visible:ring-4 group-focus-visible:ring-sky-500/60">
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
              <path d="M7 5 2 10l5 5M13 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {!loaded && !failed && (
          <div className="absolute inset-0 grid place-items-center bg-background/40">
            <span className="flex items-center gap-2 rounded-md bg-background/90 px-3 py-1.5 text-sm shadow">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading full-resolution result…
            </span>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 grid place-items-center bg-background/80 p-4 text-center text-sm">
            The result preview could not be loaded. You can still download the file.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="toolbar" aria-label="Zoom">
          <Button variant="outline" size="icon-lg" onClick={() => zoomAt(view.z / 1.5)} disabled={view.z <= 1} aria-label="Zoom out">
            <ZoomOut />
          </Button>
          <output className="w-16 text-center text-sm tabular-nums" aria-live="polite" aria-label="Zoom level, percent of actual pixels">
            {actualPct ? `${Math.round(actualPct)}%` : "—"}
          </output>
          <Button variant="outline" size="icon-lg" onClick={() => zoomAt(view.z * 1.5)} disabled={view.z >= maxZ} aria-label="Zoom in">
            <ZoomIn />
          </Button>
          <Button variant="ghost" size="lg" onClick={fit} disabled={view.z === 1}>
            <Maximize /> Fit
          </Button>
          <Button variant="ghost" size="lg" onClick={actualSize} disabled={!box.w || width <= box.w}>
            1:1
          </Button>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">Double-click to zoom · Ctrl/⌘ + scroll · drag to pan</p>
      </div>
    </div>
  );
}
