import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import type { ClassroomVideo, LiveStatus, Peer } from "@/lib/classroom-video";

/**
 * One LiveKit room.
 *
 * LiveKit is an SFU: each browser sends a single upload to the server, which
 * forwards it to everyone. That is what makes 30 participants possible — the
 * peer-to-peer mesh this replaces needed one upload per person, so a 20-person
 * room asked ~5 Mbps of every laptop and collapsed.
 *
 * Media is rendered by us into ordinary <video> elements, so there is no
 * iframe. That also sidesteps what killed the Jitsi attempt: public instances
 * either demand a login or forbid embedding with frame-ancestors.
 */
export function useLiveKit(opts: {
  token: string | null;
  url: string | null;
  /** Students join muted; a class where 30 mics open at once is unusable. */
  startMuted: boolean;
  onDisconnected: () => void;
}): ClassroomVideo {
  const { token, url, startMuted, onDisconnected } = opts;

  const roomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [micMuted, setMicMuted] = useState(startMuted);
  const [camMuted, setCamMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);
  const [handsRaised, setHandsRaised] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token || !url) return;

    let disposed = false;
    const room = new Room({
      // Send a layer that suits each viewer's tile rather than full resolution
      // to everyone — the setting that keeps a 30-tile grid affordable.
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 24 } },
      publishDefaults: { simulcast: true },
    });
    roomRef.current = room;

    /** Rebuild the participant list from the room's own state. */
    const sync = () => {
      if (disposed) return;
      const next: Peer[] = [];
      room.remoteParticipants.forEach((p: RemoteParticipant) => {
        const cam = p.getTrackPublication(Track.Source.Camera);
        const screen = p.getTrackPublication(Track.Source.ScreenShare);
        const mic = p.getTrackPublication(Track.Source.Microphone);
        const pub = screen?.track ? screen : cam;
        next.push({
          identity: p.identity,
          name: p.name?.trim() || "Student",
          video: pub?.track?.mediaStreamTrack,
          audio: mic?.track?.mediaStreamTrack,
          isScreenShare: Boolean(screen?.track),
          speaking: p.isSpeaking,
          micMuted: mic ? mic.isMuted : true,
        });
      });
      setPeers(next);
    };

    room
      .on(RoomEvent.Connected, () => {
        if (disposed) return;
        setStatus("connected");
        sync();
      })
      .on(RoomEvent.Reconnecting, () => !disposed && setStatus("reconnecting"))
      .on(RoomEvent.Reconnected, () => {
        if (disposed) return;
        setStatus("connected");
        sync();
      })
      .on(RoomEvent.Disconnected, () => {
        if (!disposed) onDisconnectedRef.current();
      })
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        // Detach so the element does not hold a dead track.
        track.detach();
        sync();
      })
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.LocalTrackPublished, () => {
        if (disposed) return;
        setLocalVideo(
          room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack ??
            null,
        );
      })
      // Raise-hand rides on a data message rather than a separate channel.
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        if (disposed || !participant) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as {
            type?: string;
            raised?: boolean;
          };
          if (msg.type !== "hand") return;
          setHandsRaised((prev) => {
            const next = new Set(prev);
            if (msg.raised) next.add(participant.identity);
            else next.delete(participant.identity);
            return next;
          });
        } catch {
          /* not ours */
        }
      });

    void (async () => {
      try {
        await room.connect(url, token);
        if (disposed) {
          await room.disconnect();
          return;
        }
        // Camera on, mic per role. Errors here are usually a denied permission.
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(!startMuted);
        if (disposed) return;
        setLocalVideo(
          room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack ??
            null,
        );
        sync();
      } catch (e) {
        if (disposed) return;
        console.error("[livekit] connect failed", e);
        const msg = e instanceof Error ? e.message : "Could not join the classroom.";
        setError(
          /permission|notallowed/i.test(msg)
            ? "Camera or microphone permission was denied. Allow it in your browser and try again."
            : msg,
        );
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      // Stops the camera and leaves the room; without it the tab keeps
      // publishing after navigating away.
      void room.disconnect();
      roomRef.current = null;
    };
  }, [token, url, startMuted]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicMuted(!next);
  }, []);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setCamMuted(!next);
    setLocalVideo(
      next
        ? (room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
            ?.mediaStreamTrack ?? null)
        : null,
    );
  }, []);

  const toggleShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isScreenShareEnabled;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setSharing(next);
    } catch {
      /* the picker was dismissed */
    }
  }, []);

  const [handRaised, setHandRaised] = useState(false);
  const toggleHand = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const raised = !handRaised;
    setHandRaised(raised);
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "hand", raised })),
      { reliable: true },
    );
  }, [handRaised]);

  const leave = useCallback(async () => {
    await roomRef.current?.disconnect();
  }, []);

  /** Teacher-only: LiveKit rejects it without roomAdmin on the token. */
  const muteEveryone = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) {
      const mic = p.getTrackPublication(Track.Source.Microphone);
      if (mic && !mic.isMuted) await mic.setEnabled(false);
    }
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
