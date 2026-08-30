import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Users,
  Video,
  VideoOff,
  WifiOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/lib/plan-context";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { useJitsi } from "@/lib/use-jitsi";
import { IS_PUBLIC_JITSI, roomNameFor } from "@/lib/jitsi";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/classroom/$classId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Classroom — Pathwaay" },
      { name: "description", content: "Join your live Pathwaay classroom." },
    ],
  }),
  /**
   * Authorisation happens before the meeting is created, never after. The
   * parent _authenticated guard has already established a signed-in, onboarded,
   * unsuspended user; this adds "does this student study this subject".
   */
  beforeLoad: async ({ params }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) throw redirect({ to: "/login" });

    const { data: classroom } = await supabase
      .from("classrooms")
      .select("id, room_number, subject_slug, capacity, subjects(name)")
      .eq("id", params.classId)
      .maybeSingle();

    if (!classroom) {
      throw redirect({ to: "/home" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("course_slug, year")
      .eq("id", user.id)
      .maybeSingle();

    // Teachers are moderators/admins. Pathwaay has no separate teacher table,
    // so the existing role system is the honest source of truth rather than a
    // parallel one that could drift out of step.
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: user.id, _role: "moderator" }),
    ]);
    const isModerator = Boolean(isAdmin || isMod);

    // Students may only enter classrooms for subjects on their own course and
    // year. Moderators can enter any room, since that is the point of the role.
    if (!isModerator) {
      const year = Math.max(1, parseInt(profile?.year ?? "1", 10) || 1);
      const { data: allowed } = profile?.course_slug
        ? await supabase.rpc("get_course_subjects", {
            _course_slug: profile.course_slug,
            _year: year,
          })
        : { data: null };

      const canJoin = (allowed ?? []).some((s) => s.slug === classroom.subject_slug);
      if (!canJoin) {
        throw redirect({ to: "/home" });
      }
    }

    const subjectName = (classroom.subjects as { name: string } | null)?.name ?? "Classroom";
    return {
      classroom: {
        id: classroom.id,
        title: `${subjectName} · Room ${classroom.room_number}`,
        capacity: classroom.capacity,
      },
      isModerator,
    };
  },
  component: Classroom,
});

function Classroom() {
  const { classId } = Route.useParams();
  const { classroom, isModerator } = Route.useRouteContext();
  const { profile } = usePlan();
  const nav = useNavigate();

  const [roomName, setRoomName] = useState<string | null>(null);
  const displayName = profile?.name?.trim() || "Student";

  // Hashing is async, so the meeting cannot start until the name is ready.
  useEffect(() => {
    let cancelled = false;
    void roomNameFor(classId).then((name) => {
      if (!cancelled) setRoomName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const jitsi = useJitsi({
    roomName,
    displayName,
    email: profile?.email,
    isModerator,
    onLeave: () => nav({ to: "/home" }),
  });

  const {
    containerRef,
    status,
    error,
    participants,
    audioMuted,
    videoMuted,
    handRaised,
    sharing,
    unreadChat,
  } = jitsi;

  // Surfaces the "answer the Jitsi prompt" hint once joining has clearly
  // stalled, rather than the moment it starts.
  const [slowJoin, setSlowJoin] = useState(false);
  useEffect(() => {
    if (status !== "joining") {
      setSlowJoin(false);
      return;
    }
    const t = window.setTimeout(() => setSlowJoin(true), 12_000);
    return () => window.clearTimeout(t);
  }, [status]);

  // Students start muted in a 30-person room; say so once rather than leaving
  // someone wondering why nobody can hear them.
  useEffect(() => {
    if (status === "joined" && !isModerator) {
      toast("You joined muted — tap the mic to speak.", { id: "joined-muted" });
    }
  }, [status, isModerator]);

  const total = participants.length + 1;

  return (
    <div className="flex h-[100dvh] flex-col bg-room text-white">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <button
          onClick={() => nav({ to: "/home" })}
          aria-label="Leave classroom"
          className="-ml-1 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <PathwaayMark className="h-9 w-9" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{classroom.title}</span>
            {isModerator && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-amber">
                <ShieldCheck className="h-3 w-3" /> TEACHER
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            {status === "joined" ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                Live · {total} {total === 1 ? "person" : "people"}
              </>
            ) : status === "error" ? (
              "Not connected"
            ) : (
              "Connecting…"
            )}
          </div>
        </div>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="hidden items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/60 md:inline-flex">
            <Users className="h-3.5 w-3.5" />
            {total}/{classroom.capacity}
          </span>
          <PathwaayWordmark tone="onDark" className="text-[13px] opacity-60" />
        </div>
      </header>

      {/* Meeting surface. The iframe fills this; our states sit on top of it. */}
      <main className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />

        {/* Only cover the iframe when there is nothing behind it to cover, or
         * when the meeting has failed outright.
         *
         * This used to render whenever status !== "joined", which meant that
         * once Jitsi loaded and showed something needing a click — meet.jit.si
         * asks the first person to authenticate before it will start a room —
         * the prompt sat behind an opaque panel that also swallowed the click.
         * The meeting could never start, so it looked stuck on "Joining...". */}
        {(status === "loading" || status === "error") && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-room px-6">
            {status === "error" ? (
              <div className="max-w-sm text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/20 text-danger">
                  <WifiOff className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-lg font-bold">Couldn't join the classroom</h2>
                <p className="mt-2 text-sm text-white/60">{error}</p>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    onClick={() => window.location.reload()}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Try again
                  </button>
                  <button
                    onClick={() => nav({ to: "/home" })}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
                  >
                    Go home
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <PathwaayMark className="mx-auto h-14 w-14 animate-pulse" />
                <p className="mt-4 text-sm font-medium">Preparing your classroom…</p>
                <p className="mt-1 text-xs text-white/40">
                  Allow camera and microphone when your browser asks.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Joining: a badge, not a curtain. Jitsi renders its own connecting
         * state underneath and must stay clickable. */}
        {status === "joining" && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full bg-room-card/90 px-4 py-2 text-xs font-medium text-white/80 shadow-elevated ring-1 ring-white/10 backdrop-blur">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
              Joining…
            </div>
          </div>
        )}

        {/* If the handshake has not completed after a while, the cause is
         * almost always meet.jit.si waiting for someone to authenticate. Say
         * so instead of spinning forever. */}
        {status === "joining" && slowJoin && (
          <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            <div className="max-w-md rounded-xl border border-warning/40 bg-room-card/95 px-4 py-3 text-center shadow-elevated backdrop-blur">
              <p className="text-xs font-semibold text-warning">Still joining</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/60">
                If you can see a Jitsi prompt above, answer it — the public server asks the first
                person in a room to sign in. Everyone else can then join straight through.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Controls — ours, driving Jitsi through executeCommand. */}
      <div className="shrink-0 border-t border-white/10 bg-room-card/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <Ctl
            label={audioMuted ? "Unmute" : "Mute"}
            onClick={jitsi.toggleAudio}
            disabled={status !== "joined"}
            active={!audioMuted}
            danger={audioMuted}
          >
            {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Ctl>

          <Ctl
            label={videoMuted ? "Start video" : "Stop video"}
            onClick={jitsi.toggleVideo}
            disabled={status !== "joined"}
            active={!videoMuted}
            danger={videoMuted}
          >
            {videoMuted ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </Ctl>

          <Ctl
            label={handRaised ? "Lower hand" : "Raise hand"}
            onClick={jitsi.toggleHand}
            disabled={status !== "joined"}
            active={handRaised}
          >
            <Hand className="h-5 w-5" />
          </Ctl>

          <Ctl
            label="Chat"
            onClick={jitsi.toggleChat}
            disabled={status !== "joined"}
            badge={unreadChat}
          >
            <MessageSquare className="h-5 w-5" />
          </Ctl>

          <Ctl
            label={sharing ? "Stop sharing" : "Share screen"}
            onClick={jitsi.toggleShare}
            disabled={status !== "joined"}
            active={sharing}
            className="hidden sm:flex"
          >
            <MonitorUp className="h-5 w-5" />
          </Ctl>

          <Ctl
            label="Grid view"
            onClick={jitsi.toggleTileView}
            disabled={status !== "joined"}
            className="hidden sm:flex"
          >
            <LayoutGrid className="h-5 w-5" />
          </Ctl>

          {isModerator && (
            <Ctl
              label="Mute everyone"
              onClick={() => {
                jitsi.muteEveryone();
                toast.success("Muted everyone");
              }}
              disabled={status !== "joined"}
            >
              <MicOff className="h-5 w-5" />
            </Ctl>
          )}

          <Ctl
            label="Leave classroom"
            onClick={() => (status === "joined" ? jitsi.hangup() : nav({ to: "/home" }))}
            wide
            className="bg-danger font-semibold text-white hover:bg-danger/90"
          >
            <PhoneOff className="h-5 w-5" />
            <span className="text-sm">Leave</span>
          </Ctl>
        </div>

        {IS_PUBLIC_JITSI && status === "joined" && (
          <p className="mt-2 text-center text-[10px] text-white/25">
            Running on Jitsi's public server — see SETUP.md before real classes.
          </p>
        )}
      </div>
    </div>
  );
}

/** Round control button with a hover label, matching the study-room controls. */
function Ctl({
  children,
  label,
  onClick,
  disabled,
  active,
  danger,
  wide,
  badge,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  wide?: boolean;
  badge?: number;
  className?: string;
}) {
  return (
    <div className={cn("group relative flex", className)}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={cn(
          "relative flex h-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40",
          wide ? "gap-2 px-5" : "w-11",
          active && "bg-success/20 text-success",
          danger && "bg-danger/20 text-danger",
          className,
        )}
      >
        {children}
        {!!badge && badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-elevated ring-1 ring-white/10 group-hover:block">
        {label}
      </span>
    </div>
  );
}
