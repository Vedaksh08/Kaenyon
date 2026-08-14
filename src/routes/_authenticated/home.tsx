import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Binary,
  Bot,
  BookOpen,
  Code2,
  Laptop,
  Layers,
  ShieldCheck,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { BottomNav } from "@/components/bottom-nav";
import { KaenyonMark } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your Subjects — Kaenyon" },
      {
        name: "description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
      { property: "og:title", content: "Your Subjects — Kaenyon" },
      {
        property: "og:description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
    ],
  }),
  component: Home,
});

interface SubjectRow {
  slug: string;
  name: string;
  live: number;
}

// Presentation only. Subjects come from the database — an earlier version
// hardcoded a 44-subject catalogue per course, which meant students on any
// course but CS were shown links to subjects that no longer exist.
const ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  "computer-science": { icon: Laptop, className: "bg-slate-900 text-white" },
  ai: { icon: Bot, className: "bg-violet-500 text-white" },
  "data-structures": { icon: Binary, className: "bg-teal-500 text-white" },
  "software-engineering": { icon: Layers, className: "bg-emerald-500 text-white" },
  "operating-systems": { icon: Terminal, className: "bg-zinc-800 text-white" },
  "web-development": { icon: Code2, className: "bg-orange-500 text-white" },
  "cyber-security": { icon: ShieldCheck, className: "bg-rose-500 text-white" },
};

const FALLBACK = { icon: BookOpen, className: "bg-primary text-primary-foreground" };

function Home() {
  const { profile } = usePlan();
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = profile?.name?.trim().split(" ")[0] || "there";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [{ data: subjectRows }, { data: classrooms }] = await Promise.all([
        supabase.from("subjects").select("slug, name").order("name"),
        supabase.from("classrooms").select("id, subject_slug"),
      ]);
      if (cancelled) return;

      // One presence query for the whole page rather than per subject.
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: presence } = await supabase
        .from("user_presence")
        .select("classroom_id")
        .gt("last_seen", since);
      if (cancelled) return;

      const roomToSubject = new Map((classrooms ?? []).map((c) => [c.id, c.subject_slug]));
      const liveBySubject = new Map<string, number>();
      for (const p of presence ?? []) {
        const slug = p.classroom_id ? roomToSubject.get(p.classroom_id) : null;
        if (slug) liveBySubject.set(slug, (liveBySubject.get(slug) ?? 0) + 1);
      }

      setSubjects(
        (subjectRows ?? []).map((s) => ({
          slug: s.slug,
          name: s.name,
          live: liveBySubject.get(s.slug) ?? 0,
        })),
      );
      setLoading(false);
    };

    void load();

    // Live counts rather than waiting on the poll. The interval stays as a
    // backstop for a dropped socket, but at a much lower rate.
    const channel = supabase
      .channel("home:presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, () => {
        void load();
      })
      .subscribe();

    const timer = window.setInterval(() => void load(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const totalLive = subjects.reduce((sum, s) => sum + s.live, 0);
  // Busiest subjects lead, so the rail surfaces where people actually are.
  const ordered = [...subjects].sort((a, b) => b.live - a.live);
  const featured = ordered.slice(0, 5);
  const rest = ordered.slice(5);
  const courseLabel = profile?.course?.trim().toUpperCase() || "YOU";

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold text-primary">Hey, {firstName}! 👋</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalLive > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  {totalLive} studying right now
                </span>
              ) : (
                `Ready to master ${courseLabel.toLowerCase()} today?`
              )}
            </p>
          </div>
          <KaenyonMark className="h-8 w-8 shrink-0" />
        </div>
      </header>

      {loading ? (
        <div className="mt-8 flex gap-3 px-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[132px] w-32 shrink-0 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <div className="mt-10 px-5">
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No subjects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Subjects will appear here once they're added.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="flex items-center gap-1 px-5 text-sm font-bold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Recommended for {courseLabel}
            </h2>
            <div className="mt-3 flex gap-3 overflow-x-auto px-5 pb-2">
              {featured.map((s) => {
                const { icon: Icon, className } = ICONS[s.slug] ?? FALLBACK;
                return (
                  <Link
                    key={s.slug}
                    to="/subject/$subject"
                    params={{ subject: s.slug }}
                    className="relative flex w-32 shrink-0 flex-col items-start gap-3 rounded-xl bg-card p-4 shadow-card hover:shadow-elevated"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${className}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="text-sm font-semibold leading-tight">{s.name}</div>
                    {s.live > 0 && <LiveDot count={s.live} />}
                  </Link>
                );
              })}
            </div>
          </section>

          {rest.length > 0 && (
            <section className="mt-8 px-5">
              <h2 className="text-sm font-bold">Explore other topics</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {rest.map((s) => {
                  const { icon: Icon, className } = ICONS[s.slug] ?? FALLBACK;
                  return (
                    <Link
                      key={s.slug}
                      to="/subject/$subject"
                      params={{ subject: s.slug }}
                      className="relative flex items-center gap-3 rounded-xl bg-card p-4 shadow-card hover:shadow-elevated"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${className}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 truncate text-sm font-semibold">{s.name}</div>
                      {s.live > 0 && <LiveDot count={s.live} />}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <BottomNav />
    </div>
  );
}

/** Small corner badge so a busy subject stands out without adding a row of
 * text under every card. */
function LiveDot({ count }: { count: number }) {
  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {count}
    </span>
  );
}
