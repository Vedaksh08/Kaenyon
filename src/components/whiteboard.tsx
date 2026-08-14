import { useEffect, useRef, useState } from "react";
import { Eraser, Pen, Trash2 } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Stroke = {
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
};

const COLORS = ["#ffffff", "#f87171", "#facc15", "#4ade80", "#60a5fa"];

/**
 * Shared sketchpad for private sessions.
 *
 * Strokes are broadcast over the session's Realtime channel rather than stored,
 * so the board lives only as long as the session. Coordinates are normalised to
 * 0..1 so a stroke drawn on a laptop lands in the same place on a phone.
 */
export function Whiteboard({ channel }: { channel: RealtimeChannel | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [erasing, setErasing] = useState(false);

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
    const onStroke = ({ payload }: { payload: unknown }) => {
      const p = payload as { stroke?: Stroke; clear?: boolean };
      if (p?.clear) {
        strokesRef.current = [];
      } else if (p?.stroke) {
        strokesRef.current.push(p.stroke);
      }
      redraw();
    };
    channel.on("broadcast", { event: "wb" }, onStroke);
    // The channel is owned by the session; unsubscribing here would tear down
    // its video signalling too.
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
    currentRef.current = {
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
    redraw();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    const a = stroke.points[stroke.points.length - 2];
    const b = stroke.points[stroke.points.length - 1];
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  };

  const end = () => {
    const stroke = currentRef.current;
    currentRef.current = null;
    if (!stroke || stroke.points.length < 2) return;
    strokesRef.current.push(stroke);
    void channel?.send({ type: "broadcast", event: "wb", payload: { stroke } });
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
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full flex-1 cursor-crosshair touch-none bg-slate-900"
      />
    </div>
  );
}
