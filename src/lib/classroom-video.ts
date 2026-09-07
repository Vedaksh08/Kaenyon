/**
 * The shape the classroom page renders against.
 *
 * Video is Cloudflare Realtime, driven by `use-cloudflare-realtime.ts`. Keeping
 * the page behind this interface rather than against the hook directly means
 * the grid, controls and tiles carry no knowledge of the media layer.
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
 * the SFU sends each viewer a rung they can afford.
 *
 * The rid names are Cloudflare's convention: full, half, quarter.
 */
export const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: "f", scaleResolutionDownBy: 1, maxBitrate: 900_000 },
  { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 350_000 },
  { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 120_000 },
];

/** Modest capture settings; 30 tiles are small on screen anyway. */
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24 },
};
