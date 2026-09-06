import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-side proxy for the Cloudflare Realtime SFU.
 *
 * Cloudflare's API is authenticated with an app token that carries no notion of
 * rooms or users: anyone holding it can create sessions and pull any track in
 * the app. So it never reaches the browser — every call goes through here, and
 * the page only ever sees session ids and SDP.
 *
 * Cloudflare forwards media and nothing else. There is no room, no membership,
 * no participant list. Pathwaay supplies all of that from Supabase Realtime
 * presence, exactly as it does for our own mediasoup SFU.
 */

const API_ROOT = "https://rtc.live.cloudflare.com/v1/apps";

/**
 * A signed note saying "this user was cleared for this classroom and owns this
 * Cloudflare session".
 *
 * Publishing a class involves a dozen or so calls per student, and re-running
 * the whole Supabase authorisation on each would add a round trip every time
 * somebody's camera appears. The check runs once, when the session is created,
 * and the result is signed so later calls can be verified locally.
 */
function ticketSecret(): string {
  const secret = process.env.CLASSROOM_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No server secret available to sign classroom tickets.");
  return secret;
}

interface Ticket {
  userId: string;
  classId: string;
  sessionId: string;
  isModerator: boolean;
  /** Epoch ms. */
  exp: number;
}

async function signTicket(payload: Ticket): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", ticketSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

async function readTicket(ticket: string): Promise<Ticket> {
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const [body, mac] = ticket.split(".");
  if (!body || !mac) throw new Error("Malformed classroom ticket.");

  const expected = createHmac("sha256", ticketSecret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid classroom ticket.");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
  if (payload.exp < Date.now()) throw new Error("Your classroom session expired. Rejoin.");
  return payload;
}

function credentials() {
  const appId = process.env.CF_REALTIME_APP_ID;
  const appToken = process.env.CF_REALTIME_APP_TOKEN;
  if (!appId || !appToken) {
    throw new Error(
      "Cloudflare Realtime is not configured. Set CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN — see SFU-DEPLOY.md.",
    );
  }
  return { appId, appToken };
}

async function callCloudflare(path: string, method: "POST" | "PUT", body?: unknown) {
  const { appId, appToken } = credentials();
  const res = await fetch(`${API_ROOT}/${appId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${appToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const json = (await res.json()) as { errorCode?: string; errorDescription?: string };
  if (!res.ok || json.errorCode) {
    throw new Error(json.errorDescription || `Cloudflare Realtime returned ${res.status}.`);
  }
  return json;
}

/** A track as the browser describes it to us. */
const trackSchema = z.object({
  location: z.enum(["local", "remote"]),
  mid: z.string().optional(),
  trackName: z.string(),
  sessionId: z.string().optional(),
  simulcast: z.object({ preferredRid: z.string() }).optional(),
});

/**
 * Opens a Cloudflare session for one student, after checking they belong in
 * this classroom. This is the only entry point that touches Supabase.
 */
export const openRealtimeSession = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        classId: z.string().uuid(),
        accessToken: z.string().min(10),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Identify the caller from their JWT rather than trusting a body field.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(data.accessToken);
    const user = userData?.user;
    if (userErr || !user) throw new Error("Not signed in.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name, suspended_until, onboarded_at, course_slug, year")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.suspended_until && new Date(profile.suspended_until).getTime() > Date.now()) {
      throw new Error("Your account is suspended.");
    }
    if (!profile?.onboarded_at) throw new Error("Finish setting up your profile first.");

    const { data: classroom } = await supabaseAdmin
      .from("classrooms")
      .select("id, subject_slug")
      .eq("id", data.classId)
      .maybeSingle();
    if (!classroom) throw new Error("That classroom does not exist.");

    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "moderator" }),
    ]);
    const isModerator = Boolean(isAdmin || isMod);

    if (!isModerator) {
      const year = Math.max(1, parseInt(profile.year ?? "1", 10) || 1);
      const { data: allowed } = profile.course_slug
        ? await supabaseAdmin.rpc("get_course_subjects", {
            _course_slug: profile.course_slug,
            _year: year,
          })
        : { data: null };
      const canJoin = (allowed ?? []).some(
        (s: { slug: string }) => s.slug === classroom.subject_slug,
      );
      if (!canJoin) throw new Error("This classroom is not on your course.");
    }

    const session = (await callCloudflare("/sessions/new", "POST")) as { sessionId: string };

    return {
      sessionId: session.sessionId,
      ticket: await signTicket({
        userId: user.id,
        classId: classroom.id,
        sessionId: session.sessionId,
        isModerator,
        // A class runs well under this; the browser rejoins if it lapses.
        exp: Date.now() + 4 * 60 * 60 * 1000,
      }),
    };
  });

/**
 * Publishes this student's own tracks. The browser has already built the offer;
 * Cloudflare answers it.
 */
export const pushRealtimeTracks = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        ticket: z.string().min(10),
        sdp: z.string().min(1),
        tracks: z.array(trackSchema).min(1).max(8),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const ticket = await readTicket(data.ticket);
    return (await callCloudflare(`/sessions/${ticket.sessionId}/tracks/new`, "POST", {
      sessionDescription: { sdp: data.sdp, type: "offer" },
      tracks: data.tracks,
    })) as {
      sessionDescription: { sdp: string; type: string };
      tracks: Array<{ mid?: string; trackName: string; errorCode?: string }>;
    };
  });

/**
 * Subscribes to other students' tracks. Cloudflare replies with an offer, which
 * is why pulling always needs a renegotiation afterwards.
 */
export const pullRealtimeTracks = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        ticket: z.string().min(10),
        // One call carries every new track, so a 30-person room does not turn
        // into 30 sequential renegotiations.
        tracks: z.array(trackSchema).min(1).max(64),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const ticket = await readTicket(data.ticket);
    return (await callCloudflare(`/sessions/${ticket.sessionId}/tracks/new`, "POST", {
      tracks: data.tracks,
    })) as {
      requiresImmediateRenegotiation?: boolean;
      sessionDescription?: { sdp: string; type: string };
      tracks: Array<{
        mid?: string;
        trackName: string;
        sessionId?: string;
        errorCode?: string;
        errorDescription?: string;
      }>;
    };
  });

/** Completes the handshake Cloudflare starts when tracks are pulled. */
export const renegotiateRealtime = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ ticket: z.string().min(10), sdp: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const ticket = await readTicket(data.ticket);
    await callCloudflare(`/sessions/${ticket.sessionId}/renegotiate`, "PUT", {
      sessionDescription: { sdp: data.sdp, type: "answer" },
    });
    return { ok: true };
  });
