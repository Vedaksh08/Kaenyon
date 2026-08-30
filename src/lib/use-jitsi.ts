import { useCallback, useEffect, useRef, useState } from "react";
import {
  JITSI_DOMAIN,
  JITSI_INTERFACE_CONFIG,
  jitsiConfigOverwrite,
  loadJitsiScript,
  type JitsiApi,
} from "./jitsi";

export interface JitsiParticipant {
  id: string;
  name: string;
}

export type JitsiStatus = "loading" | "joining" | "joined" | "error";

/**
 * Owns one Jitsi meeting: loads the External API, joins the room, mirrors the
 * bits of meeting state our own controls need, and tears everything down on
 * unmount.
 *
 * Jitsi's own toolbar is hidden (see JITSI_INTERFACE_CONFIG) and every action
 * goes through executeCommand, so the classroom keeps Pathwaay's UI while
 * Jitsi handles all the realtime media.
 */
export function useJitsi(opts: {
  /** Derived from the class id — never user-supplied. */
  roomName: string | null;
  displayName: string;
  email?: string;
  /** Teachers join unmuted; students start muted so 30 people is not chaos. */
  isModerator: boolean;
  onLeave: () => void;
}) {
  const { roomName, displayName, email, isModerator, onLeave } = opts;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const [status, setStatus] = useState<JitsiStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);
  const [audioMuted, setAudioMuted] = useState(!isModerator);
  const [videoMuted, setVideoMuted] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  useEffect(() => {
    if (!roomName || !containerRef.current) return;

    let disposed = false;
    let api: JitsiApi | null = null;

    void (async () => {
      try {
        await loadJitsiScript();
        // React 19 strict mode mounts twice in development; without this the
        // second pass would join the room a second time as a ghost participant.
        if (disposed || !containerRef.current) return;

        const Ctor = window.JitsiMeetExternalAPI;
        if (!Ctor) throw new Error("Jitsi External API unavailable");

        setStatus("joining");
        api = new Ctor(JITSI_DOMAIN, {
          roomName,
          parentNode: containerRef.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName, email: email ?? "" },
          configOverwrite: jitsiConfigOverwrite({ startMuted: !isModerator }),
          interfaceConfigOverwrite: JITSI_INTERFACE_CONFIG,
        });
        apiRef.current = api;

        const syncParticipants = () => {
          if (disposed || !api) return;
          try {
            setParticipants(
              api.getParticipantsInfo().map((p) => ({
                id: p.participantId,
                name: p.displayName?.trim() || "Student",
              })),
            );
          } catch {
            /* the meeting is tearing down */
          }
        };

        api.addListener("videoConferenceJoined", (() => {
          if (disposed) return;
          setStatus("joined");
          syncParticipants();
        }) as never);

        api.addListener("participantJoined", syncParticipants as never);
        api.addListener("participantLeft", syncParticipants as never);
        api.addListener("displayNameChange", syncParticipants as never);

        api.addListener("audioMuteStatusChanged", ((e: { muted: boolean }) => {
          if (!disposed) setAudioMuted(e.muted);
        }) as never);

        api.addListener("videoMuteStatusChanged", ((e: { muted: boolean }) => {
          if (!disposed) setVideoMuted(e.muted);
        }) as never);

        api.addListener("screenSharingStatusChanged", ((e: { on: boolean }) => {
          if (!disposed) setSharing(e.on);
        }) as never);

        api.addListener("raiseHandUpdated", ((e: { id: string; handRaised: number }) => {
          // Fired for every participant; only track our own button state.
          if (disposed) return;
          const info = api?.getParticipantsInfo?.() ?? [];
          const isMe = info.length === 0 || e.id === undefined;
          if (isMe) setHandRaised(Boolean(e.handRaised));
        }) as never);

        api.addListener("incomingMessage", (() => {
          // Badge the chat button; the count clears when the panel is opened.
          if (!disposed) setUnreadChat((n) => n + 1);
        }) as never);

        api.addListener("chatUpdated", ((e: { isOpen: boolean }) => {
          if (disposed) return;
          setChatOpen(e.isOpen);
          if (e.isOpen) setUnreadChat(0);
        }) as never);

        // Both the in-meeting hangup and a kick end up here.
        api.addListener("readyToClose", (() => {
          if (!disposed) onLeaveRef.current();
        }) as never);

        api.addListener("errorOccurred", ((e: {
          error?: { isFatal?: boolean; message?: string; name?: string };
        }) => {
          if (disposed) return;
          const err = e?.error;
          // Jitsi raises this for plenty of things the meeting survives — a
          // blocked analytics request, a camera that is already in use, a
          // failed device enumeration. Treating them all as fatal meant an ad
          // blocker swallowing one telemetry POST tore down a working class.
          if (!err?.isFatal) {
            console.warn("[jitsi] non-fatal", err?.name ?? "error", err?.message ?? "");
            return;
          }
          console.error("[jitsi] fatal", err);
          setError(err.message || "The classroom hit an error.");
          setStatus("error");
        }) as never);
      } catch (e) {
        if (disposed) return;
        console.error("[jitsi] failed to start", e);
        setError(
          e instanceof Error
            ? `${e.message}. Check your connection and try again.`
            : "Could not start the classroom.",
        );
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      // dispose() leaves the room, stops the camera and removes the iframe.
      // Skipping it leaves the tab publishing after navigating away.
      try {
        api?.dispose();
      } catch {
        /* already gone */
      }
      apiRef.current = null;
    };
  }, [roomName, displayName, email, isModerator]);

  const command = useCallback((name: string, ...args: unknown[]) => {
    try {
      apiRef.current?.executeCommand(name, ...args);
    } catch (e) {
      console.warn(`[jitsi] command ${name} failed`, e);
    }
  }, []);

  return {
    containerRef,
    status,
    error,
    participants,
    audioMuted,
    videoMuted,
    handRaised,
    sharing,
    chatOpen,
    unreadChat,
    toggleAudio: useCallback(() => command("toggleAudio"), [command]),
    toggleVideo: useCallback(() => command("toggleVideo"), [command]),
    toggleShare: useCallback(() => command("toggleShareScreen"), [command]),
    toggleHand: useCallback(() => command("toggleRaiseHand"), [command]),
    toggleChat: useCallback(() => {
      setUnreadChat(0);
      command("toggleChat");
    }, [command]),
    toggleTileView: useCallback(() => command("toggleTileView"), [command]),
    /** Moderator only — Jitsi ignores it from anyone else. */
    muteEveryone: useCallback(() => command("muteEveryone"), [command]),
    hangup: useCallback(() => command("hangup"), [command]),
  };
}
