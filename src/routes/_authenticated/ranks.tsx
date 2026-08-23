import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Crown, Trophy } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
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
      <header className="bg-primary px-5 pb-6 pt-8 text-primary-foreground">
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
          Your position
        </div>
        <div className="mt-1 flex items-center gap-2 text-3xl font-extrabold">
          #{stats ? stats.rank.toLocaleString() : "—"} Globally
        </div>
        <div className="mt-3 flex items-center gap-5 text-xs">
          <div>
            <div className="opacity-75">AVG RATING</div>
            <div className="text-lg font-bold">
              {stats && stats.ratings_count > 0
                ? `${Number(stats.avg_rating).toFixed(1)} / 10`
                : "—"}
            </div>
            <div className="opacity-60">
              {stats?.ratings_count
                ? `${stats.ratings_count} rating${stats.ratings_count === 1 ? "" : "s"}`
                : "not rated yet"}
            </div>
          </div>
          <div>
            {/* Confirmed by the asker, not "times I clicked Offer Help". */}
            <div className="opacity-75">SOLVED</div>
            <div className="text-lg font-bold">{stats?.solved ?? 0} Doubts</div>
          </div>
          <div>
            <div className="opacity-75">ASKED</div>
            <div className="text-lg font-bold">{stats?.doubts_asked ?? 0}</div>
          </div>
        </div>
      </header>

      <div className="px-5 pt-5">
        <div className="mt-4 overflow-hidden rounded-2xl bg-card shadow-card">
          {loading && (
            <div className="px-4 py-6 text-sm text-muted-foreground">Loading leaderboard…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No rankings yet — help someone with a doubt and get rated to appear here.
            </div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.user_id}
              onClick={() => nav({ to: "/u/$userId", params: { userId: r.user_id } })}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-secondary/50"
            >
              <div className="w-8 text-center text-sm font-bold">
                {i === 0 ? <Crown className="mx-auto h-5 w-5 text-warning" /> : i + 1}
              </div>
              <div className="flex-1">
                <div className="font-bold text-primary">{r.name || "Student"}</div>
                <div className="text-[11px] text-muted-foreground">{r.course || "—"}</div>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold">{r.solved} solved</div>
                <div className="text-muted-foreground">
                  {r.ratings_count > 0 ? `${Number(r.avg_rating).toFixed(1)} / 10` : "unrated"}
                </div>
              </div>
            </button>
          ))}
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
