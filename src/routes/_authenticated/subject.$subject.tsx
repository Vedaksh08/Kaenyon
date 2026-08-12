import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureOpenClassrooms } from "@/lib/classrooms.functions";

export const Route = createFileRoute("/_authenticated/subject/$subject")({
  head: ({ params }) => ({
    meta: [
      { title: `${prettify(params.subject)} — StudyAll` },
      {
        name: "description",
        content: `Join a live ${prettify(params.subject)} classroom on StudyAll and get your doubts solved by peers.`,
      },
      { property: "og:title", content: `${prettify(params.subject)} — StudyAll` },
      {
        property: "og:description",
        content: `Live ${prettify(params.subject)} classrooms on StudyAll.`,
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

const TICKER = [
  "James Miller is ACTIVE",
  "Rahul S. is ACTIVE",
  "Sofia Chen is ACTIVE",
  "Anita Kumar is ACTIVE",
  "David Chen is ACTIVE",
];

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
      <div className="overflow-hidden bg-navy text-white py-2">
        <div className="flex w-max animate-marquee whitespace-nowrap">
          {[...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="mx-6 text-xs font-medium uppercase tracking-wider">
              ✦ {t}
            </span>
          ))}
        </div>
      </div>

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
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Join a live classroom session
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-10 text-center text-sm text-muted-foreground">Loading classrooms…</div>
        ) : visible.length === 0 ? (
          <div className="mt-10 rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
            No classrooms configured for this subject yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((c, i) => {
              const full = c.used >= c.capacity;
              const pct = (c.used / c.capacity) * 100;
              const barColor = full ? "bg-danger" : c.used > 20 ? "bg-warning" : "bg-success";
              return (
                <div key={c.id} className="rounded-2xl bg-card p-5 shadow-card transition">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold">Classroom {i + 1}</h3>
                      {c.is_verified && (
                        <span className="rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                          VERIFIED
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Auto-matched study room ·{" "}
                    <span className="font-semibold text-foreground">peer study</span>
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {c.used} / {c.capacity} live participants
                      </span>
                      {full ? (
                        <span className="rounded-md bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                          CLASSROOM FULL
                        </span>
                      ) : (
                        <span className="rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                          JOINABLE
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {full ? (
                    <button className="mt-4 w-full rounded-lg bg-secondary py-2.5 text-sm font-semibold text-muted-foreground">
                      Waiting List
                    </button>
                  ) : (
                    <Link
                      to="/room/$roomId"
                      params={{ roomId: c.id }}
                      className="mt-4 block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
                    >
                      Enter Classroom →
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
