import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MessageSquare,
  X,
  MoreVertical,
  Send,
  ArrowLeft,
  UserPlus,
  VolumeX,
  Check,
  MonitorUp,
  PenLine,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { usePlan } from "@/lib/plan-context";
import { ReportModal, BlockModal } from "@/components/report-block-modals";
import { RatingModal } from "@/components/rating-modal";
import { supabase } from "@/integrations/supabase/client";
import { sendFriendRequest, markPresence, clearPresence } from "@/lib/social";
import { useWebrtcMesh } from "@/lib/use-webrtc-mesh";
import { Whiteboard } from "@/components/whiteboard";

/**
 * `audible` is off by default: the main classroom is silent by design, so
 * playing remote audio there would break the whole premise. Private sessions
 * opt in.
 */
function RemoteVideo({
  stream,
  audible = false,
  contain = false,
}: {
  stream: MediaStream;
  audible?: boolean;
  /** Letterbox rather than crop — a shared screen must never be cut off. */
  contain?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // Callback ref: the element remounts when the layout switches to the
  // presentation stage, and an effect keyed on [stream] would not re-attach.
  const attach = (v: HTMLVideoElement | null) => {
    ref.current = v;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };
  useEffect(() => {
    attach(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);
  return (
    <video
      ref={attach}
      autoPlay
      playsInline
      muted={!audible}
      className={`h-full w-full rounded-lg ${contain ? "object-contain" : "object-cover"}`}
    />
  );
}

/**
 * Full-screen and unmissable, like the AFK warning. A toast was too easy to
 * miss while the strike count kept climbing toward removal.
 */
function NsfwWarning({
  strikes,
  onTurnOffCamera,
}: {
  strikes: number;
  onTurnOffCamera: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-danger/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-danger/40 bg-room-card p-6 text-center shadow-elevated">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/20 text-danger">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-white">Inappropriate content detected</h3>
        <p className="mt-2 text-sm text-white/70">
          Your camera is showing content that isn't allowed in a classroom. Cover up or turn your
          camera off now.
        </p>
        <div className="mt-4 rounded-lg bg-danger/10 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-danger">
            Warning {strikes} of {NSFW_STRIKES_MAX}
          </div>
          <div className="mt-1 text-xs text-white/60">
            You'll be removed from the classroom after {NSFW_STRIKES_MAX} warnings.
          </div>
        </div>
        <button
          onClick={onTurnOffCamera}
          className="mt-5 w-full rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:bg-danger/90"
        >
          Turn my camera off
        </button>
      </div>
    </div>
  );
}

/** Local preview of the screen we are sharing. */
function ScreenPreview({ stream }: { stream: MediaStream }) {
  const attach = (v: HTMLVideoElement | null) => {
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };
  return <video ref={attach} autoPlay muted playsInline className="h-full w-full object-contain" />;
}

export const Route = createFileRoute("/_authenticated/room/$roomId")({
  head: () => ({
    meta: [
      { title: "Study Room — Kaenyon" },
      {
        name: "description",
        content:
          "A live Kaenyon classroom: ask doubts, offer help and run private solving sessions.",
      },
      { property: "og:title", content: "Study Room — Kaenyon" },
      { property: "og:description", content: "Live peer-to-peer doubt solving classroom." },
    ],
  }),
  component: Room,
});

interface Participant {
  id: string;
  userId?: string;
  name: string;
  initials: string;
  color: string;
  mic: boolean;
  cam: boolean;
  pro?: boolean;
  you?: boolean;
  feed?: boolean;
}

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
  "bg-cyan-500",
  "bg-fuchsia-500",
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface Doubt {
  id: string;
  user: string;
  author_id: string;
  status: "open" | "offer" | "solving";
  text: string;
}

/** Consecutive unsafe samples before removal from the classroom. */
const NSFW_STRIKES_MAX = 3;

function Room() {
  const { roomId } = Route.useParams();
  const nav = useNavigate();
  const { profile } = usePlan();
  const youName = profile?.name?.trim() ? `${profile.name.split(" ")[0]} (You)` : "You";
  const [userId, setUserId] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const [mic, setMic] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [draft, setDraft] = useState("");
  const [privateSession, setPrivateSession] = useState(false);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  // True when the invite modal was opened from your own doubt card, which makes
  // you the asker and therefore the one who rates afterwards.
  const [invitingForOwnDoubt, setInvitingForOwnDoubt] = useState(false);
  const [rating, setRating] = useState(false);
  const [ratingFor, setRatingFor] = useState<string | null>(null);
  // Only the person who raised the doubt rates, and only the helper gets rated.
  // Set when a private session starts; null for the helper, so leaving the
  // session never prompts them.
  const [pendingRatee, setPendingRatee] = useState<string | null>(null);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<{ name: string; target: "user" | "doubt" } | null>(
    null,
  );
  const [blockFor, setBlockFor] = useState<string | null>(null);
  const [helpOffer, setHelpOffer] = useState<{ helper: string; doubt: string } | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{
    hostUserId: string;
    hostName: string;
    askerUserId: string;
  } | null>(null);

  const [blocked, setBlocked] = useState<string[]>([]);
  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  // The header used to print the raw room UUID at the user.
  const [roomTitle, setRoomTitle] = useState("Classroom");
  // Unique per browser tab, so the same account on two devices shows as two people.
  const sessionKeyRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}`,
  );
  // Mirrors of cam/mic for callbacks that close over stale state — notably the
  // presence subscribe handler, which runs once.
  const camRef = useRef(false);
  const micRef = useRef(false);
  camRef.current = cam;
  micRef.current = mic;
  const streamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gumTokenRef = useRef(0);

  // AFK monitor: after 60s idle -> warn + 120s countdown -> auto-leave
  const IDLE_MS = 60_000;
  const KICK_MS = 120;
  const [afkWarn, setAfkWarn] = useState(false);
  const [afkSeconds, setAfkSeconds] = useState(KICK_MS);
  const lastActivityRef = useRef<number>(Date.now());
  const afkWarnRef = useRef(false);

  // Presence detection via facial recognition (MediaPipe FaceDetector).
  // No face detected in the camera feed for IDLE_MS -> AFK warning starts.
  useEffect(() => {
    const SAMPLE_MS = 1500;
    let detector: import("@mediapipe/tasks-vision").FaceDetector | null = null;
    let cancelled = false;
    let interval: number | null = null;

    const bump = () => {
      lastActivityRef.current = Date.now();
      if (afkWarnRef.current) {
        afkWarnRef.current = false;
        setAfkWarn(false);
        setAfkSeconds(KICK_MS);
        toast.success("Welcome back — face detected");
      }
    };

    const tick = () => {
      const v = videoRef.current;
      const stream = streamRef.current;
      const camOn = !!stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");

      if (!camOn || !v || v.readyState < 2 || !detector) {
        if (!afkWarnRef.current && Date.now() - lastActivityRef.current >= IDLE_MS) {
          afkWarnRef.current = true;
          setAfkWarn(true);
          setAfkSeconds(KICK_MS);
        }
        return;
      }

      try {
        const res = detector.detectForVideo(v, performance.now());
        if (res.detections && res.detections.length > 0) {
          bump();
        }
      } catch {
        // transient errors — ignore
      }

      if (!afkWarnRef.current && Date.now() - lastActivityRef.current >= IDLE_MS) {
        afkWarnRef.current = true;
        setAfkWarn(true);
        setAfkSeconds(KICK_MS);
      }
    };

    (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
        );
        if (cancelled) return;
        detector = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
        });
        if (cancelled) {
          detector.close();
          detector = null;
          return;
        }
        interval = window.setInterval(tick, SAMPLE_MS);
      } catch (err) {
        console.error("Face detector failed to load", err);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      detector?.close();
    };
  }, []);

  // NSFW camera moderation.
  //
  // Deliberately conservative: only explicit classes count, and "Sexy" is
  // ignored entirely — it fires on ordinary webcam footage (a plain t-shirt,
  // dim lighting, sitting close to the lens) and was ejecting real students
  // mid-class. Strikes must also be consecutive *and* survive a re-check, so a
  // single bad frame cannot remove anyone.
  //
  // The model is loaded lazily well after join so it never delays the camera.
  const [nsfwWarn, setNsfwWarn] = useState(false);
  const [nsfwStrikes, setNsfwStrikes] = useState(0);
  useEffect(() => {
    // Checked every second: at 5s intervals with 5 strikes it took the best part
    // of a minute to react, which is far too long for a room full of students.
    const SAMPLE_MS = 1000;
    const LOAD_DELAY_MS = 2000;
    const THRESHOLD = 0.75;
    const STRIKES_MAX = NSFW_STRIKES_MAX;
    let cancelled = false;
    let interval: number | null = null;
    let timer: number | null = null;
    let model: import("nsfwjs").NSFWJS | null = null;
    let strikes = 0;
    let kicked = false;

    // Sample from our own detached <video> rather than whichever element
    // happens to be on screen. The visible tile unmounts during a private
    // session and videoRef can be null, which silently stopped moderation
    // exactly where it still needs to run.
    const probe = document.createElement("video");
    probe.muted = true;
    probe.playsInline = true;
    probe.autoplay = true;
    let probeStream: MediaStream | null = null;

    const attachProbe = () => {
      const stream = streamRef.current;
      if (!stream || probeStream === stream) return;
      probeStream = stream;
      probe.srcObject = stream;
      const p = probe.play?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    const scoreFrame = async () => {
      const preds = await model!.classify(probe, 5);
      // "Sexy" is excluded on purpose — see note above.
      return preds
        .filter((p) => p.className === "Porn" || p.className === "Hentai")
        .reduce((s, p) => s + p.probability, 0);
    };

    const tick = async () => {
      if (cancelled || kicked || !model) return;
      const stream = streamRef.current;
      const camOn = !!stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
      if (!camOn) return;
      attachProbe();
      if (probe.readyState < 2 || probe.videoWidth === 0) return;
      try {
        const unsafe = await scoreFrame();
        if (unsafe < THRESHOLD) {
          if (strikes > 0) {
            setNsfwWarn(false);
            setNsfwStrikes(0);
          }
          strikes = 0;
          return;
        }

        // Second look before counting it — motion blur and odd frames produce
        // one-off false positives.
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        if ((await scoreFrame()) < THRESHOLD) return;

        strikes += 1;
        setNsfwStrikes(strikes);
        setNsfwWarn(true);
        if (strikes >= STRIKES_MAX) {
          kicked = true;
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user) {
            await supabase.from("reports").insert({
              reporter_id: userData.user.id,
              reported_user_id: userData.user.id,
              reason: "other",
              notes: `Auto-flagged by camera moderation (score ${unsafe.toFixed(2)})`,
            });
          }
          toast.error("Removed from classroom — inappropriate content detected");
          nav({ to: "/home" });
        }
      } catch {
        // ignore transient classify errors
      }
    };

    // Loading tfjs + the model is ~40MB of work; deferring it keeps the join
    // and the first camera frames fast.
    timer = window.setTimeout(() => {
      void (async () => {
        try {
          const tf = await import("@tensorflow/tfjs");
          await tf.ready();
          const nsfw = await import("nsfwjs");
          if (cancelled) return;
          // Pinned model: nsfw.load() with no argument fetches from a Google
          // CDN that is blocked on some networks, and the failure is silent.
          model = await nsfw.load();
          if (cancelled) return;
          console.info("[moderation] camera moderation active");
          interval = window.setInterval(tick, SAMPLE_MS);
        } catch (err) {
          console.error("[moderation] model failed to load — camera is UNMODERATED", err);
        }
      })();
    }, LOAD_DELAY_MS);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (interval) window.clearInterval(interval);
      probe.srcObject = null;
    };
  }, [nav]);

  useEffect(() => {
    if (!afkWarn) return;
    const t = window.setInterval(() => {
      setAfkSeconds((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          toast.error("Removed from classroom due to inactivity");
          nav({ to: "/home" });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [afkWarn, nav]);

  const dismissAfk = () => {
    lastActivityRef.current = Date.now();
    afkWarnRef.current = false;
    setAfkWarn(false);
    setAfkSeconds(KICK_MS);
  };

  const ensureStream = async (want: { audio: boolean; video: boolean }) => {
    const token = ++gumTokenRef.current;

    // Toggling the mic used to tear the whole stream down and re-run
    // getUserMedia, which restarts the camera and blanks everyone's tile for a
    // second or two. If we already hold the video track we need, just flip the
    // audio track instead.
    const current = streamRef.current;
    if (current && want.video) {
      const video = current.getVideoTracks()[0];
      if (video?.readyState === "live") {
        const audio = current.getAudioTracks()[0];
        if (want.audio && !audio) {
          try {
            const extra = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (token !== gumTokenRef.current) {
              extra.getTracks().forEach((t) => t.stop());
              return;
            }
            extra.getAudioTracks().forEach((t) => current.addTrack(t));
            setLocalStream(new MediaStream(current.getTracks()));
          } catch {
            toast.error("Could not access the microphone.");
            setMic(false);
          }
          return;
        }
        if (!want.audio && audio) {
          audio.stop();
          current.removeTrack(audio);
          setLocalStream(new MediaStream(current.getTracks()));
          return;
        }
        return; // already in the requested state
      }
    }

    // Otherwise fall back to a full re-acquire.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    if (!want.audio && !want.video) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Camera is not available in this browser.");
        setCam(false);
        setMic(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: want.audio,
        video: want.video ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      // If a newer request superseded this one (or the component unmounted while we awaited),
      // stop this stream so no stray camera track keeps the LED on.
      if (token !== gumTokenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setLocalStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = want.video ? stream : null;
        const p = videoRef.current.play?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      toast.success(
        `${want.video ? "Camera" : ""}${want.video && want.audio ? " & " : ""}${want.audio ? "Mic" : ""} enabled`,
      );
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === "NotAllowedError")
        toast.error("Permission denied. Allow camera/mic in settings.");
      else if (e.name === "NotFoundError") toast.error("No camera or microphone found.");
      else if (e.name === "NotReadableError") toast.error("Device is in use by another app.");
      else toast.error("Could not access camera/microphone.");
      streamRef.current = null;
      setLocalStream(null);
      if (videoRef.current) videoRef.current.srcObject = null;
      setCam(false);
      setMic(false);
    }
  };

  // Talking is only permitted inside a private session; the classroom itself is
  // silent by design.
  const toggleMic = () => {
    if (!privateSession) {
      toast("Mic is disabled in the classroom. Start a private session to talk.");
      return;
    }
    const next = !mic;
    setMic(next);
    void ensureStream({ audio: next, video: cam });
  };

  const toggleCam = async () => {
    if (cam) {
      toast("Camera must stay on in the classroom");
      return;
    }
    await enableClassCamera();
  };

  const [camPrompt, setCamPrompt] = useState(false);

  const enableClassCamera = async () => {
    await ensureStream({ audio: false, video: true });
    if (streamRef.current?.getVideoTracks().length) {
      setCam(true);
      setCamPrompt(false);
      setStreamTick((n) => n + 1);
    }
  };

  // Camera is manual only — user toggles via the control bar.
  const [streamTick, setStreamTick] = useState(0);

  // Callback ref rather than an effect: returning from a private session
  // remounts this <video>, and an effect keyed on [cam, streamTick] would not
  // re-run for a remount, leaving your own tile blank while everyone else could
  // still see you.
  const attachLocalVideo = (v: HTMLVideoElement | null) => {
    videoRef.current = v;
    const s = streamRef.current;
    if (!v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  // Still needed for the case where the stream arrives after the element.
  useEffect(() => {
    attachLocalVideo(videoRef.current);
  }, [cam, streamTick, localStream]);

  // Live peer-to-peer video with everyone else in the classroom.
  const peerIds = useMemo(() => remoteParticipants.map((p) => p.id), [remoteParticipants]);
  const { remoteStreams } = useWebrtcMesh({
    roomId,
    userId: userId ? sessionKeyRef.current : null,
    peerIds,
    localStream,
  });

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Auto-enable camera when the student joins the room.
  useEffect(() => {
    enableClassCamera().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close menu on outside click
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  const youParticipant: Participant = {
    id: userId ?? "you",
    name: youName,
    initials: initialsFor(profile?.name || "You"),
    color: "bg-primary",
    mic,
    cam,
    you: true,
  };

  const visibleParticipants = useMemo(
    () => [
      youParticipant,
      ...remoteParticipants.filter((p) => !blocked.includes(p.userId ?? p.id)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remoteParticipants, blocked, userId, youName, mic, cam],
  );

  const invitableParticipants = useMemo(
    () => remoteParticipants.filter((p) => !blocked.includes(p.userId ?? p.id)),
    [remoteParticipants, blocked],
  );

  const visibleDoubts = doubts.filter((d) => !blocked.includes(d.user));

  // Resolve "Computer Science · Room 2" for the header.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("classrooms")
        .select("room_number, subjects(name)")
        .eq("id", roomId)
        .maybeSingle();
      if (cancelled || !data) return;
      const subjectName = (data.subjects as { name: string } | null)?.name;
      setRoomTitle(
        subjectName ? `${subjectName} · Room ${data.room_number}` : `Room ${data.room_number}`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Load doubts for this classroom + subscribe to realtime inserts/deletes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Sweep first, so a room opened after everyone left does not briefly
      // render their abandoned doubts.
      await supabase.rpc("sweep_stale_presence");
      if (cancelled) return;
      const { data: allRows } = await supabase
        .from("doubts")
        .select("id, body, author_id, created_at")
        .eq("classroom_id", roomId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled || !allRows) return;

      // A doubt is only answerable while its author is still in the room, so
      // show it only if they are. The sweep above deletes the rest; this keeps
      // the list honest in the gap before it runs. Age is not the test — an
      // author sitting in the room for an hour should keep their question.
      const { data: live } = await supabase.rpc("get_room_presence", {
        _classroom_id: roomId,
      });
      if (cancelled) return;
      const present = new Set((live ?? []).map((r) => r.user_id));
      const rows = allRows.filter((r) => present.has(r.author_id));
      const ids = Array.from(new Set(rows.map((r) => r.author_id)));
      const nameMap: Record<string, string> = {};
      if (ids.length) {
        // RLS restricts `profiles` SELECT to the owner, so querying the table
        // directly returns nothing for other people and every name falls back
        // to "Student". This RPC exposes just name/avatar for any user.
        const { data: profs } = await supabase.rpc("get_public_profiles", { _user_ids: ids });
        (profs ?? []).forEach((p) => {
          if (p.name?.trim()) nameMap[p.id] = p.name.trim();
        });
      }
      setDoubts(
        rows.map((r) => ({
          id: r.id,
          user: nameMap[r.author_id] || "Student",
          author_id: r.author_id,
          status: "open" as const,
          text: r.body,
        })),
      );
    })();

    const channel = supabase
      .channel(`doubts:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "doubts", filter: `classroom_id=eq.${roomId}` },
        async (payload) => {
          const row = payload.new as { id: string; body: string; author_id: string };
          const { data: prof } = await supabase.rpc("get_public_profile", {
            _user_id: row.author_id,
          });
          const authorName = prof?.[0]?.name?.trim() || "Student";
          setDoubts((prev) =>
            prev.some((d) => d.id === row.id)
              ? prev
              : [
                  {
                    id: row.id,
                    user: authorName,
                    author_id: row.author_id,
                    status: "open",
                    text: row.body,
                  },
                  ...prev,
                ],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "doubts", filter: `classroom_id=eq.${roomId}` },
        (payload) => {
          const oldRow = payload.old as { id: string };
          setDoubts((prev) => prev.filter((d) => d.id !== oldRow.id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Presence: track real users currently in this classroom via Supabase Realtime.
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || cancelled) return;
      setUserId(uid);
      const { data: prof } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", uid)
        .maybeSingle();
      const displayName = prof?.name?.trim() || userData.user?.email?.split("@")[0] || "Student";

      // Presence is keyed per browser session so signalling stays unique, but the
      // grid only ever shows real, distinct signed-in people (never your own
      // extra tabs, never duplicates of the same account).
      const myKey = sessionKeyRef.current;
      channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: myKey } } });
      presenceChannelRef.current = channel;

      const sync = () => {
        const state = channel!.presenceState() as Record<
          string,
          Array<{ user_id: string; session_key?: string; name: string; mic: boolean; cam: boolean }>
        >;
        const byUser = new Map<string, Participant>();
        for (const [key, metas] of Object.entries(state)) {
          if (key === myKey) continue;
          const meta = metas[0];
          if (!meta || !meta.user_id) continue;
          if (meta.user_id === uid) continue; // your own other tab
          if (byUser.has(meta.user_id)) continue; // same person, second session
          byUser.set(meta.user_id, {
            id: meta.session_key || key,
            userId: meta.user_id,
            name: meta.name,
            initials: initialsFor(meta.name),
            color: colorFor(meta.user_id),
            mic: !!meta.mic,
            cam: !!meta.cam,
          });
        }
        setRemoteParticipants([...byUser.values()]);
      };

      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        // Someone announced they are leaving. Presence "leave" can lag by tens
        // of seconds when a socket dies without a clean close, so drop them
        // straight away and let the next sync reconcile.
        .on("broadcast", { event: "left" }, ({ payload }) => {
          const key = (payload as { session_key?: string })?.session_key;
          if (!key) return;
          setRemoteParticipants((prev) => prev.filter((p) => p.id !== key));
        })
        .on("broadcast", { event: "help_offer" }, ({ payload }) => {
          const p = payload as { to: string; helper: string; doubt: string };
          if (p?.to !== uid) return;
          setHelpOffer({ helper: p.helper, doubt: p.doubt });
        })
        // Someone invited us into their private session -> ask to accept/reject.
        .on("broadcast", { event: "private_invite" }, ({ payload }) => {
          const p = payload as {
            to: string[];
            hostUserId: string;
            hostName: string;
            askerUserId?: string;
          };
          if (!p?.to?.includes(uid)) return;
          setIncomingInvite({
            hostUserId: p.hostUserId,
            hostName: p.hostName,
            askerUserId: p.askerUserId ?? p.hostUserId,
          });
        })
        // An invitee answered our invite.
        .on("broadcast", { event: "private_invite_response" }, ({ payload }) => {
          const p = payload as {
            to: string;
            fromUserId: string;
            fromName: string;
            accepted: boolean;
          };
          if (p?.to !== uid) return;
          if (p.accepted) {
            setInvitedIds((prev) => (prev.includes(p.fromUserId) ? prev : [...prev, p.fromUserId]));
            toast.success(`${p.fromName} joined your private session`);
          } else {
            toast(`${p.fromName} declined your invite`);
          }
        })

        // Someone left the private session — drop them so their tile goes with
        // them instead of hanging around until the page is reloaded.
        .on("broadcast", { event: "private_leave" }, ({ payload }) => {
          const p = payload as { userId?: string; sessionKey?: string };
          if (!p?.userId) return;
          setInvitedIds((prev) => prev.filter((id) => id !== p.userId && id !== p.sessionKey));
        })

        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // Read the live values rather than hardcoding false: the camera is
            // usually already on by the time this channel subscribes, and the
            // sync effect below only fires on *change*, so everyone else was
            // left believing our camera was off.
            await channel!.track({
              user_id: uid,
              session_key: myKey,
              name: displayName,
              mic: micRef.current,
              cam: camRef.current,
            });
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) {
        // Broadcast our departure before untracking. untrack() is async and the
        // socket often closes first, so peers would otherwise keep rendering a
        // tile for us until the server timed the connection out — the "they
        // only disappear when I refresh" symptom.
        void channel.send({
          type: "broadcast",
          event: "left",
          payload: { session_key: sessionKeyRef.current },
        });
        void channel.untrack().then(() => supabase.removeChannel(channel!));
      }
      presenceChannelRef.current = null;
    };
  }, [roomId]);

  // Closing the tab or hitting back never runs React cleanup, so leave here
  // too — otherwise the room keeps showing people who are long gone.
  useEffect(() => {
    const leave = () => {
      const ch = presenceChannelRef.current;
      if (ch) {
        void ch.send({
          type: "broadcast",
          event: "left",
          payload: { session_key: sessionKeyRef.current },
        });
        void ch.untrack();
      }
      if (userId) {
        void clearPresence(userId);
        void withdrawMyDoubts(userId);
      }
    };
    // pagehide covers tab close and bfcache; visibilitychange catches mobile
    // browsers that background the tab without ever firing pagehide.
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, roomId]);

  // A doubt only makes sense while its author is in the room to be helped, so
  // retract them on the way out rather than leaving the list full of questions
  // nobody can answer.
  const withdrawMyDoubts = async (uid: string) => {
    await supabase.from("doubts").delete().eq("classroom_id", roomId).eq("author_id", uid);
  };

  useEffect(() => {
    if (!userId) return;
    return () => {
      void withdrawMyDoubts(userId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, roomId]);

  // Publish a database presence heartbeat so friends can see we're in this class.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let interval: number | null = null;
    (async () => {
      const { data: room } = await supabase
        .from("classrooms")
        .select("subject_slug")
        .eq("id", roomId)
        .maybeSingle();
      if (cancelled) return;
      const slug = room?.subject_slug ?? null;
      await markPresence(userId, roomId, slug);
      // Clear anyone whose heartbeat has lapsed. Unload handlers are killed
      // often enough that we cannot rely on people cleaning up after
      // themselves, so whoever is still here does it for them.
      void supabase.rpc("sweep_stale_presence");
      interval = window.setInterval(() => {
        void markPresence(userId, roomId, slug);
        void supabase.rpc("sweep_stale_presence");
      }, 30_000);
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      void clearPresence(userId);
    };
  }, [userId, roomId]);

  // Push our mic/cam state into presence whenever it changes.
  //
  // The channel is created asynchronously, so on mount this often ran before it
  // existed and simply gave up — leaving everyone else with whatever state was
  // tracked at subscribe time. Retry until it lands.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let attempts = 0;
    const displayName = profile?.name?.trim() || "Student";

    const push = () => {
      if (cancelled) return true;
      const ch = presenceChannelRef.current;
      if (!ch) return false;
      void ch.track({
        user_id: userId,
        session_key: sessionKeyRef.current,
        name: displayName,
        mic,
        cam,
      });
      return true;
    };

    if (push()) return;
    const timer = window.setInterval(() => {
      if (push() || ++attempts > 20) window.clearInterval(timer);
    }, 300);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mic, cam, userId, profile?.name]);

  const ask = async () => {
    const text = draft.trim();
    if (!text) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("Sign in required");
      return;
    }
    setDraft("");
    const { error } = await supabase.from("doubts").insert({
      classroom_id: roomId,
      author_id: userData.user.id,
      body: text,
    });
    if (error) {
      toast.error(error.message);
      setDraft(text);
      return;
    }
    toast.success("Doubt posted to the room");
  };

  // Offering help records an answer, which counts towards the global rankings.
  const offerHelp = async (d: Doubt) => {
    if (!userId) {
      toast.error("Sign in required");
      return;
    }
    if (d.author_id === userId) return;
    const { data: existing } = await supabase
      .from("answers")
      .select("id")
      .eq("doubt_id", d.id)
      .eq("author_id", userId)
      .maybeSingle();
    if (existing) {
      toast("You already offered help on this doubt.");
      return;
    }
    const { error } = await supabase.from("answers").insert({
      doubt_id: d.id,
      author_id: userId,
      body: "Offered to solve this doubt live in the classroom.",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await presenceChannelRef.current?.send({
      type: "broadcast",
      event: "help_offer",
      payload: {
        to: d.author_id,
        helper: profile?.name?.trim() || "A student",
        doubt: d.text,
      },
    });
    toast.success(`Offer sent to ${d.user}`);
  };

  // Host: send invite requests. Nobody joins until they accept.
  //
  // `askerUserId` travels with the invite so both sides agree on who raised the
  // doubt. Either person can host — the helper by offering help, or the asker
  // via "Start Private" — so host identity alone cannot decide who rates whom.
  const sendInvites = async (ids: string[], askerUserId?: string) => {
    const targets = remoteParticipants
      .filter((p) => ids.includes(p.id))
      .map((p) => p.userId)
      .filter((x): x is string => !!x);
    if (!targets.length || !userId) return;
    await presenceChannelRef.current?.send({
      type: "broadcast",
      event: "private_invite",
      payload: {
        to: targets,
        hostUserId: userId,
        hostName: profile?.name?.trim() || "A student",
        askerUserId: askerUserId ?? userId,
      },
    });
    toast("Invite sent — waiting for them to accept.");
  };

  const startPrivateWith = async (ids: string[], askerUserId?: string) => {
    // Seed the session with the people we invited. Clearing this and waiting for
    // private_invite_response left the host in an empty room with no peers, so
    // the mesh had nobody to connect to and neither camera nor mic ever worked.
    const invitedUserIds = remoteParticipants
      .filter((p) => ids.includes(p.id))
      .map((p) => p.userId ?? p.id);
    setInvitedIds(invitedUserIds);
    setPrivateSession(true);
    // We only rate someone else. If we are the asker, the ratee is whoever we
    // invited; if we are the helper, we rate nobody.
    if (askerUserId && userId && askerUserId === userId) {
      setPendingRatee(invitedUserIds[0] ?? null);
    } else {
      setPendingRatee(null);
    }
    await sendInvites(ids, askerUserId);
  };

  // Invitee: answer an incoming invite.
  const respondToInvite = async (accepted: boolean) => {
    const invite = incomingInvite;
    setIncomingInvite(null);
    if (!invite || !userId) return;
    await presenceChannelRef.current?.send({
      type: "broadcast",
      event: "private_invite_response",
      payload: {
        to: invite.hostUserId,
        fromUserId: userId,
        fromName: profile?.name?.trim() || "A student",
        accepted,
      },
    });
    if (accepted) {
      setInvitedIds([invite.hostUserId]);
      // Only the student who raised the doubt rates, and they rate the helper.
      // If we are the asker, that is the host who offered; otherwise we are the
      // helper and rate nobody.
      setPendingRatee(invite.askerUserId === userId ? invite.hostUserId : null);
      setPrivateSession(true);
    }
  };

  if (privateSession) {
    const invitees = remoteParticipants.filter((p) => invitedIds.includes(p.userId ?? p.id));

    return (
      <>
        {/* Moderation keeps running in here, so the warning has to render here
         * too — this branch returns before the classroom's copy. */}
        {nsfwWarn && (
          <NsfwWarning
            strikes={nsfwStrikes}
            onTurnOffCamera={() => {
              void ensureStream({ audio: false, video: false });
              setCam(false);
              setNsfwWarn(false);
            }}
          />
        )}
        <PrivateSession
          youName={youName}
          invitees={invitees}
          roomParticipants={remoteParticipants.filter((p) => !blocked.includes(p.userId ?? p.id))}
          roomId={roomId}
          sessionKey={sessionKeyRef.current}
          selfUserId={userId}
          localStream={localStream}
          cam={cam}
          mic={mic}
          onToggleCam={() => void toggleCam()}
          onToggleMic={toggleMic}
          // pendingRatee is set only for the student who raised the doubt, which
          // is exactly who should be able to mute people here.
          isModerator={pendingRatee !== null}
          onReturn={() => {
            // Tell the others we are going. Without this the session only ended
            // locally and everyone else kept our tile on screen forever.
            void presenceChannelRef.current?.send({
              type: "broadcast",
              event: "private_leave",
              payload: { userId, sessionKey: sessionKeyRef.current },
            });
            setPrivateSession(false);
            setInvitedIds([]);
            // Talking is only allowed in private, so drop the mic on the way out.
            if (mic) {
              setMic(false);
              void ensureStream({ audio: false, video: true });
            }
            // Helpers have no pendingRatee, so they return to the room without
            // being asked to rate the person they just helped.
            if (pendingRatee) {
              setRatingFor(pendingRatee);
              setPendingRatee(null);
              setRating(true);
            }
          }}
          onInvite={(ids) => void sendInvites(ids)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-room text-white">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <button
          onClick={() => nav({ to: "/home" })}
          className="-ml-1 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          aria-label="Leave classroom"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{roomTitle}</div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
            Live · {remoteParticipants.length + 1}{" "}
            {remoteParticipants.length === 0 ? "person" : "people"}
          </div>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold transition hover:bg-white/20"
          >
            <UserPlus className="h-4 w-4" /> Invite to private
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        {/* Grid */}
        <main className={`flex-1 p-5 ${chatOpen ? "" : ""}`}>
          {remoteParticipants.length === 0 && (
            <div className="mb-4 rounded-lg border border-white/10 bg-room-card p-4 text-center">
              <p className="text-sm font-semibold text-white/80">No participant live</p>
              <p className="mt-1 text-xs text-white/50">
                You're the only one in this classroom right now.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleParticipants.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-xl border bg-room-card p-3 transition ${
                  p.you ? "border-primary/60" : "border-white/10"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === p.id ? null : p.id);
                  }}
                  className="absolute right-2 top-2 rounded p-1 text-white/60 hover:bg-white/10"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuFor === p.id && (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-9 z-10 w-44 rounded-lg border border-white/10 bg-room-card py-1 text-sm shadow-elevated"
                  >
                    {!p.you && (
                      <>
                        <button
                          onClick={() => {
                            nav({ to: "/u/$userId", params: { userId: p.userId ?? p.id } });
                            setMenuFor(null);
                          }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                        >
                          View Profile
                        </button>
                        <button
                          onClick={async () => {
                            setMenuFor(null);
                            try {
                              const msg = await sendFriendRequest(p.userId ?? p.id);
                              toast.success(`${msg} — ${p.name}`);
                            } catch (e) {
                              toast.error(
                                e instanceof Error ? e.message : "Could not send request",
                              );
                            }
                          }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                        >
                          Send Friend Request
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setReportFor({ name: p.name, target: "user" });
                        setMenuFor(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                    >
                      Report User
                    </button>
                    <button
                      onClick={() => {
                        setBlockFor(p.userId ?? p.id);
                        setMenuFor(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-danger hover:bg-white/10"
                    >
                      Block User
                    </button>
                  </div>
                )}
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-black/40">
                  {p.you && cam ? (
                    <video
                      ref={attachLocalVideo}
                      autoPlay
                      muted
                      playsInline
                      className="h-full w-full scale-x-[-1] object-cover"
                    />
                  ) : !p.you && remoteStreams[p.id] ? (
                    <RemoteVideo stream={remoteStreams[p.id]} />
                  ) : !p.you && p.cam ? (
                    <div className="flex flex-col items-center gap-2 text-white/50">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/70" />
                      <span className="text-[11px]">Connecting…</span>
                    </div>
                  ) : (
                    <div
                      className={`flex h-16 w-16 items-center justify-center rounded-full ${p.color} text-lg font-bold`}
                    >
                      {p.initials}
                    </div>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                  {/* Mic was never shown here at all, so a muted classmate
                   * looked identical to a talking one. */}
                  {(p.you ? mic : p.mic) ? (
                    <Mic className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <MicOff className="h-3.5 w-3.5 shrink-0 text-white/30" />
                  )}
                  {/* Trust the live track over the presence flag: presence can
                   * lag or arrive stale, and showing "camera off" next to a
                   * working picture is worse than showing nothing. */}
                  {(p.you ? cam : !!remoteStreams[p.id]?.getVideoTracks().length || p.cam) ? (
                    <Video className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <VideoOff className="h-3.5 w-3.5 shrink-0 text-danger" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom controls */}
          <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-room-card/95 px-3 py-2 shadow-elevated backdrop-blur">
            <CtlBtn
              title="Mic is disabled in the classroom — join a Private Session to talk"
              onClick={() =>
                toast("Mic is disabled in the classroom. Join a Private Session to talk.")
              }
              className="bg-danger/20 text-danger"
            >
              <MicOff className="h-5 w-5" />
            </CtlBtn>
            <CtlBtn
              title={cam ? "Turn camera off" : "Turn camera on"}
              onClick={toggleCam}
              className={cam ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}
            >
              {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </CtlBtn>

            <CtlBtn title="Interaction Center" onClick={() => setChatOpen((v) => !v)}>
              <MessageSquare className="h-5 w-5" />
            </CtlBtn>
            <CtlBtn
              title="Leave"
              onClick={() => nav({ to: "/home" })}
              className="bg-danger text-white"
            >
              <X className="h-5 w-5" />
            </CtlBtn>
          </div>
        </main>

        {/* Interaction Center */}
        {chatOpen && (
          <aside className="w-full shrink-0 border-t border-white/10 bg-room-card/40 p-4 md:w-80 md:border-l md:border-t-0">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold">Doubts</div>
              {visibleDoubts.length > 0 && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                  {visibleDoubts.length}
                </span>
              )}
            </div>

            <div className="mt-3 max-h-[calc(100vh-340px)] space-y-3 overflow-y-auto pr-1">
              {visibleDoubts.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center">
                  <MessageSquare className="mx-auto h-6 w-6 text-white/30" />
                  <p className="mt-2.5 text-xs font-medium text-white/70">No doubts yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                    Stuck on something? Type it below and someone here will help.
                  </p>
                </div>
              )}
              {visibleDoubts.map((d) => (
                <div key={d.id} className="relative rounded-lg border border-white/10 bg-room p-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === d.id ? null : d.id);
                    }}
                    className="absolute right-2 top-2 text-white/50 hover:text-white"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuFor === d.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-8 z-10 w-40 rounded-lg border border-white/10 bg-room-card py-1 text-xs shadow-elevated"
                    >
                      <button
                        onClick={() => {
                          setReportFor({ name: d.user, target: "doubt" });
                          setMenuFor(null);
                        }}
                        className="block w-full px-3 py-1.5 text-left hover:bg-white/10"
                      >
                        Report Doubt
                      </button>
                      <button
                        onClick={() => {
                          setBlockFor(d.user);
                          setMenuFor(null);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-danger hover:bg-white/10"
                      >
                        Block User
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold">{d.user}</span>
                    {d.status === "offer" && (
                      <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-bold text-success">
                        OFFER RECEIVED
                      </span>
                    )}
                    {d.status === "solving" && (
                      <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                        SOLVING
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-white/80">{d.text}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void offerHelp(d)}
                      disabled={d.author_id === userId}
                      className="rounded bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/20 disabled:opacity-40"
                    >
                      Offer Help
                    </button>

                    {d.author_id === userId ? (
                      <button
                        onClick={() => {
                          setInvitingForOwnDoubt(true);
                          setInviteOpen(true);
                        }}
                        className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        Start Private
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          toast(
                            "Only the student who posted this doubt can start a private session.",
                          )
                        }
                        className="cursor-not-allowed rounded bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/40"
                        title="Only the doubt asker can start a private session"
                      >
                        Start Private
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask a question..."
                className="flex-1 rounded-lg border border-white/10 bg-room px-3 py-2 text-xs placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button onClick={ask} className="rounded-lg bg-primary px-3 hover:bg-primary/90">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </aside>
        )}
      </div>

      <ReportModal
        open={!!reportFor}
        onClose={() => setReportFor(null)}
        target={reportFor?.target}
        name={reportFor?.name}
      />
      <BlockModal
        open={!!blockFor}
        onClose={() => setBlockFor(null)}
        name={blockFor ?? ""}
        onConfirm={() => blockFor && setBlocked((b) => [...b, blockFor])}
      />
      <RatingModal
        open={rating}
        onClose={() => {
          setRating(false);
          setRatingFor(null);
        }}
        rateeId={ratingFor}
        classroomId={roomId}
      />

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        participants={invitableParticipants}
        onConfirm={(ids) => {
          setInviteOpen(false);
          // Opened from your own doubt => you are the asker and will rate the
          // helper you invite. Opened from the header => a plain invite.
          startPrivateWith(ids, invitingForOwnDoubt ? (userId ?? undefined) : undefined);
          setInvitingForOwnDoubt(false);
        }}
      />
      {incomingInvite && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-room-card p-6 text-center shadow-elevated">
            <h3 className="text-lg font-bold text-white">
              {incomingInvite.hostName} wants to invite you to a private meeting
            </h3>
            <p className="mt-2 text-sm text-white/70">You'll only join if you accept.</p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void respondToInvite(false)}
                className="flex-1 rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10"
              >
                Reject
              </button>
              <button
                onClick={() => void respondToInvite(true)}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
      {helpOffer && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-room-card p-6 text-center shadow-elevated">
            <h3 className="text-lg font-bold text-white">
              {helpOffer.helper} has offered to help you
            </h3>
            <p className="mt-2 line-clamp-3 text-sm text-white/70">"{helpOffer.doubt}"</p>
            <button
              onClick={() => setHelpOffer(null)}
              className="mt-5 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {nsfwWarn && (
        <NsfwWarning
          strikes={nsfwStrikes}
          onTurnOffCamera={() => {
            void ensureStream({ audio: false, video: false });
            setCam(false);
            setNsfwWarn(false);
          }}
        />
      )}

      {afkWarn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-room-card p-6 text-center shadow-elevated">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/20 text-warning">
              <VolumeX className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">Are you still there?</h3>
            <p className="mt-1 text-sm text-white/70">
              You've been inactive. You'll be removed from the classroom in
            </p>
            <div className="mt-3 text-4xl font-bold tabular-nums text-warning">
              {Math.floor(afkSeconds / 60)}:{String(afkSeconds % 60).padStart(2, "0")}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  dismissAfk();
                  nav({ to: "/home" });
                }}
                className="flex-1 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
              >
                Leave now
              </button>
              <button
                onClick={dismissAfk}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Check className="mr-1 inline h-4 w-4" /> I'm here
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CtlBtn({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

function InviteModal({
  open,
  onClose,
  participants,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  participants: Participant[];
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const MAX = 6; // 6 invitees + you = 7 total
  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);
  if (!open) return null;
  const toggle = (id: string) => {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= MAX) {
        toast.error(`Private rooms hold up to 7 people (you + ${MAX}).`);
        return s;
      }
      return [...s, id];
    });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-room-card p-5 text-white shadow-elevated"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">Invite to Private Session</h3>
          <button onClick={onClose} className="rounded p-1 text-white/60 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-white/60">
          Pick up to {MAX} people from this classroom — private rooms hold 7 total.
        </p>
        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
          {participants.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-room p-4 text-center">
              <p className="text-sm font-semibold text-white/80">No participant live</p>
              <p className="mt-1 text-xs text-white/50">
                No other students are available to invite right now.
              </p>
            </div>
          ) : (
            participants.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    on ? "border-primary bg-primary/10" : "border-white/10 bg-room hover:bg-white/5"
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${p.color} text-xs font-bold`}
                  >
                    {p.initials}
                  </div>
                  <span className="flex-1 truncate">{p.name}</span>

                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${on ? "border-primary bg-primary" : "border-white/30"}`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-white/60">
            {selected.length}/{MAX} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selected)}
              disabled={selected.length === 0}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Start Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivateSession({
  youName,
  invitees,
  roomParticipants,
  onReturn,
  onInvite,
  roomId,
  sessionKey,
  selfUserId,
  localStream,
  cam,
  mic,
  onToggleCam,
  onToggleMic,
  isModerator,
}: {
  youName: string;
  invitees: Participant[];
  roomParticipants: Participant[];
  onReturn: () => void;
  onInvite: (ids: string[]) => void;
  roomId: string;
  sessionKey: string;
  selfUserId: string | null;
  localStream: MediaStream | null;
  cam: boolean;
  mic: boolean;
  onToggleCam: () => void;
  onToggleMic: () => void;
  /** Only the student who raised the doubt can mute others. */
  isModerator: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "board">("none");
  const [sharing, setSharing] = useState(false);
  const [mutedByMod, setMutedByMod] = useState(false);
  // Who the moderator has explicitly silenced. A hover-mute persists until they
  // unmute; "mute all" is a one-shot request that people can undo themselves.
  const [forceMuted, setForceMuted] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Screen video + microphone audio, rebuilt whenever either side changes.
  const [shareStream, setShareStream] = useState<MediaStream | null>(null);

  // Real audio+video with the people in this session. Previously this screen
  // rendered static initials for everyone else and ran its own getUserMedia,
  // so nobody could see or hear anyone — and grabbing the camera a second time
  // knocked out the classroom's own stream on the way back.
  // Who is *actually* in this session, from a presence channel — the same
  // mechanism the classroom uses.
  //
  // This screen used to derive peers from a locally-managed invitedIds array
  // built out of broadcasts. Host and invitee filled it via different paths at
  // different moments, so the two sides could disagree about who was present
  // and one of them ended up with nobody to offer to: "Connecting..." forever.
  // Presence is a single shared source of truth, so both sides always agree.
  const [livePeers, setLivePeers] = useState<Participant[]>([]);
  useEffect(() => {
    const ch = supabase.channel(`room:${roomId}:private`, {
      config: { presence: { key: sessionKey } },
    });
    const sync = () => {
      const state = ch.presenceState() as Record<
        string,
        Array<{ session_key?: string; user_id?: string; name?: string }>
      >;
      const seen = new Map<string, Participant>();
      for (const [key, metas] of Object.entries(state)) {
        if (key === sessionKey) continue;
        const meta = metas[0];
        if (!meta) continue;
        const id = meta.session_key || key;
        if (seen.has(id)) continue;
        const name = meta.name || "Student";
        seen.set(id, {
          id,
          userId: meta.user_id,
          name,
          initials: initialsFor(name),
          color: colorFor(id),
          mic: false,
          cam: true,
        });
      }
      setLivePeers([...seen.values()]);
    };
    ch.on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({
            session_key: sessionKey,
            user_id: selfUserId,
            name: youName.replace(" (You)", ""),
          });
        }
      });
    return () => {
      void ch.untrack().then(() => supabase.removeChannel(ch));
    };
  }, [roomId, sessionKey, selfUserId, youName]);

  const all = livePeers;
  const totalSeats = 1 + all.length; // you + others
  const remainingSlots = Math.max(0, 7 - totalSeats);
  const peerIds = useMemo(() => all.map((p) => p.id), [all]);
  const { remoteStreams: privateStreams, channel } = useWebrtcMesh({
    roomId: `${roomId}:private`,
    userId: sessionKey,
    peerIds,
    // Screen share replaces the camera track for everyone while it is running,
    // but getDisplayMedia gives us no microphone — carry the camera stream's
    // audio across or sharing would silently mute the presenter.
    localStream: shareStream ?? localStream,
  });

  useEffect(() => {
    toast("Private session started — mic and camera are on");
  }, []);

  // Moderator commands. Only the doubt's author is moderator, so everyone else
  // just listens.
  useEffect(() => {
    if (!channel) return;
    const onMute = ({ payload }: { payload: unknown }) => {
      const p = payload as { target?: string; all?: boolean; muted?: boolean };
      const forMe = p.all || p.target === sessionKey;
      if (!forMe) return;
      if (p.all) {
        // Temporary: mute now, but leave them free to unmute themselves.
        if (mic) onToggleMic();
        toast("Muted by the moderator");
        return;
      }
      setMutedByMod(!!p.muted);
      if (p.muted && mic) onToggleMic();
      toast(p.muted ? "The moderator muted you" : "The moderator unmuted you");
    };
    channel.on("broadcast", { event: "mod_mute" }, onMute);
  }, [channel, mic, onToggleMic, sessionKey]);

  const muteAll = () => {
    void channel?.send({ type: "broadcast", event: "mod_mute", payload: { all: true } });
    toast.success("Everyone muted");
  };

  const toggleForceMute = (peerId: string) => {
    const nowMuted = !forceMuted.includes(peerId);
    setForceMuted((prev) => (nowMuted ? [...prev, peerId] : prev.filter((id) => id !== peerId)));
    void channel?.send({
      type: "broadcast",
      event: "mod_mute",
      payload: { target: peerId, muted: nowMuted },
    });
  };

  const stopShare = () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setShareStream(null);
    setSharing(false);
  };

  const toggleShare = async () => {
    if (sharing) {
      stopShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      // Clicking the browser's own "Stop sharing" bar has to put the camera
      // back, not leave a frozen frame.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      screenStreamRef.current = stream;
      setSharing(true);
    } catch {
      /* the user dismissed the picker */
    }
  };

  // Screen video + live mic audio. Rebuilt when the mic is toggled mid-share so
  // the presenter does not go silent.
  useEffect(() => {
    if (!sharing || !screenStreamRef.current) {
      setShareStream(null);
      return;
    }
    const combined = new MediaStream(screenStreamRef.current.getVideoTracks());
    localStream?.getAudioTracks().forEach((t) => combined.addTrack(t));
    setShareStream(combined);
  }, [sharing, localStream]);

  // Tell the others when we start and stop presenting, so they can promote our
  // feed to the stage. The video track alone does not say whether it is a
  // camera or a screen.
  useEffect(() => {
    if (!channel) return;
    void channel.send({
      type: "broadcast",
      event: "presenting",
      payload: { from: sessionKey, on: sharing },
    });
  }, [sharing, channel, sessionKey]);

  const [remotePresenter, setRemotePresenter] = useState<string | null>(null);
  useEffect(() => {
    if (!channel) return;
    const onPresenting = ({ payload }: { payload: unknown }) => {
      const p = payload as { from?: string; on?: boolean };
      if (!p.from) return;
      setRemotePresenter((prev) => (p.on ? p.from! : prev === p.from ? null : prev));
    };
    channel.on("broadcast", { event: "presenting" }, onPresenting);
  }, [channel]);

  // Someone stopped sharing by leaving; drop the stage with them.
  useEffect(() => {
    if (remotePresenter && !all.some((p) => p.id === remotePresenter)) setRemotePresenter(null);
  }, [all, remotePresenter]);

  const stagePeer = remotePresenter ? all.find((p) => p.id === remotePresenter) : null;
  const onStage = sharing || !!stagePeer;

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Bind the shared classroom stream to our self-view. Callback ref so it
  // re-attaches on mount, not just when the stream identity changes.
  const attachSelfVideo = (v: HTMLVideoElement | null) => {
    videoRef.current = v;
    if (!v || !localStream) return;
    if (v.srcObject !== localStream) v.srcObject = localStream;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  useEffect(() => {
    attachSelfVideo(videoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, cam]);

  // candidates for additional invites (those not already in the room)
  const inviteCandidates = useMemo(
    () => roomParticipants.filter((p) => !all.some((a) => a.id === p.id)),
    [all, roomParticipants],
  );

  return (
    <div className="min-h-screen bg-room text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-bold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> PRIVATE SESSION (A/V)
        </span>
        <span className="text-xs text-white/60">{totalSeats}/7 in room</span>
        {isModerator && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/70">
            MODERATOR
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPanel(panel === "board" ? "none" : "board")}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              panel === "board"
                ? "bg-primary text-primary-foreground"
                : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <PenLine className="h-4 w-4" /> Whiteboard
          </button>
          <button
            onClick={() => void toggleShare()}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              sharing ? "bg-primary text-primary-foreground" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <MonitorUp className="h-4 w-4" /> {sharing ? "Stop share" : "Share screen"}
          </button>
          {isModerator && (
            <button
              onClick={muteAll}
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
            >
              <VolumeX className="h-4 w-4" /> Mute All
            </button>
          )}
          <button
            onClick={() => setInviteOpen(true)}
            disabled={remainingSlots === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
          >
            <UserPlus className="h-4 w-4" /> Invite{" "}
            {remainingSlots > 0 ? `(+${remainingSlots})` : "(full)"}
          </button>
          <button
            onClick={onReturn}
            className="inline-flex items-center gap-1 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            <ArrowLeft className="h-4 w-4" /> Return to Main
          </button>
        </div>
      </header>

      <main
        className={`mx-auto max-w-6xl gap-4 p-6 ${
          panel === "board" || onStage ? "grid lg:grid-cols-[1fr_300px]" : ""
        }`}
      >
        {panel === "board" && (
          <div className="order-2 h-[60vh] overflow-hidden rounded-2xl border border-white/10 bg-room-card lg:order-1 lg:h-[calc(100vh-190px)]">
            <Whiteboard channel={channel} />
          </div>
        )}

        {/* Presentation stage. Whoever is sharing fills the space and everyone
         * else shrinks to a filmstrip, the way Meet does it. */}
        {panel !== "board" && onStage && (
          <div className="order-2 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black lg:order-1 lg:h-[calc(100vh-190px)]">
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {stagePeer && privateStreams[stagePeer.id] ? (
                <RemoteVideo
                  stream={privateStreams[stagePeer.id]}
                  audible={!forceMuted.includes(stagePeer.id)}
                  contain
                />
              ) : sharing && shareStream ? (
                <ScreenPreview stream={shareStream} />
              ) : (
                <div className="flex flex-col items-center gap-2 text-white/50">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/70" />
                  <span className="text-xs">Starting presentation…</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-xs text-white/60">
              <MonitorUp className="h-3.5 w-3.5" />
              {sharing ? "You are presenting" : `${stagePeer?.name ?? "Someone"} is presenting`}
            </div>
          </div>
        )}

        <div
          className={`order-1 grid gap-4 lg:order-2 ${
            panel === "board" || onStage
              ? "grid-cols-2 content-start lg:grid-cols-1"
              : "sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          <div className="rounded-2xl border border-primary bg-room-card p-4 text-center">
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl bg-black/40">
              {sharing ? (
                <div className="flex flex-col items-center gap-2 text-white/60">
                  <MonitorUp className="h-6 w-6" />
                  <span className="text-[11px]">Sharing your screen</span>
                </div>
              ) : cam ? (
                <video
                  ref={attachSelfVideo}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full scale-x-[-1] object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold">
                  {youName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
              <span className="truncate">{youName}</span>
              {isModerator && (
                <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold">MOD</span>
              )}
              {mic ? (
                <Mic className="h-3 w-3 text-success" />
              ) : (
                <MicOff className="h-3 w-3 text-danger" />
              )}
            </div>
          </div>

          {all.map((p) => {
            const silenced = forceMuted.includes(p.id);
            return (
              <div
                key={p.id}
                className="group relative rounded-2xl border border-white/10 bg-room-card p-4 text-center"
              >
                <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl bg-black/40">
                  {privateStreams[p.id] ? (
                    // Audible here, unlike the classroom grid: a private session
                    // is the one place people are meant to talk. A moderator
                    // mute is enforced locally too, so it takes effect even if
                    // the other end ignores the request.
                    <RemoteVideo stream={privateStreams[p.id]} audible={!silenced} />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-white/50">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/70" />
                      <span className="text-[11px]">Connecting…</span>
                    </div>
                  )}
                </div>

                {isModerator && (
                  <button
                    onClick={() => toggleForceMute(p.id)}
                    title={silenced ? `Unmute ${p.name}` : `Mute ${p.name}`}
                    className={`absolute right-3 top-3 rounded-full p-2 transition ${
                      silenced
                        ? "bg-danger text-white"
                        : "bg-black/60 text-white opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {silenced ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                )}

                <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
                  <span className="truncate">{p.name}</span>
                  {silenced && <MicOff className="h-3 w-3 shrink-0 text-danger" />}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom controls */}
      <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-room-card/95 px-3 py-2 shadow-elevated backdrop-blur">
        <CtlBtn
          title={mutedByMod ? "The moderator has muted you" : mic ? "Mute mic" : "Unmute mic"}
          onClick={() => {
            // A moderator mute is not something you can undo yourself.
            if (mutedByMod) {
              toast("The moderator has muted you.");
              return;
            }
            onToggleMic();
          }}
          className={
            mutedByMod
              ? "cursor-not-allowed bg-danger/20 text-danger opacity-60"
              : mic
                ? "bg-success/20 text-success"
                : "bg-danger/20 text-danger"
          }
        >
          {mic && !mutedByMod ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </CtlBtn>
        <CtlBtn
          title={cam ? "Turn camera off" : "Turn camera on"}
          onClick={onToggleCam}
          className={cam ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}
        >
          {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </CtlBtn>
        <CtlBtn title="Leave private session" onClick={onReturn} className="bg-danger text-white">
          <X className="h-5 w-5" />
        </CtlBtn>
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        participants={inviteCandidates}
        onConfirm={(ids) => {
          if (ids.length > remainingSlots) {
            toast.error(`Only ${remainingSlots} seat(s) left.`);
            return;
          }
          setInviteOpen(false);
          onInvite(ids);
        }}
      />
    </div>
  );
}
