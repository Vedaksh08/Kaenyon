/**
 * The contract a classroom video backend has to satisfy.
 *
 * Pathwaay can talk to two SFUs: LiveKit Cloud (`use-livekit.ts`) and our own
 * mediasoup server (`use-pathwaay-sfu.ts`). The classroom page renders against
 * this interface and never learns which one it got, so switching is one env
 * var on the server rather than a rewrite of the page.
 */

export interface Peer {
  /** Supabase user id where known, so tiles line up with doubts and presence. */
  identity: string;
  name: string;
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
  isScreenShare?: boolean;
  speaking: boolean;
  micMuted: boolean;
}

export type LiveStatus = "connecting" | "connected" | "reconnecting" | "error";

export interface ClassroomVideo {
  status: LiveStatus;
  error: string | null;
  peers: Peer[];
  micMuted: boolean;
  camMuted: boolean;
  sharing: boolean;
  localVideo: MediaStreamTrack | null;
  handRaised: boolean;
  /** Identities with a raised hand. */
  handsRaised: Set<string>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleShare: () => Promise<void>;
  toggleHand: () => Promise<void>;
  muteEveryone: () => Promise<void>;
  leave: () => Promise<void>;
}

/**
 * Camera encodings for a 30-person room.
 *
 * Simulcast is what makes the grid survivable. An SFU fixes the upload side —
 * one stream out per browser instead of one per peer — but without simulcast
 * every viewer still downloads 29 full-resolution streams. With three layers
 * the SFU picks a cheap one per viewer, and drops layers by itself when a
 * viewer's downlink is congested.
 */
export const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: "r0", maxBitrate: 120_000, scaleResolutionDownBy: 4 },
  { rid: "r1", maxBitrate: 350_000, scaleResolutionDownBy: 2 },
  { rid: "r2", maxBitrate: 900_000, scaleResolutionDownBy: 1 },
];

/** Modest capture settings; 30 tiles are small on screen anyway. */
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24 },
};
