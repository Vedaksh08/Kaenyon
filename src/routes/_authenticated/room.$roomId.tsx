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
} from "lucide-react";
import { toast } from "sonner";
import { usePlan } from "@/lib/plan-context";
import { ReportModal, BlockModal } from "@/components/report-block-modals";
import { RatingModal } from "@/components/rating-modal";
import { supabase } from "@/integrations/supabase/client";
import { sendFriendRequest, markPresence, clearPresence } from "@/lib/social";
import { useWebrtcMesh } from "@/lib/use-webrtc-mesh";

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="h-full w-full rounded-lg object-cover" />;
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
  useEffect(() => {
    const SAMPLE_MS = 5000;
    const LOAD_DELAY_MS = 8000;
    // Explicit content scores near 1.0; 0.9 leaves ordinary footage alone.
    const THRESHOLD = 0.9;
    const STRIKES_MAX = 5;
    let cancelled = false;
    let interval: number | null = null;
    let timer: number | null = null;
    let model: import("nsfwjs").NSFWJS | null = null;
    let strikes = 0;
    let kicked = false;

    const scoreFrame = async (v: HTMLVideoElement) => {
      const preds = await model!.classify(v, 5);
      // "Sexy" is excluded on purpose — see note above.
      return preds
        .filter((p) => p.className === "Porn" || p.className === "Hentai")
        .reduce((s, p) => s + p.probability, 0);
    };

    const tick = async () => {
      if (cancelled || kicked || !model) return;
      const v = videoRef.current;
      const stream = streamRef.current;
      const camOn = !!stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
      if (!camOn || !v || v.readyState < 2 || v.videoWidth === 0) return;
      try {
        const unsafe = await scoreFrame(v);
        if (unsafe < THRESHOLD) {
          if (strikes > 0) setNsfwWarn(false);
          strikes = 0;
          return;
        }

        // Second look before counting it — motion blur and odd frames produce
        // one-off false positives.
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled || !videoRef.current) return;
        if ((await scoreFrame(videoRef.current)) < THRESHOLD) return;

        strikes += 1;
        setNsfwWarn(true);
        if (strikes === 1) {
          toast.warning("Please keep your camera appropriate for class.");
        }
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
          const nsfw = await import("nsfwjs");
          await import("@tensorflow/tfjs");
          if (cancelled) return;
          model = await nsfw.load();
          if (cancelled) return;
          interval = window.setInterval(tick, SAMPLE_MS);
        } catch (err) {
          console.error("NSFW model failed to load", err);
        }
      })();
    }, LOAD_DELAY_MS);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (interval) window.clearInterval(interval);
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

  const toggleMic = () => {
    const next = !mic;
    setMic(next);
    ensureStream({ audio: next, video: cam });
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

  // Attach the stream whenever the <video> element mounts OR a new stream arrives.
  useEffect(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!cam || !v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [cam, streamTick]);

  // Live peer-to-peer video with everyone else in the classroom.
  const peerIds = useMemo(() => remoteParticipants.map((p) => p.id), [remoteParticipants]);
  const remoteStreams = useWebrtcMesh({
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
      const { data: rows } = await supabase
        .from("doubts")
        .select("id, body, author_id, created_at")
        .eq("classroom_id", roomId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled || !rows) return;
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
        .on("broadcast", { event: "help_offer" }, ({ payload }) => {
          const p = payload as { to: string; helper: string; doubt: string };
          if (p?.to !== uid) return;
          setHelpOffer({ helper: p.helper, doubt: p.doubt });
        })
        // Someone invited us into their private session -> ask to accept/reject.
        .on("broadcast", { event: "private_invite" }, ({ payload }) => {
          const p = payload as { to: string[]; hostUserId: string; hostName: string };
          if (!p?.to?.includes(uid)) return;
          setIncomingInvite({ hostUserId: p.hostUserId, hostName: p.hostName });
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

        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await channel!.track({
              user_id: uid,
              session_key: myKey,
              name: displayName,
              mic: false,
              cam: false,
            });
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [roomId]);

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
      interval = window.setInterval(() => void markPresence(userId, roomId, slug), 45_000);
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      void clearPresence(userId);
    };
  }, [userId, roomId]);

  // Push our mic/cam state into presence whenever it changes.
  useEffect(() => {
    const ch = presenceChannelRef.current;
    if (!ch || !userId) return;
    const displayName = profile?.name?.trim() || "Student";
    void ch.track({
      user_id: userId,
      session_key: sessionKeyRef.current,
      name: displayName,
      mic,
      cam,
    });
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
  const sendInvites = async (ids: string[]) => {
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
      },
    });
    toast("Invite sent — waiting for them to accept.");
  };

  const startPrivateWith = async (ids: string[]) => {
    setInvitedIds([]);
    setPrivateSession(true);
    await sendInvites(ids);
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
      // The host offered help on our doubt, so they are the one we rate when
      // the session ends.
      setPendingRatee(invite.hostUserId);
      setPrivateSession(true);
    }
  };

  if (privateSession) {
    const invitees = remoteParticipants.filter((p) => invitedIds.includes(p.userId ?? p.id));

    return (
      <PrivateSession
        youName={youName}
        invitees={invitees}
        roomParticipants={remoteParticipants.filter((p) => !blocked.includes(p.userId ?? p.id))}
        onReturn={() => {
          setPrivateSession(false);
          setInvitedIds([]);
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleParticipants.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-xl border bg-room-card p-4 ${
                  p.you ? "border-primary" : "border-white/10"
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
                <div className="flex h-24 items-center justify-center">
                  {p.you && cam ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="h-full w-full rounded-lg object-cover"
                    />
                  ) : !p.you && remoteStreams[p.id] ? (
                    <RemoteVideo stream={remoteStreams[p.id]} />
                  ) : !p.you && p.cam ? (
                    <div className="flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br from-indigo-900 to-purple-900 text-xs text-white/70">
                      Connecting camera…
                    </div>
                  ) : p.feed ? (
                    <div className="flex h-full w-full items-center justify-center rounded-lg bg-gradient-to-br from-indigo-900 to-purple-900 text-xs text-white/70">
                      ● Camera Feed
                    </div>
                  ) : (
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-full ${p.color} text-base font-bold`}
                    >
                      {p.initials}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 truncate">
                    <span className="truncate font-semibold">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-white/60">
                    {(p.you ? mic : p.mic) ? (
                      <Mic className="h-3 w-3" />
                    ) : (
                      <MicOff className="h-3 w-3 text-danger" />
                    )}
                    {(p.you ? cam : p.cam) ? (
                      <Video className="h-3 w-3" />
                    ) : (
                      <VideoOff className="h-3 w-3" />
                    )}
                  </div>
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
                        onClick={() => setInviteOpen(true)}
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
          startPrivateWith(ids);
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
}: {
  youName: string;
  invitees: Participant[];
  roomParticipants: Participant[];
  onReturn: () => void;
  onInvite: (ids: string[]) => void;
}) {
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [streamTick, setStreamTick] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gumTokenRef = useRef(0);

  const all = invitees;

  const totalSeats = 1 + all.length; // you + others
  const remainingSlots = Math.max(0, 7 - totalSeats);

  const ensureStream = async (want: { audio: boolean; video: boolean }) => {
    const token = ++gumTokenRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamTick((n) => n + 1);
    if (!want.audio && !want.video) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Camera is not available in this browser.");
        setMic(false);
        setCam(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: want.audio,
        video: want.video ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      if (token !== gumTokenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = want.video ? stream : null;
        const p = videoRef.current.play?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      setStreamTick((n) => n + 1);
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === "NotAllowedError")
        toast.error("Permission denied. Allow camera/mic in browser settings.");
      else if (e.name === "NotFoundError") toast.error("No camera or microphone found.");
      else if (e.name === "NotReadableError") toast.error("Device is in use by another app.");
      else toast.error("Could not access camera/microphone.");
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setMic(false);
      setCam(false);
    }
  };

  useEffect(() => {
    toast("Private Session Started");
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!cam || !v || !s) return;
    if (v.srcObject !== s) v.srcObject = s;
    const p = v.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [cam, streamTick]);

  const toggleMic = () => {
    const n = !mic;
    setMic(n);
    ensureStream({ audio: n, video: cam });
  };
  const toggleCam = () => {
    const n = !cam;
    setCam(n);
    ensureStream({ audio: mic, video: n });
  };

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
        <div className="ml-auto flex items-center gap-2">
          <button className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            <VolumeX className="h-4 w-4" /> Mute All
          </button>
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

      <main className="mx-auto grid max-w-4xl gap-4 p-8 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-primary bg-room-card p-4 text-center">
          <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-900 to-purple-900">
            {cam ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold">
                {youName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
            {youName}
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold">MOD</span>
            {mic ? (
              <Mic className="h-3 w-3 text-success" />
            ) : (
              <MicOff className="h-3 w-3 text-danger" />
            )}
            {cam ? (
              <Video className="h-3 w-3 text-success" />
            ) : (
              <VideoOff className="h-3 w-3 text-danger" />
            )}
          </div>
        </div>
        {all.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-white/10 bg-room-card p-4 text-center"
          >
            <div className="flex h-40 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900">
              <div
                className={`flex h-20 w-20 items-center justify-center rounded-full ${p.color} text-2xl font-bold`}
              >
                {p.initials}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold">
              {p.name}
            </div>
          </div>
        ))}
      </main>

      {/* Bottom controls */}
      <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-room-card/95 px-3 py-2 shadow-elevated backdrop-blur">
        <CtlBtn
          title={mic ? "Mute mic" : "Unmute mic"}
          onClick={toggleMic}
          className={mic ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}
        >
          {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </CtlBtn>
        <CtlBtn
          title={cam ? "Turn camera off" : "Turn camera on"}
          onClick={toggleCam}
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
