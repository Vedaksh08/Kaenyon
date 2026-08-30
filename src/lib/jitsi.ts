/**
 * Jitsi Meet configuration and room-name derivation.
 *
 * Everything that would change when moving from the public meet.jit.si to a
 * self-hosted server lives here, so the migration is an env var rather than a
 * code change.
 */

/** Minimal shape of the External API we actually use. */
export interface JitsiApi {
  executeCommand(command: string, ...args: unknown[]): void;
  addListener(event: string, handler: (payload: never) => void): void;
  removeListener(event: string, handler: (payload: never) => void): void;
  getParticipantsInfo(): Array<{ participantId: string; displayName?: string }>;
  isAudioMuted(): Promise<boolean>;
  isVideoMuted(): Promise<boolean>;
  dispose(): void;
}

type JitsiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiConstructor;
  }
}

/**
 * Swap this for your own server and nothing else has to change:
 *   VITE_JITSI_DOMAIN="video.pathwaay.com"
 */
export const JITSI_DOMAIN = (import.meta.env.VITE_JITSI_DOMAIN as string) || "meet.jit.si";

/** True while we are on Jitsi's shared public instance. */
export const IS_PUBLIC_JITSI = JITSI_DOMAIN === "meet.jit.si";

/**
 * Salt for the room-name hash.
 *
 * This is NOT a secret — anything with a VITE_ prefix ships in the browser
 * bundle. Its only job is to make room names unguessable to someone who has
 * seen a classroom UUID but not our code, and to keep our internal ids out of a
 * third party's logs. Real access control needs a Jitsi server that validates
 * a JWT; see the note in the classroom route.
 */
const ROOM_SALT = (import.meta.env.VITE_JITSI_ROOM_SALT as string) || "pathwaay-classroom-v1";

/**
 * Deterministic, unguessable room name for a classroom.
 *
 * Deterministic so everyone in the same classroom lands in the same Jitsi room
 * without coordinating, and hashed so the raw database id is never sent to
 * Jitsi. Users never supply a room name.
 */
export async function roomNameFor(classId: string): Promise<string> {
  const data = new TextEncoder().encode(`${ROOM_SALT}:${classId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // 32 hex chars is 128 bits — far beyond guessing, and short enough to read.
  return `pathwaay${hex.slice(0, 32)}`;
}

let scriptPromise: Promise<void> | null = null;

/**
 * Load external_api.js from the Jitsi server.
 *
 * The script has to come from the same deployment we connect to, so it cannot
 * be bundled — a self-hosted server serves its own copy. Cached in a module
 * promise so mounting the classroom twice does not add a second <script>.
 */
export function loadJitsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const src = `https://${JITSI_DOMAIN}/external_api.js`;
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Jitsi script failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error(`Could not reach ${JITSI_DOMAIN}`));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Interface config: hide Jitsi's own chrome so the classroom reads as part of
 * Pathwaay rather than an embedded third-party app. Our own control bar drives
 * everything through executeCommand().
 */
export const JITSI_INTERFACE_CONFIG = {
  // Our header and controls replace these entirely.
  TOOLBAR_BUTTONS: [],
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  SHOW_POWERED_BY: false,
  JITSI_WATERMARK_LINK: "",
  DEFAULT_BACKGROUND: "#0B1220",
  DISABLE_VIDEO_BACKGROUND: false,
  HIDE_INVITE_MORE_HEADER: true,
  MOBILE_APP_PROMO: false,
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
  // Names under tiles rather than a separate filmstrip label.
  VERTICAL_FILMSTRIP: true,
  FILM_STRIP_MAX_HEIGHT: 120,
  DISABLE_FOCUS_INDICATOR: false,
  TILE_VIEW_MAX_COLUMNS: 5,
} as const;

/**
 * Meeting config tuned for a ~30-person classroom.
 *
 * The defaults assume a small call. At 30 participants the two settings that
 * matter are channelLastN (how many remote videos are actually received) and a
 * capped resolution — without them every browser downloads 29 streams and
 * stalls, which is exactly the failure the peer-to-peer mesh had.
 */
export function jitsiConfigOverwrite(opts: { startMuted: boolean }) {
  return {
    prejoinPageEnabled: false,
    // Jitsi ships telemetry to Amplitude and avatars from Gravatar. Brave,
    // uBlock and most school networks block both, and every blocked request
    // surfaced as an error event. Turning them off removes the noise entirely
    // and keeps student data out of a third party we do not need.
    analytics: { disabled: true, rtcstatsEnabled: false },
    disableThirdPartyRequests: true,
    startWithAudioMuted: opts.startMuted,
    startWithVideoMuted: false,
    disableDeepLinking: true,
    // Only decode the most recent speakers' video. Everyone else falls back to
    // an avatar until they speak, which is what keeps 30 people viable.
    channelLastN: 12,
    // 360p is plenty for a tile and roughly a third the bandwidth of 720p.
    resolution: 360,
    constraints: {
      video: {
        height: { ideal: 360, max: 480, min: 180 },
      },
    },
    // Simulcast lets the server forward a lower layer to whoever needs it.
    disableSimulcast: false,
    startAudioOnly: false,
    enableNoisyMicDetection: true,
    // The name comes from the signed-in Pathwaay profile; asking again is noise.
    requireDisplayName: false,
    disableProfile: true,
    disableInviteFunctions: true,
    doNotStoreRoom: true,
    // We render our own notifications through sonner.
    notifications: [
      "notify.chatMessages",
      "notify.raisedHand",
      "notify.kickParticipant",
      "notify.moderationInEffectTitle",
    ],
  };
}
