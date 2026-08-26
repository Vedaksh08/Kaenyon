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
  Sigma,
  Atom,
  FlaskConical,
  Cpu,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { BottomNav } from "@/components/bottom-nav";
import { AppHeader } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your Subjects — Pathwaay" },
      {
        name: "description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
      { property: "og:title", content: "Your Subjects — Pathwaay" },
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

// Icons are chosen by keyword, not by slug. With 572 real subjects across 24
// courses a per-slug map is unmaintainable, and the old one listed the seven
// placeholder subjects that no longer exist.
const ICON_RULES: Array<{ match: RegExp; icon: LucideIcon; className: string }> = [
  { match: /security|cyber|crypt/i, icon: ShieldCheck, className: "bg-brand-violet text-white" },
  { match: /web|full.?stack|frontend/i, icon: Code2, className: "bg-brand-amber text-navy" },
  {
    match: /data structure|algorithm|discrete/i,
    icon: Binary,
    className: "bg-brand-cyan text-navy",
  },
  {
    match: /artificial intelligence|machine learning|neural|\bai\b/i,
    icon: Bot,
    className: "bg-brand-violet text-white",
  },
  {
    match: /operating system|linux|unix|network/i,
    icon: Terminal,
    className: "bg-navy text-white",
  },
  {
    match: /programming|software|compiler|python|java|\bc\+\+/i,
    icon: Laptop,
    className: "bg-primary text-primary-foreground",
  },
  { match: /database|dbms|\bsql\b/i, icon: Layers, className: "bg-brand-lime text-navy" },
  { match: /math|calculus|algebra|statistic/i, icon: Sigma, className: "bg-primary text-white" },
  { match: /physic|mechanic|thermo|fluid/i, icon: Atom, className: "bg-brand-cyan text-navy" },
  {
    match: /chemi|material|metallurg/i,
    icon: FlaskConical,
    className: "bg-brand-amber text-navy",
  },
  {
    match: /electr|circuit|signal|electronic/i,
    icon: Cpu,
    className: "bg-brand-lime text-navy",
  },
  {
    match: /civil|structur|survey|construct/i,
    icon: Building2,
    className: "bg-navy text-white",
  },
];

const FALLBACK = { icon: BookOpen, className: "bg-primary text-primary-foreground" };

function iconFor(name: string) {
  return ICON_RULES.find((r) => r.match.test(name)) ?? FALLBACK;
}

function getIndianGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "hour")?.value,
  );

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Home() {
  const { profile } = usePlan();
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = profile?.name?.trim().split(" ")[0] || "there";
  const greeting = getIndianGreeting();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Only the subjects this student actually studies: their course, and the
      // two semesters of their year. Showing all 572 would be meaningless — a
      // Civil student has no business in a Quantum Computing room.
      const { data: me } = await supabase.auth.getUser();
      const uid = me.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("course_slug, year")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;

      const yearNum = Math.max(1, parseInt(prof?.year ?? "1", 10) || 1);
      const { data: courseSubjects } = prof?.course_slug
        ? await supabase.rpc("get_course_subjects", {
            _course_slug: prof.course_slug,
            _year: yearNum,
          })
        : { data: null };
      if (cancelled) return;

      const subjectRows = courseSubjects ?? [];
      const { data: classrooms } = await supabase.from("classrooms").select("id, subject_slug");
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
        subjectRows.map((s) => ({
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
  const courseLabel = profile?.course?.trim() || "your course";
  // One flat list. Semesters are an academic detail, not something a student
  // needs when picking a room, and a subject taught across both semesters of a
  // year is one classroom — showing it under two headings implied two rooms.

  return (
    <div className="min-h-screen bg-background pb-24">
      <AppHeader
        accent="cyan"
        title={`${greeting}, ${firstName}! 👋`}
        subtitle={
          totalLive > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {totalLive} studying right now
            </span>
          ) : (
            `${courseLabel} · ${profile?.year ?? ""}`.trim()
          )
        }
      />

      {loading ? (
        /* Same shape as the real cards, so the page does not jump when they
         * arrive — the old skeleton was a horizontal strip and the grid is
         * two columns. */
        <div className="mt-6 grid grid-cols-2 gap-3 px-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-card shadow-card" />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <div className="mt-10 px-5">
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No subjects for your year yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your course and year in your profile.
            </p>
          </div>
        </div>
      ) : (
        <section className="mt-6 px-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Your subjects</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {subjects.length}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {subjects.map((s) => {
              const { icon: Icon, className } = iconFor(s.name);
              return (
                <Link
                  key={s.slug}
                  to="/subject/$subject"
                  params={{ subject: s.slug }}
                  className="group relative flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated active:translate-y-0"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${className}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 text-sm font-semibold leading-tight">{s.name}</div>
                  {s.live > 0 && <LiveDot count={s.live} />}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <BottomNav />
    </div>
  );
}

/** Small corner badge so a busy subject stands out without adding a row of
 * text under every card. */
function LiveDot({ count }: { count: number }) {
  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-success px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      {count}
    </span>
  );
}
