import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SignalPayload = {
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// STUN alone only works when both peers can be reached directly. On mobile
// data, university wifi, or any symmetric NAT the candidates never pair and the
// tile stays black — a TURN relay is the only fix.
//
// These are openrelay's free public servers: fine for getting started, but they
// are rate-limited and not something to launch on. Swap in a paid TURN provider
// (Twilio, Cloudflare Calls, Metered) or self-hosted coturn before real use.
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 4,
};

type Peer = {
  pc: RTCPeerConnection;
  videoSender: RTCRtpSender;
  audioSender: RTCRtpSender;
  videoTransceiver: RTCRtpTransceiver;
  audioTransceiver: RTCRtpTransceiver;
  polite: boolean;
  makingOffer: boolean;
  stream: MediaStream;
};

/**
 * Full-mesh WebRTC between everyone in a classroom, signalled over a Supabase
 * Realtime broadcast channel. Returns peerId -> MediaStream so each tile can
 * render that person's live camera.
 *
 * Transceivers are created up-front (video then audio) so the m-line order is
 * identical on both sides and turning the camera on later is just a
 * replaceTrack — no fragile renegotiation.
 */
export function useWebrtcMesh(opts: {
  roomId: string;
  userId: string | null;
  peerIds: string[];
  localStream: MediaStream | null;
}) {
  const { roomId, userId, peerIds, localStream } = opts;
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const helloRef = useRef<() => void>(() => {});
  const subscribedRef = useRef(false);
  const peerIdsRef = useRef<string[]>([]);
  const negotiateRef = useRef<(peerId: string) => void>(() => {});
  // Peers heard over the RTC channel itself. Presence and this channel settle
  // independently, so we cannot rely on peerIds alone to know who is here.
  const knownPeersRef = useRef<Set<string>>(new Set());

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
        peer.pc.close();
      }
      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);
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
      const videoTx = pc.addTransceiver(local?.getVideoTracks()[0] ?? "video", {
        direction: "sendrecv",
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
        polite: userId > peerId,
        makingOffer: false,
        stream,
      };
      peersRef.current.set(peerId, peer);

      pc.ontrack = (ev) => {
        const track = ev.track;
        if (!stream.getTracks().includes(track)) stream.addTrack(track);
        track.onunmute = () => setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate)
          send({ from: userId, to: peerId, kind: "ice", candidate: ev.candidate.toJSON() });
      };

      pc.onnegotiationneeded = async () => {
        // The lower session id is the only offerer. The other peer only
        // answers, preventing addTransceiver from creating offer glare while
        // an incoming offer is being applied.
        if (
          !subscribedRef.current ||
          userId > peerId ||
          peer.makingOffer ||
          pc.signalingState !== "stable"
        )
          return;
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription(await pc.createOffer());
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
          console.warn("WebRTC negotiation failed", error);
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        // Loud on purpose: this is the single most useful line when someone
        // reports "I can't see my friend". Check it in the browser console.
        console.info(`[rtc] ${peerId.slice(0, 8)} -> ${pc.connectionState}`);
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* ignore */
          }
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
        await pc.setLocalDescription(await pc.createOffer());
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
        console.warn("WebRTC offer failed", error);
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

    // Say hello, then offer to everyone we should be offering to. Safe to call
    // repeatedly: negotiate() no-ops unless the connection is idle.
    const announce = () => {
      if (!subscribedRef.current || cancelled) return;
      channelRef.current?.send({ type: "broadcast", event: "hello", payload: { from: userId } });
      const targets = new Set([...peerIdsRef.current, ...knownPeersRef.current]);
      targets.forEach((id) => {
        if (id === userId || !(userId < id)) return;
        const peer = peersRef.current.get(id);
        // Already connected or mid-handshake — leave it alone.
        if (peer && (peer.pc.connectionState === "connected" || peer.makingOffer)) return;
        void negotiateRef.current(id);
      });
    };

    channel
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as SignalPayload;
        if (!msg || msg.to !== userId || msg.from === userId || cancelled) return;
        const peer = getPeer(msg.from);
        const { pc } = peer;

        try {
          if (msg.kind === "offer" && msg.sdp) {
            const collision = peer.makingOffer || pc.signalingState !== "stable";
            if (collision && !peer.polite) return; // impolite side ignores
            if (collision)
              await pc.setLocalDescription({ type: "rollback" } as RTCLocalSessionDescriptionInit);
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
                /* ignore */
              }
            } else {
              const q = pendingIceRef.current.get(msg.from) ?? [];
              q.push(msg.candidate);
              pendingIceRef.current.set(msg.from, q);
            }
          }
        } catch {
          /* ignore malformed signalling */
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribedRef.current = true;
          announce();
          // Re-announce for a while: presence and the RTC channel come up
          // independently, so a peer may not have been listening yet.
          let ticks = 0;
          retryTimer = window.setInterval(() => {
            if (cancelled || ++ticks > 10) {
              if (retryTimer) window.clearInterval(retryTimer);
              retryTimer = null;
              return;
            }
            announce();
          }, 2000);
        }
      });

    negotiateRef.current = (peerId: string) => void negotiate(peerId);
    helloRef.current = announce;

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      if (retryTimer) window.clearInterval(retryTimer);
      knownPeersRef.current.clear();
      peersRef.current.forEach((p) => p.pc.close());
      peersRef.current.clear();
      pendingIceRef.current.clear();
      setRemoteStreams({});
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
      if (!present.has(id)) {
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
  // black tile forever. Pin the direction back to sendrecv and re-offer
  // whenever the track identity changes.
  useEffect(() => {
    const video = localStream?.getVideoTracks()[0] ?? null;
    const audio = localStream?.getAudioTracks()[0] ?? null;

    peersRef.current.forEach((peer, peerId) => {
      let changed = false;

      if (peer.videoSender.track !== video) {
        void peer.videoSender.replaceTrack(video).catch(() => {});
        changed = true;
      }
      if (peer.audioSender.track !== audio) {
        void peer.audioSender.replaceTrack(audio).catch(() => {});
        changed = true;
      }

      for (const tx of [peer.videoTransceiver, peer.audioTransceiver]) {
        if (tx.direction !== "sendrecv") {
          try {
            tx.direction = "sendrecv";
            changed = true;
          } catch {
            /* transceiver already stopped */
          }
        }
      }

      // Only the designated offerer re-offers; the other side picks the change
      // up from the offer it receives.
      if (changed && peer.pc.signalingState === "stable") negotiateRef.current(peerId);
    });
  }, [localStream]);

  return remoteStreams;
}
