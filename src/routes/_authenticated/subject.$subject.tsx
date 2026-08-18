import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureOpenClassrooms } from "@/lib/classrooms.functions";

export const Route = createFileRoute("/_authenticated/subject/$subject")({
  head: ({ params }) => ({
    meta: [
      { title: `${prettify(params.subject)} — Kaenyon` },
      {
        name: "description",
        content: `Join a live ${prettify(params.subject)} classroom on Kaenyon and get your doubts solved by peers.`,
      },
      { property: "og:title", content: `${prettify(params.subject)} — Kaenyon` },
      {
        property: "og:description",
        content: `Live ${prettify(params.subject)} classrooms on Kaenyon.`,
      },
    ],
  }),
  component: SubjectPage,
});

function prettify(slug: string) {
  return slug
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

interface Classroom {
  id: string;
  room_number: number;
  capacity: number;
  is_verified: boolean;
  used: number;
}

function SubjectPage() {
  const { subject } = Route.useParams();
  const [name, setName] = useState(prettify(subject));
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const classroomIdsRef = useRef<string[]>([]);

  useEffect(() => {
    classroomIdsRef.current = classrooms.map((c) => c.id);
  }, [classrooms]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Top up so there are always 3 joinable classrooms for this subject.
      try {
        await ensureOpenClassrooms({ data: { subject } });
      } catch {
        /* non-fatal: still show whatever rooms exist */
      }
      if (cancelled) return;

      const [subjRes, roomsRes] = await Promise.all([
        supabase.from("subjects").select("name").eq("slug", subject).maybeSingle(),
        supabase
          .from("classrooms")
          .select("id, room_number, capacity, is_verified")
          .eq("subject_slug", subject)
          .order("room_number"),
      ]);
      if (cancelled) return;
      if (subjRes.data?.name) setName(subjRes.data.name);
      const rooms = roomsRes.data ?? [];
      const ids = rooms.map((r) => r.id);
      let counts: Record<string, number> = {};
      if (ids.length) {
        const { data: presence } = await supabase
          .from("user_presence")
          .select("classroom_id")
          .in("classroom_id", ids)
          .not("classroom_id", "is", null)
          .gt("last_seen", new Date(Date.now() - 2 * 60 * 1000).toISOString());
        counts = (presence ?? []).reduce<Record<string, number>>((acc, p) => {
          if (p.classroom_id) acc[p.classroom_id] = (acc[p.classroom_id] ?? 0) + 1;
          return acc;
        }, {});
      }
      if (cancelled) return;
      setClassrooms(
        rooms.map((r) => ({
          id: r.id,
          room_number: r.room_number,
          capacity: r.capacity,
          is_verified: r.is_verified,
          used: Math.min(r.capacity, counts[r.id] ?? 0),
        })),
      );
      setLoading(false);
    };

    void load();
    // Delete lapsed rows rather than only hiding them, so the realtime DELETE
    // reaches everyone else watching this subject too.
    void supabase.rpc("sweep_stale_presence").then(() => {
      if (!cancelled) void load();
    });

    // Keep counts live and re-scale rooms as participants join/leave.
    const channel = supabase
      .channel(`subject:${subject}:presence`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [subject]);

  const liveCount = classrooms.reduce((sum, c) => sum + c.used, 0);

  // Always show every filled room, but never more than 3 joinable ones.
  const OPEN_LIMIT = 3;
  let openShown = 0;
  const visible = classrooms.filter((c) => {
    if (c.used >= c.capacity) return true;
    openShown += 1;
    return openShown <= OPEN_LIMIT;
  });

  return (
    <div className="min-h-screen bg-background pb-12">
      <div className="mx-auto max-w-6xl px-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to="/home"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
            <h1 className="mt-2 text-3xl font-extrabold">{name}</h1>
            {/* Real presence, counted from user_presence — replaces a marquee
             * of hardcoded names that implied an active userbase. */}
            <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
              {liveCount > 0 ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  {liveCount} {liveCount === 1 ? "student" : "students"} studying now
                </>
              ) : (
                "Join a classroom to start solving doubts"
              )}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium">No classrooms yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Rooms for this subject haven't been set up.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((c, i) => {
              const full = c.used >= c.capacity;
              const pct = Math.min(100, (c.used / c.capacity) * 100);
              const barColor = full
                ? "bg-danger"
                : c.used > c.capacity * 0.7
                  ? "bg-warning"
                  : "bg-success";
              return (
                <div
                  key={c.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">Room {i + 1}</h3>
                    {c.is_verified && (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">
                        VERIFIED
                      </span>
                    )}
                    <span
                      className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        full ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                      }`}
                    >
                      {full ? "FULL" : "OPEN"}
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold tabular-nums">{c.used}</span>
                      <span className="text-sm text-muted-foreground">/ {c.capacity} students</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {full ? (
                    <button
                      disabled
                      className="mt-5 w-full cursor-not-allowed rounded-lg bg-secondary py-2.5 text-sm font-semibold text-muted-foreground"
                    >
                      Room full
                    </button>
                  ) : (
                    <Link
                      to="/room/$roomId"
                      params={{ roomId: c.id }}
                      className="mt-5 block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      Join room
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
