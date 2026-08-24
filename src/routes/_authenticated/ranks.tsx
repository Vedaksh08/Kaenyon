import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Crown, Trophy } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { AppHeader } from "@/components/brand";
import { supabase } from "@/integrations/supabase/client";
import { fetchLeaderboard, fetchMyStats, type LeaderRow, type MyStats } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/ranks")({
  head: () => ({
    meta: [
      { title: "Global Rankings — Pathwaay" },
      {
        name: "description",
        content: "Live Pathwaay leaderboard — doubts solved and average session ratings out of 10.",
      },
      { property: "og:title", content: "Global Rankings — Pathwaay" },
      { property: "og:description", content: "See who solves the most doubts on Pathwaay." },
    ],
  }),
  component: Ranks,
});

function Ranks() {
  const nav = useNavigate();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      try {
        const [board, mine] = await Promise.all([
          fetchLeaderboard(25),
          uid ? fetchMyStats(uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRows(board);
        setStats(mine);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    // Ranks move the instant someone is rated, so reflect that rather than
    // making people reload. session_ratings is on the realtime publication.
    const channel = supabase
      .channel("ranks:session_ratings")
      .on("postgres_changes", { event: "*", schema: "public", table: "session_ratings" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-24">
      <AppHeader
        accent="amber"
        title="Global Rankings"
        subtitle="Live — updates as doubts get answered and rated"
      />

      {/* The stats plate. Deep brand blue so your own standing reads as the
       * headline of the page rather than another card in the list. */}
      <div className="bg-primary px-5 pb-6 pt-5 text-primary-foreground">
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-75">
          Your position
        </div>
        <div className="mt-1 text-3xl font-extrabold">
          #{stats ? stats.rank.toLocaleString() : "—"}{" "}
          <span className="text-xl font-bold opacity-80">Globally</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat
            label="Avg rating"
            value={
              stats && stats.ratings_count > 0 ? `${Number(stats.avg_rating).toFixed(1)} / 10` : "—"
            }
            note={
              stats?.ratings_count
                ? `${stats.ratings_count} rating${stats.ratings_count === 1 ? "" : "s"}`
                : "not rated yet"
            }
          />
          {/* Confirmed by the asker, not "times I clicked Offer Help". */}
          <Stat label="Solved" value={String(stats?.solved ?? 0)} note="doubts" />
          <Stat label="Asked" value={String(stats?.doubts_asked ?? 0)} note="doubts" />
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
          {loading && (
            <div className="px-4 py-6 text-sm text-muted-foreground">Loading leaderboard…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No rankings yet — help someone with a doubt and get rated to appear here.
            </div>
          )}
          {rows.map((r, i) => {
            const medal = ["text-brand-amber", "text-muted-foreground", "text-brand-violet"][i];
            return (
              <button
                key={r.user_id}
                onClick={() => nav({ to: "/u/$userId", params: { userId: r.user_id } })}
                className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary"
              >
                <div className="w-8 shrink-0 text-center text-sm font-bold text-muted-foreground">
                  {i < 3 ? <Crown className={`mx-auto h-5 w-5 ${medal}`} /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-foreground">{r.name || "Student"}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.course || "—"}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="font-bold text-foreground">{r.solved} solved</div>
                  <div className="text-muted-foreground">
                    {r.ratings_count > 0 ? `${Number(r.avg_rating).toFixed(1)} / 10` : "unrated"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Trophy className="h-4 w-4" />
          Rankings update live as doubts get answered and rated.
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

/** One figure on the rankings plate. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-0.5 truncate text-lg font-extrabold leading-tight">{value}</div>
      {note && <div className="truncate text-[10px] opacity-60">{note}</div>}
    </div>
  );
}
