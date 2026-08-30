import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SignalPayload = {
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// STUN tells a browser its public address; that is enough only when both peers
// can reach each other directly. Behind symmetric NAT — most campus wifi, most
// mobile data — the candidates never pair and the connection fails. A TURN
// relay carries the media instead, and is the difference between "some people
// can see each other" and "everyone can".
//
// The openrelay.metered.ca servers previously listed here no longer exist: the
// hostname does not resolve and every port refuses TCP. Because a dead TURN
// server fails silently — ICE just never finds a working pair — this looked
// like a random per-pair bug rather than missing infrastructure.
//
// Set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL to your own
// relay (Cloudflare, Twilio, Metered, or self-hosted coturn). Without it the
// app still works for peers that can connect directly, and warns in the
// console for those that cannot.
const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

export const HAS_TURN = Boolean(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL);

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    // Several STUN hosts: if one is blocked on a network, the others still
    // give the browser a reflexive candidate.
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
    ...(HAS_TURN
      ? [
          {
            urls: TURN_URL!.split(",").map((u) => u.trim()),
            username: TURN_USERNAME!,
            credential: TURN_CREDENTIAL!,
          },
        ]
      : []),
  ],
  iceCandidatePoolSize: 4,
};

if (typeof window !== "undefined" && !HAS_TURN) {
  console.warn(
    "[rtc] No TURN server configured. Peers that cannot reach each other " +
      "directly (campus wifi, mobile data) will not connect. Set " +
      "VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL.",
  );
}

type Peer = {
  pc: RTCPeerConnection;
  videoSender: RTCRtpSender;
  audioSender: RTCRtpSender;
  videoTransceiver: RTCRtpTransceiver;
  audioTransceiver: RTCRtpTransceiver;
  /** Perfect negotiation: the polite peer yields when offers collide. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Bounded so a dead peer does not retry forever. */
  iceRestarts: number;
  stream: MediaStream;
};

/**
 * Full-mesh WebRTC between everyone in a classroom, signalled over a Supabase
 * Realtime broadcast channel. Returns peerId -> MediaStream so each tile can
 * render that person's live camera.
 *
 * Uses the standard "perfect negotiation" pattern, so *either* side may offer
 * at any time. An earlier version let only the lower session id offer, which
 * meant the higher id could never publish a camera that arrived after the
 * connection was already up — the common case, since getUserMedia resolves a
 * second or two after joining. The result was two people permanently unable to
 * see each other.
 */
export function useWebrtcMesh(opts: {
  roomId: string;
  userId: string | null;
  peerIds: string[];
  localStream: MediaStream | null;
}) {
  const { roomId, userId, peerIds, localStream } = opts;
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  // Exposed so callers can piggyback their own broadcasts (whiteboard strokes,
  // moderator mutes) on the channel that already exists for this session.
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null);
  // Peers whose connection gave up. Surfaced so a tile can say "couldn't
  // connect" instead of sitting black, which is indistinguishable from a
  // camera that is simply off.
  const [failedPeers, setFailedPeers] = useState<Set<string>>(new Set());

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const helloRef = useRef<() => void>(() => {});
  const subscribedRef = useRef(false);
  const peerIdsRef = useRef<string[]>([]);
  // Peers heard over the RTC channel itself. Presence and this channel settle
  // independently, so we cannot rely on peerIds alone to know who is here.
  const knownPeersRef = useRef<Set<string>>(new Set());
  const syncTracksRef = useRef<() => void>(() => {});

  localStreamRef.current = localStream;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const send = (msg: SignalPayload) => {
      if (!subscribedRef.current) return;
      void channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
    };

    const dropPeer = (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (peer) {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      }
      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);
      knownPeersRef.current.delete(peerId);
      setRemoteStreams((prev) => {
        if (!prev[peerId]) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    };

    const getPeer = (peerId: string): Peer => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const stream = new MediaStream();
      const local = localStreamRef.current;

      // Fixed m-line order: video first, then audio.
      // Cap the send bitrate. In a mesh every extra person is another full
      // upload, so an uncapped stream saturates a home connection and shows up
      // as everyone stuttering at once. 250kbps is comfortable for a small
      // tile and leaves headroom for several peers.
      const videoTx = pc.addTransceiver(local?.getVideoTracks()[0] ?? "video", {
        direction: "sendrecv",
        sendEncodings: [{ maxBitrate: 250_000, maxFramerate: 20 }],
      });
      const audioTx = pc.addTransceiver(local?.getAudioTracks()[0] ?? "audio", {
        direction: "sendrecv",
      });

      const peer: Peer = {
        pc,
        videoSender: videoTx.sender,
        audioSender: audioTx.sender,
        videoTransceiver: videoTx,
        audioTransceiver: audioTx,
        // Deterministic and opposite on each side: exactly one peer yields.
        polite: userId > peerId,
        makingOffer: false,
        ignoreOffer: false,
        iceRestarts: 0,
        stream,
      };
      peersRef.current.set(peerId, peer);

      // A peer created after getUserMedia resolved starts from whatever
      // localStreamRef held when addTransceiver ran. Push the current tracks
      // straight away rather than waiting for the next localStream change,
      // which may never come — that delay is why a camera took so long to
      // appear for people who joined later.
      queueMicrotask(() => syncTracksRef.current());

      pc.ontrack = (ev) => {
        const track = ev.track;
        if (!stream.getTracks().includes(track)) stream.addTrack(track);
        // Hand React a new MediaStream identity so the <video> re-binds; mutating
        // the same object in place does not re-render the tile.
        const publish = () => setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        track.onunmute = publish;
        track.onended = () =>
          setRemoteStreams((prev) => {
            if (!prev[peerId]) return prev;
            return { ...prev, [peerId]: stream };
          });
        publish();
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate)
          send({ from: userId, to: peerId, kind: "ice", candidate: ev.candidate.toJSON() });
      };

      // Perfect negotiation: anyone may offer. Collisions are resolved by the
      // polite/impolite roles rather than by forbidding one side from offering.
      pc.onnegotiationneeded = async () => {
        if (!subscribedRef.current || cancelled) return;
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          const description = pc.localDescription;
          if (description) {
            send({
              from: userId,
              to: peerId,
              kind: "offer",
              sdp: { type: description.type, sdp: description.sdp },
            });
          }
        } catch (error) {
          console.warn("[rtc] negotiation failed", error);
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        // Loud on purpose: this is the single most useful line when someone
        // reports "I can't see my friend". Check it in the browser console.
        console.info(`[rtc] ${peerId.slice(0, 8)} -> ${pc.connectionState}`);
        if (pc.connectionState === "failed") {
          // Try to recover, but give up rather than retrying forever — a peer
          // whose browser is gone would otherwise keep a frozen tile on screen
          // indefinitely. Presence heartbeats remove them regardless; this
          // stops us burning ICE restarts on a connection nobody is on.
          if (peer.iceRestarts < 2) {
            peer.iceRestarts += 1;
            try {
              pc.restartIce();
            } catch {
              /* ignore */
            }
          } else {
            setFailedPeers((prev) => {
              if (prev.has(peerId)) return prev;
              const next = new Set(prev);
              next.add(peerId);
              return next;
            });
            dropPeer(peerId);
          }
        }
        if (pc.connectionState === "connected") {
          peer.iceRestarts = 0;
          setFailedPeers((prev) => {
            if (!prev.has(peerId)) return prev;
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        }
        if (pc.connectionState === "closed") dropPeer(peerId);
      };

      pc.oniceconnectionstatechange = () => {
        // "checking" that never reaches "connected" means the candidates never
        // paired up — that is the symptom a TURN server exists to solve.
        if (pc.iceConnectionState === "failed") {
          console.warn(
            `[rtc] ICE failed for ${peerId.slice(0, 8)} — likely needs a TURN server for this network`,
          );
        }
      };

      return peer;
    };

    // Creating transceivers can fire negotiationneeded before the Realtime
    // channel has subscribed. Explicitly offer once signalling is ready so the
    // first (lost) event cannot leave the pair permanently disconnected.
    const negotiate = async (peerId: string) => {
      const peer = getPeer(peerId);
      const { pc } = peer;
      if (!subscribedRef.current || peer.makingOffer || pc.signalingState !== "stable") return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        const description = pc.localDescription;
        if (description) {
          send({
            from: userId,
            to: peerId,
            kind: "offer",
            sdp: { type: description.type, sdp: description.sdp },
          });
        }
      } catch (error) {
        console.warn("[rtc] offer failed", error);
      } finally {
        peer.makingOffer = false;
      }
    };

    const flushIce = async (peerId: string, pc: RTCPeerConnection) => {
      const queued = pendingIceRef.current.get(peerId) ?? [];
      pendingIceRef.current.delete(peerId);
      for (const c of queued) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* ignore */
        }
      }
    };

    const channel = supabase.channel(`rtc:${roomId}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    let retryTimer: number | null = null;

    // Say hello, then make sure every peer we know about has a connection under
    // way. Safe to call repeatedly: negotiate() no-ops unless the peer is idle.
    const announce = () => {
      if (!subscribedRef.current || cancelled) return;
      channelRef.current?.send({ type: "broadcast", event: "hello", payload: { from: userId } });
      const targets = new Set([...peerIdsRef.current, ...knownPeersRef.current]);
      targets.forEach((id) => {
        if (id === userId) return;
        const peer = peersRef.current.get(id);
        // Already connected or mid-handshake — leave it alone.
        if (peer && (peer.pc.connectionState === "connected" || peer.makingOffer)) return;
        // Only the impolite side kicks off a fresh connection, so a brand-new
        // pair does not trade simultaneous opening offers. Renegotiation after
        // that point is symmetric (see onnegotiationneeded).
        if (userId < id) void negotiate(id);
      });
    };

    channel
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as SignalPayload;
        if (!msg || msg.to !== userId || msg.from === userId || cancelled) return;
        knownPeersRef.current.add(msg.from);
        const peer = getPeer(msg.from);
        const { pc } = peer;

        try {
          if (msg.kind === "offer" && msg.sdp) {
            // Standard perfect-negotiation collision handling.
            const offerCollision = peer.makingOffer || pc.signalingState !== "stable";
            peer.ignoreOffer = !peer.polite && offerCollision;
            if (peer.ignoreOffer) {
              // The polite side is now waiting on an answer that will never
              // come, and nothing else retries this pair — which is why in a
              // three-way room one link would settle and another would not.
              // Re-offer once we are idle so the connection completes.
              void (async () => {
                for (let i = 0; i < 20 && !cancelled; i++) {
                  await new Promise((r) => setTimeout(r, 250));
                  if (pc.signalingState === "stable" && !peer.makingOffer) {
                    void negotiate(msg.from);
                    return;
                  }
                }
              })();
              return;
            }

            await pc.setRemoteDescription(msg.sdp);
            await flushIce(msg.from, pc);
            await pc.setLocalDescription();
            const description = pc.localDescription;
            if (description) {
              send({
                from: userId,
                to: msg.from,
                kind: "answer",
                sdp: { type: description.type, sdp: description.sdp },
              });
            }
          } else if (msg.kind === "answer" && msg.sdp) {
            if (pc.signalingState !== "have-local-offer") return;
            await pc.setRemoteDescription(msg.sdp);
            await flushIce(msg.from, pc);
          } else if (msg.kind === "ice" && msg.candidate) {
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(msg.candidate);
              } catch {
                if (!peer.ignoreOffer) {
                  /* genuinely bad candidate — ignore */
                }
              }
            } else {
              const q = pendingIceRef.current.get(msg.from) ?? [];
              q.push(msg.candidate);
              pendingIceRef.current.set(msg.from, q);
            }
          }
        } catch (error) {
          console.warn("[rtc] signalling error", error);
        }
      })
      // Someone announced themselves: the lower id starts the offer, the higher
      // id answers the announcement so the lower id learns about it too.
      //
      // Both sides reply regardless of ordering. A single unanswered hello used
      // to leave a pair permanently disconnected when one browser subscribed
      // after the other had already announced.
      .on("broadcast", { event: "hello" }, ({ payload }) => {
        const { from, reply } = payload as { from: string; reply?: boolean };
        if (!from || from === userId || cancelled) return;
        knownPeersRef.current.add(from);
        if (userId < from) {
          void negotiate(from);
        } else if (!reply) {
          // Answer so they learn we exist, but don't bounce replies forever.
          channelRef.current?.send({
            type: "broadcast",
            event: "hello",
            payload: { from: userId, reply: true },
          });
        }
      })
      // Someone left: tear their connection down immediately rather than
      // waiting for presence to notice.
      .on("broadcast", { event: "bye" }, ({ payload }) => {
        const { from } = payload as { from: string };
        if (!from || cancelled) return;
        dropPeer(from);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          setChannel(channel);
          announce();
          // Keep announcing while anyone is still unconnected. A fixed 20s
          // window meant that if the other person joined a private session
          // after it expired, nobody was left offering and both sides sat on
          // "Connecting..." forever. Stop only once every known peer is up.
          retryTimer = window.setInterval(() => {
            if (cancelled) {
              if (retryTimer) window.clearInterval(retryTimer);
              retryTimer = null;
              return;
            }
            const targets = new Set([...peerIdsRef.current, ...knownPeersRef.current]);
            targets.delete(userId);
            const pending = [...targets].some(
              (id) => peersRef.current.get(id)?.pc.connectionState !== "connected",
            );
            if (!pending && targets.size > 0) return; // everyone is up; idle
            announce();
          }, 2500);
        }
      });

    helloRef.current = announce;

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      if (retryTimer) window.clearInterval(retryTimer);
      // Tell the room we're going before the socket drops, so nobody is left
      // rendering a tile for a browser that has closed.
      void channel.send({ type: "broadcast", event: "bye", payload: { from: userId } });
      knownPeersRef.current.clear();
      peersRef.current.forEach((p) => p.pc.close());
      peersRef.current.clear();
      pendingIceRef.current.clear();
      setRemoteStreams({});
      setChannel(null);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, userId]);

  // Keep the mesh in sync with who is present.
  useEffect(() => {
    if (!userId) return;
    peerIdsRef.current = peerIds;
    const present = new Set(peerIds);
    peersRef.current.forEach((peer, id) => {
      // Only drop peers presence has actually retired. Peers we learned about
      // over the RTC channel may not have appeared in presence yet.
      if (!present.has(id) && !knownPeersRef.current.has(id)) {
        peer.pc.close();
        peersRef.current.delete(id);
        setRemoteStreams((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    });
    if (peerIds.length) helloRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds.join(","), userId]);

  // Swap our camera/mic tracks onto every peer.
  //
  // Joining with the camera off creates the transceivers from the *string*
  // kind, so they carry no track and the browser may settle them on a
  // recvonly/inactive direction. replaceTrack alone then puts a live track on a
  // sender the remote side was never told to expect, and the far end renders a
  // black tile forever. Pin the direction back to sendrecv; replaceTrack on a
  // sender that had no track fires negotiationneeded by itself, and either side
  // may now act on it.
  useEffect(() => {
    const sync = () => {
      const video = localStreamRef.current?.getVideoTracks()[0] ?? null;
      const audio = localStreamRef.current?.getAudioTracks()[0] ?? null;

      peersRef.current.forEach((peer) => {
        for (const tx of [peer.videoTransceiver, peer.audioTransceiver]) {
          if (tx.direction !== "sendrecv") {
            try {
              tx.direction = "sendrecv";
            } catch {
              /* transceiver already stopped */
            }
          }
        }
        if (peer.videoSender.track !== video) {
          void peer.videoSender.replaceTrack(video).catch(() => {});
        }
        if (peer.audioSender.track !== audio) {
          void peer.audioSender.replaceTrack(audio).catch(() => {});
        }
      });
    };
    syncTracksRef.current = sync;
    sync();
  }, [localStream]);

  // A peer that connects after our camera is already running still needs our
  // tracks attached to it, and replaceTrack is a no-op if it happened before
  // the connection existed. Re-apply on every peer-set change.
  useEffect(() => {
    syncTracksRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds.join(","), remoteStreams]);

  return { remoteStreams, channel, failedPeers };
}
