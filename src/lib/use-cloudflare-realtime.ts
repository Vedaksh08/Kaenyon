import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  openRealtimeSession,
  pullRealtimeTracks,
  pushRealtimeTracks,
  renegotiateRealtime,
} from "@/lib/cloudflare-realtime.functions";
import {
  CAMERA_CONSTRAINTS,
  type ClassroomVideo,
  type LiveStatus,
  type Peer,
} from "@/lib/classroom-video";

/**
 * Cloudflare Realtime as the SFU, with our own WebRTC on top.
 *
 * There is no client SDK here: this is a plain RTCPeerConnection talking to
 * Cloudflare's HTTP API through our server. One session per student, pushing
 * their own tracks and pulling everyone else's over the same connection.
 *
 * Cloudflare forwards media and knows nothing else — no rooms, no membership,
 * no names. The roster comes from Supabase Realtime *presence* rather than
 * broadcast, because presence is authoritative: a late joiner is handed the
 * full state on sync, and a browser that closes is dropped without needing to
 * announce anything. That is the piece a raw SFU cannot supply.
 */

type TrackKind = "cam" | "mic" | "screen";

interface PeerMeta {
  sessionId: string;
  userId: string;
  name: string;
  isModerator: boolean;
  micMuted: boolean;
  camMuted: boolean;
  handRaised: boolean;
  camTrack: string | null;
  micTrack: string | null;
  shareTrack: string | null;
}

interface RemoteMedia {
  cam?: MediaStreamTrack;
  mic?: MediaStreamTrack;
  screen?: MediaStreamTrack;
}

/** Three layers, so the SFU can send each viewer something they can afford. */
const SEND_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: "f", scaleResolutionDownBy: 1.0 },
  { rid: "h", scaleResolutionDownBy: 2.0 },
  { rid: "q", scaleResolutionDownBy: 4.0 },
];

export function useCloudflareRealtime(opts: {
  classId: string | null;
  /** Null until the Supabase session is known. */
  accessToken: string | null;
  identity: string | null;
  name: string;
  isModerator: boolean;
  startMuted: boolean;
  onDisconnected: () => void;
}): ClassroomVideo {
  const { classId, accessToken, identity, name, isModerator, startMuted, onDisconnected } = opts;

  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [micMuted, setMicMuted] = useState(startMuted);
  const [camMuted, setCamMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [handsRaised, setHandsRaised] = useState<Set<string>>(new Set());
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const ticketRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const shareStreamRef = useRef<MediaStream | null>(null);
  const camSenderRef = useRef<RTCRtpSender | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const shareSenderRef = useRef<RTCRtpSender | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myMetaRef = useRef<PeerMeta | null>(null);
  const rosterRef = useRef(new Map<string, PeerMeta>());
  const mediaRef = useRef(new Map<string, RemoteMedia>());
  /** mid -> which peer and which of their tracks arrives on it. */
  const midMapRef = useRef(new Map<string, { userId: string; kind: TrackKind }>());
  /** `${userId}:${trackName}` already pulled, so a resync does not re-pull. */
  const pulledRef = useRef(new Set<string>());
  const announceRef = useRef<() => void>(() => {});
  const negotiateRef = useRef<(() => Promise<void>) | null>(null);

  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  useEffect(() => {
    if (!classId || !accessToken || !identity) return;

    let disposed = false;
    let pullTimer: number | undefined;
    let pending: Array<{
      location: "remote";
      sessionId: string;
      trackName: string;
      userId: string;
      kind: TrackKind;
    }> = [];

    const roster = rosterRef.current;
    const media = mediaRef.current;
    const midMap = midMapRef.current;
    const pulled = pulledRef.current;

    // Every SDP exchange on one connection has to be serialised, or two people
    // joining at the same moment collide mid-negotiation and the connection
    // never recovers.
    let chain: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = chain.then(fn, fn) as Promise<T>;
      chain = run.catch(() => undefined);
      return run;
    };

    const sync = () => {
      if (disposed) return;
      const next: Peer[] = [];
      roster.forEach((meta, userId) => {
        const m = media.get(userId) ?? {};
        next.push({
          identity: userId,
          name: meta.name?.trim() || "Student",
          video: m.screen ?? (meta.camMuted ? undefined : m.cam),
          audio: m.mic,
          isScreenShare: Boolean(m.screen),
          speaking: false,
          micMuted: meta.micMuted,
        });
      });
      setPeers(next);

      const hands = new Set<string>();
      roster.forEach((m) => m.handRaised && hands.add(m.userId));
      setHandsRaised(hands);
    };

    const flushPulls = () =>
      enqueue(async () => {
        const batch = pending;
        pending = [];
        const pc = pcRef.current;
        const ticket = ticketRef.current;
        if (disposed || !pc || !ticket || batch.length === 0) return;

        // Register the mid mapping before the remote description lands, or the
        // track event fires against an empty map and the tile stays blank.
        const res = await pullRealtimeTracks({
          data: {
            ticket,
            tracks: batch.map(({ location, sessionId, trackName }) => ({
              location,
              sessionId,
              trackName,
            })),
          },
        });
        if (disposed) return;

        res.tracks.forEach((t, i) => {
          const want = batch[i];
          if (!want) return;
          if (t.errorCode) {
            // Usually the publisher left between presence and this call.
            pulled.delete(`${want.userId}:${want.trackName}`);
            return;
          }
          if (t.mid) midMap.set(t.mid, { userId: want.userId, kind: want.kind });
        });

        if (res.requiresImmediateRenegotiation && res.sessionDescription) {
          await pc.setRemoteDescription(res.sessionDescription as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (disposed) return;
          await renegotiateRealtime({ data: { ticket, sdp: answer.sdp ?? "" } });
        }
      });

    const schedulePull = (entry: (typeof pending)[number]) => {
      const key = `${entry.userId}:${entry.trackName}`;
      if (pulled.has(key)) return;
      pulled.add(key);
      pending.push(entry);
      window.clearTimeout(pullTimer);
      // One batched call rather than one per person, so a 30-person room is a
      // handful of renegotiations instead of thirty.
      pullTimer = window.setTimeout(() => void flushPulls(), 250);
    };

    /** Pull anything in the roster we are not already receiving. */
    const reconcile = () => {
      roster.forEach((meta) => {
        if (meta.userId === identity || !meta.sessionId) return;
        const wanted: Array<[TrackKind, string | null]> = [
          ["cam", meta.camTrack],
          ["mic", meta.micTrack],
          ["screen", meta.shareTrack],
        ];
        for (const [kind, trackName] of wanted) {
          if (!trackName) continue;
          schedulePull({
            location: "remote",
            sessionId: meta.sessionId,
            trackName,
            userId: meta.userId,
            kind,
          });
        }
      });
    };

    const run = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: CAMERA_CONSTRAINTS,
        audio: startMuted ? false : { echoCancellation: true, noiseSuppression: true },
      });
      if (disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      const camTrack = stream.getVideoTracks()[0] ?? null;
      const micTrack = stream.getAudioTracks()[0] ?? null;
      setLocalVideo(camTrack);

      const { sessionId, ticket } = await openRealtimeSession({
        data: { classId, accessToken },
      });
      if (disposed) return;
      ticketRef.current = ticket;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        // Cloudflare requires everything on one transport.
        bundlePolicy: "max-bundle",
      });
      pcRef.current = pc;

      pc.addEventListener("track", (event) => {
        const mid = event.transceiver.mid;
        if (!mid) return;
        const owner = midMap.get(mid);
        if (!owner) return;
        const entry = media.get(owner.userId) ?? {};
        entry[owner.kind] = event.track;
        media.set(owner.userId, entry);
        sync();
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        if (disposed) return;
        if (pc.iceConnectionState === "failed") setStatus("reconnecting");
        else if (pc.iceConnectionState === "connected") setStatus("connected");
      });

      const camName = camTrack ? `cam-${identity}` : null;
      const micName = micTrack ? `mic-${identity}` : null;

      const transceivers: Array<{ mid: string | null; trackName: string }> = [];
      if (camTrack) {
        const t = pc.addTransceiver(camTrack, {
          direction: "sendonly",
          sendEncodings: SEND_ENCODINGS,
        });
        camSenderRef.current = t.sender;
        transceivers.push({ mid: t.mid, trackName: camName! });
      }
      if (micTrack) {
        const t = pc.addTransceiver(micTrack, { direction: "sendonly" });
        micSenderRef.current = t.sender;
        transceivers.push({ mid: t.mid, trackName: micName! });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (disposed) return;

      // mid is only assigned once the local description is set.
      const localTracks = pc
        .getTransceivers()
        .filter((t) => t.sender.track)
        .map((t) => ({
          location: "local" as const,
          mid: t.mid ?? undefined,
          trackName: t.sender.track === camTrack ? camName! : micName!,
        }));

      const pushed = await pushRealtimeTracks({
        data: { ticket, sdp: offer.sdp ?? "", tracks: localTracks },
      });
      if (disposed) return;
      await pc.setRemoteDescription(pushed.sessionDescription as RTCSessionDescriptionInit);

      const myMeta: PeerMeta = {
        sessionId,
        userId: identity,
        name,
        isModerator,
        micMuted: startMuted,
        camMuted: false,
        handRaised: false,
        camTrack: camName,
        micTrack: micName,
        shareTrack: null,
      };
      myMetaRef.current = myMeta;

      const channel = supabase.channel(`cfrt:${classId}`, {
        config: { presence: { key: identity } },
      });
      channelRef.current = channel;

      const announce = () => {
        if (disposed || !myMetaRef.current) return;
        void channel.track(myMetaRef.current);
      };
      announceRef.current = announce;

      channel
        .on("presence", { event: "sync" }, () => {
          if (disposed) return;
          const state = channel.presenceState<PeerMeta>();
          const seen = new Set<string>();
          roster.clear();
          Object.values(state)
            .flat()
            .forEach((m) => {
              if (!m?.userId || m.userId === identity) return;
              roster.set(m.userId, m);
              seen.add(m.userId);
            });
          // Presence is the authority on who left, so anything not in it goes.
          media.forEach((_v, userId) => {
            if (!seen.has(userId)) media.delete(userId);
          });
          reconcile();
          sync();
        })
        .on("broadcast", { event: "mute-all" }, () => {
          if (disposed || myMetaRef.current?.isModerator) return;
          const track = micSenderRef.current?.track;
          if (track) track.enabled = false;
          setMicMuted(true);
          if (myMetaRef.current) myMetaRef.current.micMuted = true;
          announce();
        });

      await channel.subscribe(async (state) => {
        if (state === "SUBSCRIBED") await channel.track(myMeta);
      });
      if (disposed) return;

      setStatus("connected");
      setError(null);
      sync();
    };

    /** Re-offers the send side after adding a screen share or a late mic. */
    negotiateRef.current = () =>
      enqueue(async () => {
        const pc = pcRef.current;
        const ticket = ticketRef.current;
        if (!pc || !ticket) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const tracks = pc
          .getTransceivers()
          .filter((t) => t.direction === "sendonly" && t.sender.track && t.mid)
          .map((t) => ({
            location: "local" as const,
            mid: t.mid ?? undefined,
            trackName:
              t.sender === camSenderRef.current
                ? `cam-${identity}`
                : t.sender === micSenderRef.current
                  ? `mic-${identity}`
                  : (myMetaRef.current?.shareTrack ?? `screen-${identity}`),
          }));
        const res = await pushRealtimeTracks({
          data: { ticket, sdp: offer.sdp ?? "", tracks },
        });
        await pc.setRemoteDescription(res.sessionDescription as RTCSessionDescriptionInit);
      });

    void run().catch((e: unknown) => {
      if (disposed) return;
      console.error("[cloudflare-realtime] join failed", e);
      const msg = e instanceof Error ? e.message : "Could not join the classroom.";
      setError(
        /permission|notallowed|denied/i.test(msg)
          ? "Camera or microphone permission was denied. Allow it in your browser and try again."
          : msg,
      );
      setStatus("error");
    });

    return () => {
      disposed = true;
      window.clearTimeout(pullTimer);
      roster.clear();
      media.clear();
      midMap.clear();
      pulled.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      shareStreamRef.current = null;
      camSenderRef.current = null;
      micSenderRef.current = null;
      shareSenderRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      ticketRef.current = null;
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) {
        void channel.untrack().then(() => supabase.removeChannel(channel));
      }
    };
  }, [classId, accessToken, identity, name, isModerator, startMuted]);

  const toggleMic = useCallback(async () => {
    const pc = pcRef.current;
    const meta = myMetaRef.current;
    if (!pc || !meta) return;

    // Students publish no mic at all, so unmuting has to capture and add one.
    if (!micSenderRef.current) {
      try {
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        const track = audio.getAudioTracks()[0];
        if (!track) return;
        localStreamRef.current?.addTrack(track);
        micSenderRef.current = pc.addTransceiver(track, { direction: "sendonly" }).sender;
        await negotiateRef.current?.();
        meta.micTrack = `mic-${meta.userId}`;
        meta.micMuted = false;
        setMicMuted(false);
        announceRef.current();
      } catch {
        /* permission denied */
      }
      return;
    }

    const track = micSenderRef.current.track;
    if (!track) return;
    track.enabled = !track.enabled;
    setMicMuted(!track.enabled);
    meta.micMuted = !track.enabled;
    announceRef.current();
  }, []);

  const toggleCam = useCallback(async () => {
    const track = camSenderRef.current?.track;
    const meta = myMetaRef.current;
    if (!track || !meta) return;
    // Disabling sends black frames rather than tearing the track down, so no
    // renegotiation is needed; peers show the avatar from the announced flag.
    track.enabled = !track.enabled;
    setCamMuted(!track.enabled);
    setLocalVideo(track.enabled ? track : null);
    meta.camMuted = !track.enabled;
    announceRef.current();
  }, []);

  const toggleShare = useCallback(async () => {
    const pc = pcRef.current;
    const meta = myMetaRef.current;
    if (!pc || !meta) return;

    if (shareSenderRef.current) {
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
      shareStreamRef.current = null;
      shareSenderRef.current = null;
      setSharing(false);
      meta.shareTrack = null;
      announceRef.current();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      shareStreamRef.current = stream;
      // A fresh name each time, so restarting a share is never confused with
      // the previous one still being torn down.
      const trackName = `screen-${meta.userId}-${Date.now()}`;
      meta.shareTrack = trackName;
      shareSenderRef.current = pc.addTransceiver(track, { direction: "sendonly" }).sender;
      await negotiateRef.current?.();
      setSharing(true);
      announceRef.current();

      track.addEventListener("ended", () => {
        shareStreamRef.current = null;
        shareSenderRef.current = null;
        setSharing(false);
        meta.shareTrack = null;
        announceRef.current();
      });
    } catch {
      /* the picker was dismissed */
    }
  }, []);

  const toggleHand = useCallback(async () => {
    const meta = myMetaRef.current;
    if (!meta) return;
    meta.handRaised = !meta.handRaised;
    setHandRaised(meta.handRaised);
    announceRef.current();
  }, []);

  const muteEveryone = useCallback(async () => {
    // Advisory: Cloudflare has no concept of a room, so there is nobody to
    // enforce it but the clients themselves.
    await channelRef.current?.send({ type: "broadcast", event: "mute-all", payload: {} });
  }, []);

  const leave = useCallback(async () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    shareStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    await channelRef.current?.untrack();
    onDisconnectedRef.current();
  }, []);

  return {
    status,
    error,
    peers,
    micMuted,
    camMuted,
    sharing,
    localVideo,
    handRaised,
    handsRaised,
    toggleMic,
    toggleCam,
    toggleShare,
    toggleHand,
    muteEveryone,
    leave,
  };
}
