import { useEffect, useRef, useState } from "react";
import { Eraser, Pen, Trash2 } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Stroke = {
  /** Stable across the chunks of one stroke, so the far side can append. */
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
};

const COLORS = ["#ffffff", "#f87171", "#facc15", "#4ade80", "#60a5fa"];
/** Batch window for outgoing points — one message per frame, not per pixel. */
const FLUSH_MS = 50;
/** How long a name stays in the "drawing…" line after their last stroke. */
const DRAWING_TTL_MS = 1500;

function drawSegment(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  stroke: Stroke,
  endIndex: number,
) {
  const a = stroke.points[endIndex - 1];
  const b = stroke.points[endIndex];
  if (!a || !b) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
  ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  ctx.stroke();
}

/**
 * Shared sketchpad for private sessions.
 *
 * Strokes are broadcast over the session's Realtime channel rather than stored,
 * so the board lives only as long as the session. Coordinates are normalised to
 * 0..1 so a stroke drawn on a laptop lands in the same place on a phone.
 */
export function Whiteboard({
  channel,
  myName = "You",
}: {
  channel: RealtimeChannel | null;
  myName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [erasing, setErasing] = useState(false);
  // Outgoing batching.
  const pendingSendRef = useRef<number | null>(null);
  const sentUpToRef = useRef(0);
  // Incoming strokes still in progress, by stroke id, so chunks append rather
  // than restarting the line.
  const liveRef = useRef<Map<string, Stroke>>(new Map());
  const [drawers, setDrawers] = useState<string[]>([]);
  const drawerTimers = useRef<Map<string, number>>(new Map());

  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (const p of stroke.points.slice(1)) {
        ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      }
      ctx.stroke();
    }
  };

  // Keep the bitmap matched to its displayed size, or strokes land offset.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!channel) return;
    let detached = false;

    const noteDrawer = (name: string) => {
      if (!name) return;
      setDrawers((prev) => (prev.includes(name) ? prev : [...prev, name]));
      const timers = drawerTimers.current;
      const existing = timers.get(name);
      if (existing) window.clearTimeout(existing);
      timers.set(
        name,
        window.setTimeout(() => {
          timers.delete(name);
          setDrawers((prev) => prev.filter((n) => n !== name));
        }, DRAWING_TTL_MS),
      );
    };

    const onStroke = ({ payload }: { payload: unknown }) => {
      if (detached) return;
      const p = payload as {
        clear?: boolean;
        id?: string;
        color?: string;
        width?: number;
        points?: Array<{ x: number; y: number }>;
        name?: string;
      };

      if (p?.clear) {
        strokesRef.current = [];
        liveRef.current.clear();
        redraw();
        return;
      }
      if (!p?.id || !p.points?.length) return;

      if (p.name) noteDrawer(p.name);

      // Append to the stroke already in flight, or start it.
      let stroke = liveRef.current.get(p.id);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!stroke) {
        stroke = {
          id: p.id,
          color: p.color ?? "#ffffff",
          width: p.width ?? 3,
          points: [],
        };
        liveRef.current.set(p.id, stroke);
        strokesRef.current.push(stroke);
      }
      const startAt = stroke.points.length;
      stroke.points.push(...p.points.slice(stroke.points.length > 0 ? 1 : 0));

      // Paint only the new segments instead of repainting the whole board.
      if (canvas && ctx) {
        for (let i = Math.max(1, startAt); i < stroke.points.length; i++) {
          drawSegment(ctx, canvas, stroke, i);
        }
      }
    };

    channel.on("broadcast", { event: "wb" }, onStroke);
    // The channel is owned by the session; unsubscribing here would tear down
    // its video signalling too, so just neutralise this closure.
    return () => {
      detached = true;
      drawerTimers.current.forEach((t) => window.clearTimeout(t));
      drawerTimers.current.clear();
    };
  }, [channel]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    sentUpToRef.current = 0;
    currentRef.current = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      points: [pos(e)],
      // "Erasing" paints the board colour rather than compositing, which keeps
      // the stroke model simple and replays identically on every peer.
      color: erasing ? "#0f172a" : color,
      width: erasing ? 24 : 3,
    };
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = currentRef.current;
    if (!stroke) return;
    stroke.points.push(pos(e));

    // Draw only the new segment. The old code called redraw() — repainting
    // every stroke ever made — on every pointer move, so the board got slower
    // the more was on it.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || stroke.points.length < 2) return;
    drawSegment(ctx, canvas, stroke, stroke.points.length - 1);

    // Stream the stroke as it is drawn rather than only on pointer-up, so
    // others watch it appear live instead of waiting for the pen to lift.
    // Batched on a frame so a fast scribble is a few messages, not hundreds.
    if (pendingSendRef.current === null) {
      pendingSendRef.current = window.setTimeout(() => {
        pendingSendRef.current = null;
        const live = currentRef.current;
        if (!live) return;
        const from = sentUpToRef.current;
        const to = live.points.length;
        if (to - from < 1) return;
        // Include the previous point so the far side can join the segments up.
        const chunk = live.points.slice(Math.max(0, from - 1), to);
        sentUpToRef.current = to;
        void channel?.send({
          type: "broadcast",
          event: "wb",
          payload: {
            id: live.id,
            color: live.color,
            width: live.width,
            points: chunk,
            name: myName,
          },
        });
      }, FLUSH_MS);
    }
  };

  const end = () => {
    const stroke = currentRef.current;
    if (pendingSendRef.current !== null) {
      window.clearTimeout(pendingSendRef.current);
      pendingSendRef.current = null;
    }
    currentRef.current = null;
    if (!stroke || stroke.points.length < 2) return;
    strokesRef.current.push(stroke);
    // Flush whatever the timer had not sent yet.
    const from = sentUpToRef.current;
    sentUpToRef.current = 0;
    if (stroke.points.length > from) {
      void channel?.send({
        type: "broadcast",
        event: "wb",
        payload: {
          id: stroke.id,
          color: stroke.color,
          width: stroke.width,
          points: stroke.points.slice(Math.max(0, from - 1)),
          name: myName,
        },
      });
    }
  };

  const clear = () => {
    strokesRef.current = [];
    redraw();
    void channel?.send({ type: "broadcast", event: "wb", payload: { clear: true } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          onClick={() => setErasing(false)}
          aria-label="Pen"
          className={`rounded-md p-1.5 ${!erasing ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
        >
          <Pen className="h-4 w-4" />
        </button>
        <button
          onClick={() => setErasing(true)}
          aria-label="Eraser"
          className={`rounded-md p-1.5 ${erasing ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
        >
          <Eraser className="h-4 w-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-white/15" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              setErasing(false);
            }}
            aria-label={`Colour ${c}`}
            style={{ backgroundColor: c }}
            className={`h-5 w-5 rounded-full border-2 transition ${
              color === c && !erasing ? "border-white" : "border-transparent"
            }`}
          />
        ))}
        <button
          onClick={clear}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="h-full w-full cursor-crosshair touch-none bg-slate-900"
        />
        {drawers.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/70 [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/70 [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/70" />
            </span>
            {drawers.length === 1 ? `${drawers[0]} is drawing` : `${drawers.length} people drawing`}
          </div>
        )}
      </div>
    </div>
  );
}
