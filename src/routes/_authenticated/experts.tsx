import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, MapPin, BookOpen, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { supabase } from "@/integrations/supabase/client";
import { fetchFriends, respondToRequest, removeFriend, type FriendRow } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/experts")({
  head: () => ({
    meta: [
      { title: "Friends — Kaenyon" },
      {
        name: "description",
        content:
          "See which of your Kaenyon friends are online and which classroom they are studying in right now.",
      },
      { property: "og:title", content: "Friends — Kaenyon" },
      {
        property: "og:description",
        content: "See which of your friends are live in a classroom right now.",
      },
    ],
  }),
  component: Friends,
});

const AVATAR_COLORS = [
  "bg-primary",
  "bg-indigo-500",
  "bg-success",
  "bg-warning",
  "bg-pink-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-emerald-500",
  "bg-rose-500",
];

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initialsFor(name: string) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Friends() {
  const nav = useNavigate();
  const [rows, setRows] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    try {
      setRows(await fetchFriends(uid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load friends");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const pending = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.direction === "incoming"),
    [rows],
  );
  const sent = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.direction === "outgoing"),
    [rows],
  );
  const friends = useMemo(
    () =>
      rows
        .filter((r) => r.status === "accepted")
        .filter((r) => (r.name ?? "").toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );

  const respond = async (id: string, accept: boolean) => {
    try {
      await respondToRequest(id, accept);
      toast.success(accept ? "Friend request accepted" : "Request declined");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-8">
        <h1 className="text-2xl font-extrabold">Friends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People you've connected with — see who's live in a classroom.
        </p>

        <div className="mt-5 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search friends..."
            className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </header>

      {pending.length > 0 && (
        <section className="mt-6 px-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Friend requests ({pending.length})
          </h2>
          <div className="mt-2 grid gap-2">
            {pending.map((p) => (
              <div
                key={p.friend_id}
                className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card"
              >
                <Avatar id={p.friend_id} name={p.name ?? "Student"} url={p.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name || "Student"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.college || p.course || ""}
                  </div>
                </div>
                <button
                  onClick={() => respond(p.friend_id, true)}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  <UserCheck className="h-4 w-4" />
                </button>
                <button
                  onClick={() => respond(p.friend_id, false)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                >
                  <UserX className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-4 px-5 md:grid-cols-2 lg:grid-cols-3">
        {loading && <p className="text-sm text-muted-foreground">Loading friends…</p>}

        {!loading && friends.length === 0 && (
          <div className="rounded-2xl bg-card p-6 text-center shadow-card md:col-span-2 lg:col-span-3">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold">No friends yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Join a classroom and send a friend request from a participant's menu.
            </p>
          </div>
        )}

        {friends.map((f) => (
          <div key={f.friend_id} className="relative rounded-2xl bg-card p-5 shadow-card">
            <div className="flex items-center gap-3">
              <Avatar id={f.friend_id} name={f.name ?? "Student"} url={f.avatar_url} big />
              <div>
                <span className="font-bold">{f.name || "Student"}</span>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[f.course, f.year].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>

            {f.college && (
              <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {f.college}
              </div>
            )}

            <div className="mt-3 text-xs">
              {f.online ? (
                <span className="font-semibold text-success">● ONLINE</span>
              ) : (
                <span className="font-semibold text-muted-foreground">● OFFLINE</span>
              )}
            </div>

            {f.online && f.subject_name ? (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1.5 text-xs font-semibold text-primary">
                <BookOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  In class: {f.subject_name}
                  {f.room_number ? ` — Room ${f.room_number}` : ""}
                </span>
              </div>
            ) : (
              <div className="mt-2 text-xs italic text-muted-foreground">
                Not in any class right now
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => nav({ to: "/u/$userId", params: { userId: f.friend_id } })}
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              >
                View Profile
              </button>
              <button
                onClick={async () => {
                  await removeFriend(f.friend_id);
                  toast.success("Friend removed");
                  void load();
                }}
                className="rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </section>

      {sent.length > 0 && (
        <section className="mt-6 px-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Sent requests
          </h2>
          <div className="mt-2 grid gap-2">
            {sent.map((s) => (
              <div
                key={s.friend_id}
                className="flex items-center gap-3 rounded-2xl bg-card p-3 text-sm shadow-card"
              >
                <Avatar id={s.friend_id} name={s.name ?? "Student"} url={s.avatar_url} />
                <span className="flex-1 truncate font-semibold">{s.name || "Student"}</span>
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <BottomNav />
    </div>
  );
}

function Avatar({
  id,
  name,
  url,
  big,
}: {
  id: string;
  name: string;
  url: string | null;
  big?: boolean;
}) {
  const size = big ? "h-14 w-14 text-base" : "h-10 w-10 text-xs";
  if (url)
    return <img src={url} alt={name} className={`${size} shrink-0 rounded-full object-cover`} />;
  return (
    <div
      className={`${size} ${colorFor(id)} flex shrink-0 items-center justify-center rounded-full font-bold text-white`}
    >
      {initialsFor(name)}
    </div>
  );
}
