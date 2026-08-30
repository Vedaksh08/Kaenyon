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
  PhoneOff,
  Smartphone,
  EyeOff,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { usePlan } from "@/lib/plan-context";
import { ReportModal, BlockModal } from "@/components/report-block-modals";
import { RatingModal, type Ratee } from "@/components/rating-modal";
import { supabase } from "@/integrations/supabase/client";
import { sendFriendRequest, markPresence, clearPresence } from "@/lib/social";
import { useWebrtcMesh } from "@/lib/use-webrtc-mesh";
import { cn } from "@/lib/utils";
import { useCaptureGuard } from "@/lib/use-capture-guard";
import { Whiteboard } from "@/components/whiteboard";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";

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
function NsfwWarning({ onTurnOffCamera }: { onTurnOffCamera: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-danger/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-danger/40 bg-room-card p-6 text-center shadow-elevated">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/20 text-danger">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-white">Inappropriate content detected</h3>
        <p className="mt-2 text-sm text-white/70">
          Your camera showed content that isn't allowed in a classroom, so you've been removed from
          the room.
        </p>
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
      { title: "Study Room — Pathwaay" },
      {
        name: "description",
        content:
          "A live Pathwaay classroom: ask doubts, offer help and run private solving sessions.",
      },
      { property: "og:title", content: "Study Room — Pathwaay" },
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

/** COCO labels that mean "a phone is in shot". */
const PHONE_LABELS = new Set(["cell phone", "mobile phone", "telephone"]);
// The COCO "cell phone" class is conservative on webcam frames — a phone held
// at arm's length rarely clears 0.5. 0.3 catches it; two consecutive sightings
// (below) are what keep false positives out, not the threshold alone.
const PHONE_CONFIDENCE = 0.3;
const PHONE_CHECK_MS = 1500;
/** How long after the last detected face NSFW checks still apply. */
const FACE_GRACE_MS = 5000;
/** Separate phone incidents before removal from the classroom. */
const PHONE_WARNINGS_MAX = 3;

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
  // Everyone the asker may rate, with names, so the modal can say who each
  // score is for. A session can hold several helpers.
  const [ratingFor, setRatingFor] = useState<Ratee[]>([]);
  // Only the person who raised the doubt rates, and only helpers get rated.
  // Set when a private session starts; null for helpers, so leaving the session
  // never prompts them.
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
  const [phoneWarn, setPhoneWarn] = useState(false);
  const [phoneWarnings, setPhoneWarnings] = useState(0);
  // One warning per incident: set when a warning fires, cleared when the phone
  // leaves frame, so three ticks of a single sighting is not three strikes.
  const phoneWarnedRef = useRef(false);
  // Blurs video when the window loses focus, which is what screenshot tools do
  // first. See the hook for what this can and cannot actually prevent.
  const capture = useCaptureGuard(true);
  // Read inside the AFK timer, which is created once and would otherwise close
  // over a stale `privateSession`.
  const privateSessionRef = useRef(false);
  privateSessionRef.current = privateSession;
  const [afkSeconds, setAfkSeconds] = useState(KICK_MS);
  const lastActivityRef = useRef<number>(Date.now());
  const afkWarnRef = useRef(false);
  // Timestamp of the last frame with a face in it. The NSFW check reads this:
  // an empty room is a wall, a chair or a bedsheet, and nsfwjs will happily
  // score those — flagging someone who has simply stepped away is both wrong
  // and alarming. No person in frame means nothing to moderate.
  const faceSeenAtRef = useRef(0);

  // Presence detection via facial recognition (MediaPipe FaceDetector).
  // No face detected in the camera feed for IDLE_MS -> AFK warning starts.
  useEffect(() => {
    const SAMPLE_MS = 1500;
    let detector: import("@mediapipe/tasks-vision").FaceDetector | null = null;
    // Second model, same probe frame: spots a phone held up to the camera.
    let objects: import("@mediapipe/tasks-vision").ObjectDetector | null = null;
    let phoneStrikes = 0;
    let lastPhoneCheck = 0;
    let phoneWarnings = 0;
    let kickedForPhone = false;
    const probe = document.createElement("video");
    probe.muted = true;
    probe.playsInline = true;
    probe.autoplay = true;
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
      if (kickedForPhone) return;
      // Being in a private session IS activity — you are talking to someone.
      // The old check read videoRef, which belongs to whichever view is
      // mounted; during a private session the classroom's element is gone, so
      // "no face found" was really "no video element", and people mid-session
      // were warned and then kicked out of the room they were actively using.
      //
      // Note this only skips the AFK clock. Phone checks still run below —
      // returning here outright meant phones were never detected in private
      // sessions at all.
      const inPrivate = privateSessionRef.current;
      if (inPrivate) bump();

      const stream = streamRef.current;
      const camOn = !!stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");

      // Sample a detached element fed straight from the stream rather than
      // whatever happens to be on screen.
      if (camOn) {
        const st = streamRef.current;
        if (st && probe.srcObject !== st) {
          probe.srcObject = st;
          const pl = probe.play?.();
          if (pl && typeof pl.catch === "function") pl.catch(() => {});
        }
      }

      if (!camOn || probe.readyState < 2 || probe.videoWidth === 0 || !detector) {
        if (!inPrivate && !afkWarnRef.current && Date.now() - lastActivityRef.current >= IDLE_MS) {
          afkWarnRef.current = true;
          setAfkWarn(true);
          setAfkSeconds(KICK_MS);
        }
        return;
      }

      try {
        const res = detector.detectForVideo(probe, performance.now());
        if (res.detections && res.detections.length > 0) {
          faceSeenAtRef.current = Date.now();
          bump();
        }
      } catch {
        // transient errors — ignore
      }

      // Phone check runs on the same frame but less often — object detection is
      // heavier than face detection and a phone does not appear for one frame.
      const now = Date.now();
      if (objects && now - lastPhoneCheck >= PHONE_CHECK_MS) {
        lastPhoneCheck = now;
        try {
          const res = objects.detectForVideo(probe, performance.now());
          const phone = (res.detections ?? []).some((d) =>
            (d.categories ?? []).some(
              (c) =>
                PHONE_LABELS.has((c.categoryName ?? "").toLowerCase()) &&
                (c.score ?? 0) >= PHONE_CONFIDENCE,
            ),
          );
          if (phone) {
            phoneStrikes += 1;
            console.info(`[moderation] phone sighting ${phoneStrikes}/2`);
            // Two consecutive sightings before the first warning, so a passing
            // hand or a dark rectangle on a desk does not accuse anyone.
            if (phoneStrikes >= 2 && !phoneWarnedRef.current) {
              phoneWarnedRef.current = true;
              phoneWarnings += 1;
              setPhoneWarnings(phoneWarnings);
              setPhoneWarn(true);

              if (phoneWarnings >= PHONE_WARNINGS_MAX) {
                kickedForPhone = true;
                void (async () => {
                  const { data: userData } = await supabase.auth.getUser();
                  if (userData.user) {
                    await supabase.from("reports").insert({
                      reporter_id: userData.user.id,
                      reported_user_id: userData.user.id,
                      reason: "other",
                      notes: `Auto-flagged: phone in frame after ${PHONE_WARNINGS_MAX} warnings`,
                    });
                  }
                  toast.error("Removed from classroom — phone detected repeatedly");
                  nav({ to: "/home" });
                })();
              }
            }
          } else {
            phoneStrikes = 0;
            // Clearing the frame arms the next warning, so three separate
            // incidents are needed rather than three ticks of one.
            phoneWarnedRef.current = false;
            setPhoneWarn(false);
          }
        } catch {
          // transient errors — ignore
        }
      }

      if (!inPrivate && !afkWarnRef.current && Date.now() - lastActivityRef.current >= IDLE_MS) {
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
        // Best-effort: if the model cannot be fetched, face detection and the
        // rest of the room carry on without phone warnings.
        try {
          objects = await vision.ObjectDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            scoreThreshold: PHONE_CONFIDENCE,
            maxResults: 12,
          });
          if (cancelled) {
            objects.close();
            objects = null;
          }
          if (objects) console.info("[moderation] phone detection active");
        } catch (err) {
          console.warn("[moderation] phone detection unavailable", err);
        }
        interval = window.setInterval(tick, SAMPLE_MS);
      } catch (err) {
        console.error("Face detector failed to load", err);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      probe.srcObject = null;
      detector?.close();
      objects?.close();
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
    const THRESHOLD = 0.85;
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
      const by = (name: string) => preds.find((p) => p.className === name)?.probability ?? 0;

      // Take the strongest explicit class rather than adding them together.
      // Summing meant two unconfident guesses (Porn 0.4 + Hentai 0.4) cleared a
      // 0.75 threshold that neither class actually reached, which is how a
      // fully-clothed student in an ordinary room got flagged.
      const explicit = Math.max(by("Porn"), by("Hentai"));

      // "Neutral" and "Drawing" are the classes ordinary webcam footage lands
      // in. If the model is more confident about those than about anything
      // explicit, this is not a violation whatever the raw number says.
      const benign = Math.max(by("Neutral"), by("Drawing"));
      return explicit > benign ? explicit : 0;
    };

    const tick = async () => {
      if (cancelled || kicked || !model) return;
      const stream = streamRef.current;
      const camOn = !!stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
      if (!camOn) return;
      attachProbe();
      if (probe.readyState < 2 || probe.videoWidth === 0) return;

      // Only moderate when someone is actually on camera. Stepping away leaves
      // a wall or a chair in frame, which the classifier can still score — and
      // accusing an empty room is the false positive people notice most.
      if (Date.now() - faceSeenAtRef.current > FACE_GRACE_MS) {
        if (strikes > 0) {
          setNsfwWarn(false);
          setNsfwStrikes(0);
        }
        strikes = 0;
        return;
      }

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

        // Three more looks spread over a second. A real violation stays on
        // camera; a bad frame — motion blur, an arm across the lens, a flash of
        // skin tone as someone leans in — does not survive being asked again.
        let confirmations = 0;
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (cancelled) return;
          if ((await scoreFrame()) >= THRESHOLD) confirmations += 1;
        }
        if (confirmations < 3) return;

        // Confirmed explicit content: out of the room straight away. Warning
        // and letting it continue would leave it on everyone else's screen
        // while the strikes counted up.
        kicked = true;
        console.warn(`[moderation] NSFW confirmed (score ${unsafe.toFixed(2)}) — removing`);

        // Stop broadcasting before anything else, so the feed is gone even if
        // the navigation or the network call is slow.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setLocalStream(null);
        setCam(false);
        setMic(false);

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
        // Tiles render around 200px wide in a full grid, so 640x480 at an
        // uncapped framerate spends upload bandwidth on detail nobody sees and
        // makes weaker connections stutter. 320x240 at 20fps looks the same in
        // a tile and roughly quarters the bitrate.
        video: want.video
          ? {
              width: { ideal: 320, max: 640 },
              height: { ideal: 240, max: 480 },
              frameRate: { ideal: 20, max: 24 },
            }
          : false,
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
  const { remoteStreams, failedPeers } = useWebrtcMesh({
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
        .select("room_number, capacity, subjects(name)")
        .eq("id", roomId)
        .maybeSingle();
      if (cancelled || !data) return;
      const subjectName = (data.subjects as { name: string } | null)?.name;
      setRoomTitle(
        subjectName ? `${subjectName} · Room ${data.room_number}` : `Room ${data.room_number}`,
      );

      // Nothing stopped a full room being joined from a shared link, and one
      // person over the limit degrades video for everyone already inside.
      const { data: live } = await supabase.rpc("get_room_presence", {
        _classroom_id: roomId,
      });
      if (cancelled) return;
      const { data: me } = await supabase.auth.getUser();
      const already = (live ?? []).some((r) => r.user_id === me.user?.id);
      if (!already && (live?.length ?? 0) >= data.capacity) {
        toast.error("That room is full — try another one.");
        nav({ to: "/home", replace: true });
      }
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
  // sessionKey -> last time we had any evidence they were alive.
  const lastSeenRef = useRef<Map<string, number>>(new Map());
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
        const seenKeys = new Set<string>();
        for (const [key, metas] of Object.entries(state)) {
          if (key === myKey) continue;
          const meta = metas[0];
          if (!meta || !meta.user_id) continue;
          if (meta.user_id === uid) continue; // your own other tab
          if (byUser.has(meta.user_id)) continue; // same person, second session
          const id = meta.session_key || key;
          seenKeys.add(id);
          // First time we have seen this key, or it is still here: treat the
          // sync itself as proof of life. The heartbeat below only has to catch
          // people who stop appearing in syncs without a leave event.
          lastSeenRef.current.set(id, Date.now());
          byUser.set(meta.user_id, {
            id,
            userId: meta.user_id,
            name: meta.name,
            initials: initialsFor(meta.name),
            color: colorFor(meta.user_id),
            mic: !!meta.mic,
            cam: !!meta.cam,
          });
        }
        // Forget anyone presence no longer reports, so a rejoin starts clean.
        for (const key of [...lastSeenRef.current.keys()]) {
          if (!seenKeys.has(key)) lastSeenRef.current.delete(key);
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
          lastSeenRef.current.delete(key);
          setRemoteParticipants((prev) => prev.filter((p) => p.id !== key));
        })
        // Everyone shouts "still here" on a timer. This is the only signal that
        // survives a browser dying without a clean close — a closed lid, dropped
        // wifi, killed tab. Supabase expires those entries on its own schedule
        // per connection, which is why one viewer would see someone leave while
        // another still showed their tile.
        .on("broadcast", { event: "alive" }, ({ payload }) => {
          const key = (payload as { session_key?: string })?.session_key;
          if (key) lastSeenRef.current.set(key, Date.now());
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

    // Heartbeat: announce ourselves, and independently evict anyone who has gone
    // quiet. Every viewer runs the same clock against the same evidence, so a
    // departure now looks identical to everybody instead of depending on which
    // socket Supabase happened to expire first.
    const HEARTBEAT_MS = 3000;
    const SILENT_LIMIT_MS = 12000;
    const heartbeat = window.setInterval(() => {
      void presenceChannelRef.current?.send({
        type: "broadcast",
        event: "alive",
        payload: { session_key: sessionKeyRef.current },
      });
      const cutoff = Date.now() - SILENT_LIMIT_MS;
      setRemoteParticipants((prev) => {
        const alive = prev.filter((p) => (lastSeenRef.current.get(p.id) ?? 0) > cutoff);
        return alive.length === prev.length ? prev : alive;
      });
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
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
          onReturn={(participants) => {
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
            // being asked to rate the people they just helped.
            if (pendingRatee) {
              // Everyone who was actually in the session, not just whoever
              // happened to be invited first — with 3 people the asker should
              // be able to rate each helper individually.
              const candidates = participants.filter((r) => r.userId && r.userId !== userId);
              const list: Ratee[] =
                candidates.length > 0
                  ? candidates.map((r) => ({ userId: r.userId!, name: r.name }))
                  : [{ userId: pendingRatee, name: "Your helper" }];
              setRatingFor(list);
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
      {/* The classroom had no branding at all — the one screen students spend
       * the most time on. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-room/95 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
          <button
            onClick={() => nav({ to: "/home" })}
            className="-ml-1 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Leave classroom"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <PathwaayMark className="h-8 w-8" />
          <div className="hidden min-w-0 sm:block">
            <PathwaayWordmark tone="onDark" className="text-[11px]" />
          </div>
          <span aria-hidden className="hidden h-5 w-px bg-white/15 sm:block" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{roomTitle}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
              </span>
              Live · {remoteParticipants.length + 1}{" "}
              {remoteParticipants.length === 0 ? "person" : "people"}
            </div>
          </div>
          <div className="ml-auto">
            <button
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold transition hover:bg-white/20 active:scale-[0.98]"
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Invite to private</span>
              <span className="sm:hidden">Invite</span>
            </button>
          </div>
        </div>
        {/* The mark's bars, tying the classroom back to the brand. */}
        <span aria-hidden className="brand-rainbow block h-[2px] w-full opacity-70" />
      </header>

      <div className="flex flex-col md:h-[calc(100dvh-64px)] md:flex-row">
        {/* Grid */}
        <main className={`flex-1 p-5 ${chatOpen ? "" : ""}`}>
          {remoteParticipants.length === 0 && (
            <div className="mb-4 rounded-xl border border-dashed border-white/15 bg-room-card/60 p-5 text-center">
              <p className="text-sm font-semibold text-white/80">You're first in</p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">
                Post your doubt below — classmates joining this room will see it straight away.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleParticipants.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-2xl border bg-room-card p-3 transition-colors ${
                  p.you ? "border-brand-cyan/70 ring-1 ring-brand-cyan/25" : "border-white/10"
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
                  ) : !p.you && failedPeers.has(p.id) ? (
                    // A failed connection used to render as a black tile, which
                    // looks identical to a camera that is off. Say what is
                    // actually wrong.
                    <div className="flex flex-col items-center gap-1.5 px-3 text-center text-white/50">
                      <WifiOff className="h-5 w-5 text-danger" />
                      <span className="text-[11px] font-medium">Couldn't connect</span>
                      <span className="text-[10px] leading-tight text-white/35">
                        Your networks can't reach each other
                      </span>
                    </div>
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
                  {p.you && (
                    <span className="shrink-0 rounded bg-brand-cyan/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-cyan">
                      You
                    </span>
                  )}
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
          <div className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-room-card/95 px-3 py-2 shadow-elevated backdrop-blur-md">
            <CtlBtn
              title="Mic off — the classroom is silent. Join a private session to talk."
              onClick={() =>
                toast("Mic is disabled in the classroom. Join a Private Session to talk.")
              }
              className="bg-danger/20 text-danger"
            >
              <MicOff className="h-5 w-5" />
            </CtlBtn>
            <CtlBtn
              title={
                cam ? "Camera is on — click to turn it off" : "Camera is off — click to turn it on"
              }
              onClick={toggleCam}
              className={cam ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}
            >
              {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </CtlBtn>

            <CtlBtn
              title={chatOpen ? "Hide doubts panel" : "Show doubts panel"}
              onClick={() => setChatOpen((v) => !v)}
            >
              <MessageSquare className="h-5 w-5" />
            </CtlBtn>
            <CtlBtn
              title="Leave classroom"
              wide
              onClick={() => nav({ to: "/home" })}
              className="bg-danger font-semibold text-white hover:bg-danger/90"
            >
              <PhoneOff className="h-5 w-5" />
              <span className="text-sm">Leave</span>
            </CtlBtn>
          </div>
        </main>

        {/* Interaction Center */}
        {chatOpen && (
          <aside className="flex w-full shrink-0 flex-col border-t border-white/10 bg-room-card/40 md:w-[340px] md:border-l md:border-t-0">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3.5">
              <MessageSquare className="h-4 w-4 text-primary" />
              <div className="text-sm font-bold">Doubts</div>
              {visibleDoubts.length > 0 && (
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {visibleDoubts.length}
                </span>
              )}
              <span className="ml-auto text-[11px] text-white/40">This room</span>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
              {visibleDoubts.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/15 px-4 py-9 text-center">
                  <MessageSquare className="mx-auto h-6 w-6 text-white/30" />
                  <p className="mt-2.5 text-xs font-medium text-white/70">No doubts yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                    Stuck on something? Type it below and someone here will help.
                  </p>
                </div>
              )}
              {visibleDoubts.map((d) => (
                <div
                  key={d.id}
                  className="relative rounded-xl border border-white/10 bg-room p-3 transition-colors hover:border-white/20"
                >
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
                      <span className="rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">
                        Offer received
                      </span>
                    )}
                    {d.status === "solving" && (
                      <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
                        Solving
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-white/80">{d.text}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void offerHelp(d)}
                      disabled={d.author_id === userId}
                      className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-white/20 active:scale-95 disabled:opacity-40"
                    >
                      Offer Help
                    </button>

                    {d.author_id === userId ? (
                      <button
                        onClick={() => {
                          setInvitingForOwnDoubt(true);
                          setInviteOpen(true);
                        }}
                        className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-95"
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
                        className="cursor-not-allowed rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/40"
                        title="Only the doubt asker can start a private session"
                      >
                        Start Private
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/10 p-3">
              <div className="flex items-end gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask()}
                  placeholder="Ask a question…"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-room px-3.5 py-2.5 text-sm transition placeholder:text-white/40 focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                />
                <button
                  onClick={ask}
                  disabled={!draft.trim()}
                  aria-label="Post doubt"
                  className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 active:scale-95 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 px-0.5 text-[10px] text-white/30">
                <PathwaayMark className="h-3.5 w-3.5" />
                Doubts clear when you leave the room
              </p>
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
          setRatingFor([]);
        }}
        ratees={ratingFor}
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
      {/* Screen-capture deterrents. A page cannot block a real screenshot, so
       * this does the two things that do help: hide the video the moment focus
       * leaves (which is what the OS snipper does first), and stamp the frame
       * with who is watching, so anything that IS captured is traceable. */}
      {capture.obscured && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-room/95 backdrop-blur-xl">
          <div className="text-center">
            <EyeOff className="mx-auto h-8 w-8 text-white/60" />
            <p className="mt-3 text-sm font-semibold text-white">Video hidden</p>
            <p className="mt-1 text-xs text-white/60">
              Click back into the window to rejoin the class.
            </p>
          </div>
        </div>
      )}
      {capture.warned && (
        <div className="fixed left-1/2 top-4 z-[96] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-danger/40 bg-danger/20 px-4 py-2 text-sm font-medium text-white backdrop-blur">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Screenshots of the classroom are not allowed.
          <button
            onClick={capture.dismissWarning}
            className="ml-1 rounded px-1.5 text-white/70 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {/* Rendered over the grid, so it lands in any screenshot that is taken. */}
      <div className="pointer-events-none fixed inset-0 z-[60] select-none overflow-hidden">
        <div className="absolute bottom-20 right-4 text-[10px] font-medium text-white/25">
          {profile?.name?.trim() || "Pathwaay"} · {profile?.email ?? ""}
        </div>
      </div>

      {/* A nudge, not a removal — phone detection is fuzzy, so it must never
       * eject anyone the way explicit content does. */}
      {phoneWarn && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-warning/20 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-warning/40 bg-room-card p-6 text-center shadow-elevated">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/20 text-warning">
              <Smartphone className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">Phone detected</h3>
            <p className="mt-2 text-sm text-white/70">
              Please put your phone away and focus on the class.
            </p>
            <div className="mt-4 rounded-lg bg-warning/10 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-warning">
                Warning {phoneWarnings} of {PHONE_WARNINGS_MAX}
              </div>
              <div className="mt-1 text-xs text-white/60">
                You'll be removed from the classroom after {PHONE_WARNINGS_MAX} warnings.
              </div>
            </div>
            <button
              onClick={() => setPhoneWarn(false)}
              className="mt-5 w-full rounded-lg bg-warning px-4 py-2.5 text-sm font-semibold text-white hover:bg-warning/90"
            >
              I've put it away
            </button>
          </div>
        </div>
      )}

      {nsfwWarn && (
        <NsfwWarning
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

/**
 * Round control-bar button with a label that appears on hover.
 *
 * The native `title` tooltip takes about a second to appear and cannot be
 * styled, which is no good for controls people need to identify at a glance
 * mid-call. `title` is still set so the label reaches screen readers and
 * touch users who long-press.
 */
function CtlBtn({
  children,
  className = "",
  wide = false,
  title,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { wide?: boolean }) {
  return (
    <div className="group relative flex">
      <button
        {...rest}
        title={title}
        aria-label={title}
        // cn() runs twMerge, which is what makes a passed-in bg-* actually win.
        // Plain template concatenation left both bg-white/10 and bg-danger in
        // the class list, and Tailwind resolves that by stylesheet order, not
        // by which came last in the string — so the red never applied.
        className={cn(
          "flex h-12 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 active:scale-95 disabled:cursor-not-allowed",
          wide ? "gap-2 px-5" : "w-12",
          className,
        )}
      >
        {children}
      </button>
      {title && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[220px] -translate-x-1/2 text-balance rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-xs font-medium leading-snug text-white shadow-elevated ring-1 ring-white/10 group-hover:block"
        >
          {title}
        </span>
      )}
    </div>
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
  onReturn: (participants: Participant[]) => void;
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
  // Latest mic state and toggle, so the listener below can stay registered once
  // instead of being re-added whenever they change.
  const micRef = useRef(mic);
  micRef.current = mic;
  const toggleMicRef = useRef(onToggleMic);
  toggleMicRef.current = onToggleMic;

  useEffect(() => {
    if (!channel) return;
    // This effect used to depend on [channel, mic, onToggleMic] and never
    // removed the old listener, so every mic change stacked another one — and
    // a single mute fired a toast per stacked copy. Register once per channel.
    let detached = false;
    const onMute = ({ payload }: { payload: unknown }) => {
      if (detached) return;
      const p = payload as { target?: string; all?: boolean; muted?: boolean };
      const forMe = p.all || p.target === sessionKey;
      if (!forMe) return;
      if (p.all) {
        // Temporary: mute now, but leave them free to unmute themselves.
        if (micRef.current) toggleMicRef.current();
        toast("Muted by the moderator", { id: "mod-mute" });
        return;
      }
      setMutedByMod((was) => {
        const now = !!p.muted;
        // Only speak up when the state actually changes, and reuse one toast id
        // so a repeat replaces the previous message rather than stacking.
        if (was !== now) {
          toast(now ? "The moderator muted you" : "The moderator unmuted you", {
            id: "mod-mute",
          });
        }
        return now;
      });
      if (p.muted && micRef.current) toggleMicRef.current();
    };
    channel.on("broadcast", { event: "mod_mute" }, onMute);
    return () => {
      // Supabase exposes no per-handler off(), so neutralise this closure
      // instead. The channel itself is torn down by the mesh hook.
      detached = true;
    };
  }, [channel, sessionKey]);

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
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2.5 border-b border-white/10 bg-room/95 px-4 py-2.5 backdrop-blur-md sm:px-5">
        <PathwaayMark className="h-7 w-7" />
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Private session
        </span>
        <span className="text-xs text-white/60">{totalSeats}/7 in room</span>
        {isModerator && (
          <span className="rounded-full bg-brand-amber/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-amber">
            Moderator
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPanel(panel === "board" ? "none" : "board")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
              panel === "board"
                ? "bg-primary text-primary-foreground"
                : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <PenLine className="h-4 w-4" /> Whiteboard
          </button>
          <button
            onClick={() => void toggleShare()}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
              sharing ? "bg-primary text-primary-foreground" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <MonitorUp className="h-4 w-4" /> {sharing ? "Stop share" : "Share screen"}
          </button>
          {isModerator && (
            <button
              onClick={muteAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20 active:scale-95"
            >
              <VolumeX className="h-4 w-4" /> Mute All
            </button>
          )}
          <button
            onClick={() => setInviteOpen(true)}
            disabled={remainingSlots === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20 active:scale-95 disabled:opacity-40"
          >
            <UserPlus className="h-4 w-4" /> Invite{" "}
            {remainingSlots > 0 ? `(+${remainingSlots})` : "(full)"}
          </button>
          <button
            onClick={() => onReturn(all)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-navy transition hover:opacity-90 active:scale-95"
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
            <Whiteboard channel={channel} myName={youName.replace(" (You)", "")} />
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
            <div className="flex items-center gap-2 border-t border-white/10 bg-room-card/60 px-4 py-2 text-xs font-medium text-white/70">
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
          <div className="rounded-2xl border border-brand-cyan/70 bg-room-card p-4 text-center ring-1 ring-brand-cyan/25">
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
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                  {youName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
              <span className="truncate">{youName}</span>
              {isModerator && (
                <span className="rounded-full bg-brand-amber/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-amber">
                  Mod
                </span>
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
                className="group relative rounded-2xl border border-white/10 bg-room-card p-4 text-center transition-colors hover:border-white/20"
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
      <div className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-room-card/95 px-3 py-2 shadow-elevated backdrop-blur-md">
        <CtlBtn
          title={
            mutedByMod
              ? "The moderator has muted you"
              : mic
                ? "Mic is on — click to mute yourself"
                : "Mic is muted — click to unmute"
          }
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
          title={
            cam ? "Camera is on — click to turn it off" : "Camera is off — click to turn it on"
          }
          onClick={onToggleCam}
          className={cam ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}
        >
          {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </CtlBtn>
        <CtlBtn
          title="End the private session and return to the classroom"
          wide
          onClick={() => onReturn(all)}
          className="bg-danger font-semibold text-white hover:bg-danger/90"
        >
          <PhoneOff className="h-5 w-5" />
          <span className="text-sm">End call</span>
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
