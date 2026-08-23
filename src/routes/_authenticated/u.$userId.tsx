import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, GraduationCap, UserPlus, Check, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendFriendRequest, respondToRequest, fetchMyStats, type MyStats } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/u/$userId")({
  head: () => ({
    meta: [
      { title: "Student Profile — Pathwaay" },
      {
        name: "description",
        content: "View a Pathwaay student's college, course, doubts solved and average rating.",
      },
      { property: "og:title", content: "Student Profile — Pathwaay" },
      {
        property: "og:description",
        content: "View a Pathwaay student's college, course, doubts solved and average rating.",
      },
    ],
  }),
  component: PublicProfile,
});

interface PublicProfileData {
  id: string;
  name: string | null;
  avatar_url: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
}

function PublicProfile() {
  const { userId } = Route.useParams();
  const nav = useNavigate();
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyStats(userId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // What relationship we already have with this person, so the action button
  // can show the truth instead of always offering "Add Friend".
  const [friendState, setFriendState] = useState<
    "none" | "outgoing" | "incoming" | "accepted" | "self"
  >("none");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase.auth.getUser();
      const uid = me.user?.id;
      if (!uid || cancelled) return;
      if (uid === userId) {
        setFriendState("self");
        return;
      }
      const { data: row } = await supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .or(
          `and(requester_id.eq.${uid},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${uid})`,
        )
        .maybeSingle();
      if (cancelled) return;
      if (!row) {
        setFriendState("none");
      } else if (row.status === "accepted") {
        setFriendState("accepted");
      } else if (row.status === "pending") {
        setFriendState(row.requester_id === uid ? "outgoing" : "incoming");
      } else {
        setFriendState("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_public_profile", { _user_id: userId });
      if (cancelled) return;
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setNotFound(true);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setProfile(row as PublicProfileData);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const displayName = profile?.name?.trim() || "Student";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="flex items-center gap-3 px-5 pt-6">
        <button
          onClick={() => nav({ to: "/experts" })}
          className="rounded-full bg-card p-2 shadow-card"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold">Profile</h1>
      </header>

      {loading ? (
        <div className="mt-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : notFound || !profile ? (
        <div className="mt-16 px-5 text-center">
          <p className="text-sm font-semibold text-foreground">Profile not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This user may have deleted their account.
          </p>
          <Link
            to="/experts"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Back to Friends
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-6 px-5 text-center">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                className="mx-auto h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
                {initial}
              </div>
            )}
            <h2 className="mt-3 text-xl font-extrabold text-foreground">{displayName}</h2>
            {profile.college && (
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {profile.college}
              </div>
            )}
          </section>

          {(profile.course || profile.year) && (
            <section className="mt-5 mx-5 rounded-2xl bg-card p-4 shadow-card text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                <span>
                  {profile.course || "—"}
                  {profile.year ? ` · ${profile.year} year` : ""}
                </span>
              </div>
            </section>
          )}

          <section className="mt-5 mx-5 grid grid-cols-3 gap-3 text-center">
            {/* Confirmed by the person who raised the doubt, not offers made. */}
            <StatBox label="Solved" value={String(stats?.solved ?? 0)} />
            <StatBox label="Asked" value={String(stats?.doubts_asked ?? 0)} />
            <StatBox
              label="Rating"
              value={
                stats && stats.ratings_count > 0 ? `${Number(stats.avg_rating).toFixed(1)}/10` : "—"
              }
            />
          </section>

          <section className="mt-5 mx-5">
            {/* The button used to be unconditional, so an existing friend was
             * still invited to be added. Reflect the real relationship. */}
            {friendState === "self" ? null : friendState === "accepted" ? (
              <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-semibold text-muted-foreground">
                <Check className="h-4 w-4 text-success" /> Friends
              </div>
            ) : friendState === "outgoing" ? (
              <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-semibold text-muted-foreground">
                <Clock className="h-4 w-4" /> Request sent
              </div>
            ) : friendState === "incoming" ? (
              <button
                onClick={async () => {
                  try {
                    await respondToRequest(userId, true);
                    setFriendState("accepted");
                    toast.success("Friend request accepted");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not accept");
                  }
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <Check className="h-4 w-4" /> Accept request
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const msg = await sendFriendRequest(userId);
                    setFriendState("outgoing");
                    toast.success(msg);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not send request");
                  }
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <UserPlus className="h-4 w-4" /> Add Friend
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-3 shadow-card">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-extrabold text-foreground">{value}</div>
    </div>
  );
}
