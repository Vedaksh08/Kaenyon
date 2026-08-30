import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Hand,
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
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { createClassroomToken } from "@/lib/livekit.functions";
import { useLiveKit } from "@/lib/use-livekit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/classroom/$classId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Classroom — Pathwaay" },
      { name: "description", content: "Join your live Pathwaay classroom." },
    ],
  }),
  component: Classroom,
});

interface Session {
  token: string;
  url: string;
  isModerator: boolean;
  title: string;
  capacity: number;
}

function Classroom() {
  const { classId } = Route.useParams();
  const nav = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // The server decides whether this student may join and signs a token saying
  // so. Nothing on this page can grant access by itself.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          nav({ to: "/login", replace: true });
          return;
        }
        const result = await createClassroomToken({ data: { classId, accessToken } });
        if (!cancelled) setSession(result);
      } catch (e) {
        if (cancelled) return;
        setAuthError(e instanceof Error ? e.message : "Could not join this classroom.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, nav]);

  const live = useLiveKit({
    token: session?.token ?? null,
    url: session?.url ?? null,
    startMuted: !session?.isModerator,
    onDisconnected: () => nav({ to: "/home" }),
  });

  const isModerator = session?.isModerator ?? false;
  const total = live.peers.length + 1;
  const error = authError ?? live.error;
  const connecting = !session || live.status === "connecting";

  useEffect(() => {
    if (live.status === "connected" && !isModerator) {
      toast("You joined muted — tap the mic to speak.", { id: "joined-muted" });
    }
  }, [live.status, isModerator]);

  if (error) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-room px-6 text-white">
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
      </div>
    );
  }

  const leaveNow = () => void live.leave().then(() => nav({ to: "/home" }));

  return (
    <div className="flex h-[100dvh] flex-col bg-room text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <button
          onClick={leaveNow}
          aria-label="Leave classroom"
          className="-ml-1 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <PathwaayMark className="h-9 w-9" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{session?.title ?? "Classroom"}</span>
            {isModerator && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-amber">
                <ShieldCheck className="h-3 w-3" /> TEACHER
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            {live.status === "connected" ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                Live · {total} {total === 1 ? "person" : "people"}
              </>
            ) : live.status === "reconnecting" ? (
              "Reconnecting…"
            ) : (
              "Connecting…"
            )}
          </div>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="hidden items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/60 md:inline-flex">
            <Users className="h-3.5 w-3.5" />
            {total}/{session?.capacity ?? 30}
          </span>
          <PathwaayWordmark tone="onDark" className="text-[13px] opacity-60" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {connecting ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <PathwaayMark className="mx-auto h-14 w-14 animate-pulse" />
              <p className="mt-4 text-sm font-medium">Joining your classroom…</p>
              <p className="mt-1 text-xs text-white/40">
                Allow camera and microphone when your browser asks.
              </p>
            </div>
          </div>
        ) : (
          // auto-fit keeps tiles sensible from 1 person to 30 without a
          // hardcoded breakpoint per participant count.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Tile
              name="You"
              track={live.localVideo}
              muted
              mirrored
              micMuted={live.micMuted}
              isYou
              isTeacher={isModerator}
              handRaised={live.handRaised}
            />
            {live.peers.map((p) => (
              <Tile
                key={p.identity}
                name={p.name}
                track={p.video}
                audioTrack={p.audio}
                micMuted={p.micMuted}
                speaking={p.speaking}
                isScreenShare={p.isScreenShare}
                handRaised={live.handsRaised.has(p.identity)}
              />
            ))}
          </div>
        )}
      </main>

      <div className="shrink-0 border-t border-white/10 bg-room-card/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <Ctl
            label={live.micMuted ? "Unmute" : "Mute"}
            onClick={() => void live.toggleMic()}
            disabled={live.status !== "connected"}
            active={!live.micMuted}
            danger={live.micMuted}
          >
            {live.micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Ctl>

          <Ctl
            label={live.camMuted ? "Start video" : "Stop video"}
            onClick={() => void live.toggleCam()}
            disabled={live.status !== "connected"}
            active={!live.camMuted}
            danger={live.camMuted}
          >
            {live.camMuted ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </Ctl>

          <Ctl
            label={live.handRaised ? "Lower hand" : "Raise hand"}
            onClick={() => void live.toggleHand()}
            disabled={live.status !== "connected"}
            active={live.handRaised}
          >
            <Hand className="h-5 w-5" />
          </Ctl>

          <Ctl
            label={live.sharing ? "Stop sharing" : "Share screen"}
            onClick={() => void live.toggleShare()}
            disabled={live.status !== "connected"}
            active={live.sharing}
            className="hidden sm:flex"
          >
            <MonitorUp className="h-5 w-5" />
          </Ctl>

          {isModerator && (
            <Ctl
              label="Mute everyone"
              onClick={() => {
                void live.muteEveryone();
                toast.success("Muted everyone");
              }}
              disabled={live.status !== "connected"}
            >
              <MicOff className="h-5 w-5" />
            </Ctl>
          )}

          <Ctl
            label="Leave classroom"
            onClick={leaveNow}
            wide
            className="bg-danger font-semibold text-white hover:bg-danger/90"
          >
            <PhoneOff className="h-5 w-5" />
            <span className="text-sm">Leave</span>
          </Ctl>
        </div>
      </div>
    </div>
  );
}

/** One participant, rendering a raw MediaStreamTrack into a <video>. */
function Tile({
  name,
  track,
  audioTrack,
  muted,
  mirrored,
  micMuted,
  speaking,
  isYou,
  isTeacher,
  isScreenShare,
  handRaised,
}: {
  name: string;
  track?: MediaStreamTrack | null;
  audioTrack?: MediaStreamTrack;
  muted?: boolean;
  mirrored?: boolean;
  micMuted?: boolean;
  speaking?: boolean;
  isYou?: boolean;
  isTeacher?: boolean;
  isScreenShare?: boolean;
  handRaised?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!track) {
      el.srcObject = null;
      return;
    }
    el.srcObject = new MediaStream([track]);
    void el.play?.().catch(() => {});
  }, [track]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioTrack) return;
    el.srcObject = new MediaStream([audioTrack]);
    void el.play?.().catch(() => {});
  }, [audioTrack]);

  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10",
        speaking && "ring-2 ring-success",
      )}
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={cn(
            "h-full w-full",
            isScreenShare ? "object-contain" : "object-cover",
            mirrored && "scale-x-[-1]",
          )}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
            {name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Remote audio needs its own element; the video tag is muted for peers
       * whose camera is off. */}
      {audioTrack && <audio ref={audioRef} autoPlay />}

      {handRaised && (
        <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand-amber text-navy">
          <Hand className="h-4 w-4" />
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {name}
          {isYou && " (You)"}
        </span>
        {isTeacher && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-amber" />}
        {micMuted ? (
          <MicOff className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : (
          <Mic className="h-3.5 w-3.5 shrink-0 text-success" />
        )}
      </div>
    </div>
  );
}

function Ctl({
  children,
  label,
  onClick,
  disabled,
  active,
  danger,
  wide,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  wide?: boolean;
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
          "flex h-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40",
          wide ? "gap-2 px-5" : "w-11",
          active && "bg-success/20 text-success",
          danger && "bg-danger/20 text-danger",
          className,
        )}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-elevated ring-1 ring-white/10 group-hover:block">
        {label}
      </span>
    </div>
  );
}
