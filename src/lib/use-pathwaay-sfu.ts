import { useCallback, useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";
import type { types } from "mediasoup-client";
import { io, type Socket } from "socket.io-client";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMERA_CONSTRAINTS,
  CAMERA_ENCODINGS,
  type ClassroomVideo,
  type LiveStatus,
  type Peer,
} from "@/lib/classroom-video";

/**
 * Pathwaay's own mediasoup SFU.
 *
 * Speaks the socket.io protocol in ninadaradhye-code/Pathwaay-SFU exactly as it
 * stands — joinRoom, createWebRtcTransport, connectWebRtcTransport, produce,
 * consume, resumeConsumer — so no server change is needed to use it.
 *
 * That server deliberately carries media and nothing else: it has no notion of
 * who a socket belongs to, no display names, no screen-share flag, no mute
 * command, and no way to say "my camera is off". Rather than fork it, all of
 * that rides on a Supabase Realtime broadcast channel beside the media, which
 * this app already depends on for presence. The SFU stays a pure SFU.
 */

type Ack<T> = ({ success: true } & T) | { success: false; error?: string };

/** socket.io acks are callbacks, and every step of the handshake is sequential. */
function request<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`The classroom server did not answer (${event}).`));
    }, 15_000);
    socket.emit(event, payload, (res: Ack<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.success) resolve(res as T);
      else reject(new Error(res?.error || `${event} failed`));
    });
  });
}

/** What the SFU cannot tell us, peers announce over Supabase. */
interface PeerMeta {
  socketId: string;
  userId: string;
  name: string;
  isModerator: boolean;
  micMuted: boolean;
  camMuted: boolean;
  handRaised: boolean;
  /** Which of this peer's video producers is a screen, if any. */
  shareProducerId: string | null;
}

interface ProducerRef {
  producerId: string;
  socketId: string;
  kind: string;
}

export function usePathwaaySfu(opts: {
  /** Origin of the SFU. Null disables the hook entirely. */
  url: string | null;
  roomId: string | null;
  identity: string | null;
  name: string;
  isModerator: boolean;
  /** Students publish no audio track at all, so the silence is real. */
  startMuted: boolean;
  onDisconnected: () => void;
}): ClassroomVideo {
  const { url, roomId, identity, name, isModerator, startMuted, onDisconnected } = opts;

  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [micMuted, setMicMuted] = useState(startMuted);
  const [camMuted, setCamMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [handsRaised, setHandsRaised] = useState<Set<string>>(new Set());
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);
  /** Bumped to rebuild the whole session after an unexpected drop. */
  const [generation, setGeneration] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const sendTransportRef = useRef<types.Transport | null>(null);
  const camProducerRef = useRef<types.Producer | null>(null);
  const micProducerRef = useRef<types.Producer | null>(null);
  const shareProducerRef = useRef<types.Producer | null>(null);
  const consumersRef = useRef(new Map<string, { consumer: types.Consumer; socketId: string }>());
  const metaRef = useRef(new Map<string, PeerMeta>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const shareStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myMetaRef = useRef<PeerMeta | null>(null);
  const announceRef = useRef<() => void>(() => {});
  const leavingRef = useRef(false);

  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  useEffect(() => {
    if (!url || !roomId || !identity) return;

    let disposed = false;
    let reconnectTimer: number | undefined;

    // Captured so the cleanup below closes over this effect's own maps rather
    // than reading the refs after a later effect has replaced them.
    const consumers = consumersRef.current;
    const metas = metaRef.current;

    // The SFU rejects a second joinRoom from the same socket, and socket.io's
    // own reconnect would do exactly that against a peer the server has already
    // torn down. Rebuilding from scratch is the only knowable state.
    const socket = io(url, { transports: ["websocket"], reconnection: false });
    socketRef.current = socket;

    const myMeta: PeerMeta = {
      socketId: "",
      userId: identity,
      name,
      isModerator,
      micMuted: startMuted,
      camMuted: false,
      handRaised: false,
      shareProducerId: null,
    };
    myMetaRef.current = myMeta;

    const channel = supabase.channel(`sfu:${roomId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    const announce = () => {
      if (disposed || !myMetaRef.current?.socketId) return;
      void channel.send({ type: "broadcast", event: "peer", payload: myMetaRef.current });
    };
    announceRef.current = announce;

    /** Rebuild the participant list from consumers joined to announced metadata. */
    const sync = () => {
      if (disposed) return;
      const media = new Map<
        string,
        { video?: MediaStreamTrack; audio?: MediaStreamTrack; screen?: MediaStreamTrack }
      >();

      consumersRef.current.forEach(({ consumer, socketId }, producerId) => {
        const entry = media.get(socketId) ?? {};
        if (consumer.kind === "audio") entry.audio = consumer.track;
        else if (metaRef.current.get(socketId)?.shareProducerId === producerId)
          entry.screen = consumer.track;
        else entry.video = consumer.track;
        media.set(socketId, entry);
      });

      // Include peers who have announced but not produced yet, so a tile appears
      // when they arrive rather than when their camera warms up.
      metaRef.current.forEach((_meta, socketId) => {
        if (!media.has(socketId)) media.set(socketId, {});
      });

      const next: Peer[] = [];
      media.forEach((m, socketId) => {
        const meta = metaRef.current.get(socketId);
        next.push({
          identity: meta?.userId ?? socketId,
          name: meta?.name?.trim() || "Student",
          // A screen wins the tile. A camera the peer turned off falls back to
          // the avatar, because a disabled track still sends black frames.
          video: m.screen ?? (meta?.camMuted ? undefined : m.video),
          audio: m.audio,
          isScreenShare: Boolean(m.screen),
          speaking: false,
          micMuted: meta?.micMuted ?? true,
        });
      });
      setPeers(next);

      const hands = new Set<string>();
      metaRef.current.forEach((m) => m.handRaised && hands.add(m.userId));
      setHandsRaised(hands);
    };

    const dropProducer = (producerId: string) => {
      const entry = consumersRef.current.get(producerId);
      if (!entry) return;
      entry.consumer.close();
      consumersRef.current.delete(producerId);
    };

    channel
      .on("broadcast", { event: "peer" }, ({ payload }) => {
        const m = payload as PeerMeta;
        if (disposed || !m?.socketId || m.socketId === socket.id) return;
        const previous = metaRef.current.get(m.socketId);
        metaRef.current.set(m.socketId, m);
        // A share that ended leaves a producer the SFU never closes, so drop its
        // consumer here or a frozen last frame would replace that peer's camera.
        if (previous?.shareProducerId && previous.shareProducerId !== m.shareProducerId) {
          dropProducer(previous.shareProducerId);
        }
        sync();
      })
      .on("broadcast", { event: "who" }, () => announce())
      .on("broadcast", { event: "mute-all" }, () => {
        if (disposed || myMetaRef.current?.isModerator) return;
        const track = micProducerRef.current?.track;
        if (track) track.enabled = false;
        setMicMuted(true);
        if (myMetaRef.current) myMetaRef.current.micMuted = true;
        announce();
      });

    const consume = async (p: ProducerRef, device: Device, recvTransport: types.Transport) => {
      if (disposed || p.socketId === socket.id) return;
      if (consumersRef.current.has(p.producerId)) return;
      try {
        const res = await request<{
          consumer: {
            id: string;
            producerId: string;
            kind: types.MediaKind;
            rtpParameters: types.RtpParameters;
          };
        }>(socket, "consume", {
          roomId,
          transportId: recvTransport.id,
          producerId: p.producerId,
          rtpCapabilities: device.rtpCapabilities,
        });
        if (disposed) return;

        const consumer = await recvTransport.consume({
          id: res.consumer.id,
          producerId: res.consumer.producerId,
          kind: res.consumer.kind,
          rtpParameters: res.consumer.rtpParameters,
        });
        if (disposed) {
          consumer.close();
          return;
        }
        consumersRef.current.set(p.producerId, { consumer, socketId: p.socketId });
        // The SFU creates every consumer paused so that no media is missed.
        await request(socket, "resumeConsumer", { roomId, consumerId: consumer.id });
        sync();
      } catch (e) {
        console.error("[sfu] consume failed", p.producerId, e);
      }
    };

    const run = async () => {
      // Ask for media first: a denied permission should fail before we take a
      // slot in the room.
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
      setLocalVideo(camTrack);

      await new Promise<void>((resolve, reject) => {
        if (socket.connected) return resolve();
        socket.once("connect", () => resolve());
        socket.once("connect_error", (e: Error) =>
          reject(
            new Error(
              `Could not reach the classroom server at ${url}. ${e.message || "Connection refused."}`,
            ),
          ),
        );
      });
      if (disposed) return;

      myMeta.socketId = socket.id ?? "";

      const join = await request<{
        rtpCapabilities: types.RtpCapabilities;
        existingProducers: ProducerRef[];
      }>(socket, "joinRoom", { roomId });
      if (disposed) return;

      const device = new Device();
      await device.load({ routerRtpCapabilities: join.rtpCapabilities });
      if (disposed) return;

      const sendInfo = await request<{ transport: types.TransportOptions }>(
        socket,
        "createWebRtcTransport",
        { roomId, direction: "send" },
      );
      if (disposed) return;
      const sendTransport = device.createSendTransport(sendInfo.transport);
      sendTransportRef.current = sendTransport;

      sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
        request(socket, "connectWebRtcTransport", {
          roomId,
          transportId: sendTransport.id,
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      });

      sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        request<{ producerId: string }>(socket, "produce", {
          roomId,
          transportId: sendTransport.id,
          kind,
          rtpParameters,
          appData,
        })
          .then((r) => callback({ id: r.producerId }))
          .catch(errback);
      });

      const recvInfo = await request<{ transport: types.TransportOptions }>(
        socket,
        "createWebRtcTransport",
        { roomId, direction: "recv" },
      );
      if (disposed) return;
      const recvTransport = device.createRecvTransport(recvInfo.transport);

      recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
        request(socket, "connectWebRtcTransport", {
          roomId,
          transportId: recvTransport.id,
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      });

      if (camTrack) {
        camProducerRef.current = await sendTransport.produce({
          track: camTrack,
          encodings: CAMERA_ENCODINGS,
          codecOptions: { videoGoogleStartBitrate: 400 },
          appData: { source: "camera" },
        });
      }
      const micTrack = stream.getAudioTracks()[0];
      if (micTrack) {
        micProducerRef.current = await sendTransport.produce({
          track: micTrack,
          appData: { source: "mic" },
        });
      }
      if (disposed) return;

      socket.on("newProducer", (p: ProducerRef) => void consume(p, device, recvTransport));
      socket.on("consumerClosed", ({ producerId }: { producerId: string }) => {
        dropProducer(producerId);
        sync();
      });
      socket.on("peerLeft", ({ socketId }: { socketId: string }) => {
        consumersRef.current.forEach((entry, producerId) => {
          if (entry.socketId === socketId) {
            entry.consumer.close();
            consumersRef.current.delete(producerId);
          }
        });
        metaRef.current.delete(socketId);
        sync();
      });
      socket.on("disconnect", () => {
        if (disposed || leavingRef.current) return;
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(() => setGeneration((g) => g + 1), 1500);
      });

      for (const p of join.existingProducers) await consume(p, device, recvTransport);

      await channel.subscribe();
      if (disposed) return;
      announce();
      // Everyone already here re-announces, which is how we learn their names.
      void channel.send({ type: "broadcast", event: "who", payload: {} });

      setStatus("connected");
      setError(null);
      sync();
    };

    void run().catch((e: unknown) => {
      if (disposed) return;
      console.error("[sfu] join failed", e);
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
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      consumers.forEach(({ consumer }) => consumer.close());
      consumers.clear();
      metas.clear();
      camProducerRef.current?.close();
      micProducerRef.current?.close();
      shareProducerRef.current?.close();
      camProducerRef.current = null;
      micProducerRef.current = null;
      shareProducerRef.current = null;
      sendTransportRef.current?.close();
      sendTransportRef.current = null;
      // Without this the tab keeps publishing and the camera light stays on.
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      shareStreamRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [url, roomId, identity, name, isModerator, startMuted, generation]);

  const toggleMic = useCallback(async () => {
    const meta = myMetaRef.current;
    const transport = sendTransportRef.current;
    if (!meta || !transport) return;

    // Students never get an audio track in the first place, so unmuting has to
    // capture one now rather than flip a flag on something that is not there.
    if (!micProducerRef.current) {
      try {
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        const track = audio.getAudioTracks()[0];
        if (!track) return;
        localStreamRef.current?.addTrack(track);
        micProducerRef.current = await transport.produce({ track, appData: { source: "mic" } });
        setMicMuted(false);
        meta.micMuted = false;
        announceRef.current();
      } catch {
        /* permission denied */
      }
      return;
    }

    const track = micProducerRef.current.track;
    if (!track) return;
    track.enabled = !track.enabled;
    setMicMuted(!track.enabled);
    meta.micMuted = !track.enabled;
    announceRef.current();
  }, []);

  const toggleCam = useCallback(async () => {
    const track = camProducerRef.current?.track;
    const meta = myMetaRef.current;
    if (!track || !meta) return;
    // The SFU has no pauseProducer, so we keep sending and disable the track:
    // peers get black frames and hide the tile from the announced flag.
    track.enabled = !track.enabled;
    setCamMuted(!track.enabled);
    setLocalVideo(track.enabled ? track : null);
    meta.camMuted = !track.enabled;
    announceRef.current();
  }, []);

  const toggleShare = useCallback(async () => {
    const transport = sendTransportRef.current;
    const meta = myMetaRef.current;
    if (!transport || !meta) return;

    if (shareProducerRef.current) {
      shareProducerRef.current.close();
      shareProducerRef.current = null;
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
      shareStreamRef.current = null;
      setSharing(false);
      meta.shareProducerId = null;
      announceRef.current();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      shareStreamRef.current = stream;
      // A screen is detail rather than motion, so it goes out as one full
      // layer instead of the three scaled ones a camera uses.
      const producer = await transport.produce({ track, appData: { source: "screen" } });
      shareProducerRef.current = producer;
      setSharing(true);
      meta.shareProducerId = producer.id;
      announceRef.current();
      // The browser's own "Stop sharing" bar bypasses our button.
      track.addEventListener("ended", () => {
        shareProducerRef.current?.close();
        shareProducerRef.current = null;
        shareStreamRef.current = null;
        setSharing(false);
        meta.shareProducerId = null;
        announceRef.current();
      });
    } catch {
      /* the picker was dismissed */
    }
  }, []);

  const toggleHand = useCallback(async () => {
    const meta = myMetaRef.current;
    if (!meta) return;
    const raised = !meta.handRaised;
    meta.handRaised = raised;
    setHandRaised(raised);
    announceRef.current();
  }, []);

  const muteEveryone = useCallback(async () => {
    // Advisory rather than enforced: the SFU has no per-producer commands, so
    // this asks each client to mute itself.
    await channelRef.current?.send({ type: "broadcast", event: "mute-all", payload: {} });
  }, []);

  const leave = useCallback(async () => {
    leavingRef.current = true;
    socketRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    shareStreamRef.current?.getTracks().forEach((t) => t.stop());
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
