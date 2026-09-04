import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Decides whether a student may join a classroom, and hands back whatever the
 * chosen video backend needs to connect.
 *
 * Two backends are supported. Setting SFU_URL selects Pathwaay's own mediasoup
 * server; otherwise LiveKit Cloud is used. The choice lives here rather than in
 * the browser so switching is one environment variable, and so the same
 * authorisation runs either way.
 *
 * This has to run on the server: the LiveKit token is signed with
 * LIVEKIT_API_SECRET, and anything reaching the browser is public. The secret
 * has no VITE_ prefix and the SDK is imported inside the handler, so neither
 * can be bundled into the client — the same pattern classrooms.functions.ts
 * uses for the Supabase service role key.
 *
 * Authorisation is decided here rather than in the page, because a token is a
 * capability: once issued, LiveKit honours it regardless of what our UI thinks.
 */
export const createClassroomToken = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        classId: z.string().uuid(),
        // Supabase access token — proves who is asking. Verified below.
        accessToken: z.string().min(10),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    // Pathwaay's own mediasoup SFU takes precedence when it is configured.
    const sfuUrl = process.env.SFU_URL?.trim();
    const useSfu = Boolean(sfuUrl);

    if (!useSfu && (!apiKey || !apiSecret || !url)) {
      throw new Error(
        "No classroom video server is configured. Set SFU_URL for the Pathwaay SFU, or LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET for LiveKit — see SETUP.md.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Identify the caller from their Supabase JWT rather than trusting an id
    // in the request body, which anyone could change.
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
      .select("id, room_number, subject_slug, capacity, subjects(name)")
      .eq("id", data.classId)
      .maybeSingle();
    if (!classroom) throw new Error("That classroom does not exist.");

    // Moderators and admins are the teachers; they may enter any room.
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

    const subjectName = (classroom.subjects as { name: string } | null)?.name ?? "Classroom";
    const displayName = profile.name?.trim() || "Student";

    // Room name is derived from the classroom id, never supplied by the client,
    // so nobody can join a room they were not cleared for by typing an id.
    const roomName = `classroom-${classroom.id}`;

    const common = {
      roomName,
      isModerator,
      title: `${subjectName} · Room ${classroom.room_number}`,
      capacity: classroom.capacity,
      identity: user.id,
      name: displayName,
    };

    if (useSfu) {
      return { mode: "sfu" as const, sfuUrl: sfuUrl!, token: null, url: null, ...common };
    }

    const { AccessToken } = await import("livekit-server-sdk");

    const at = new AccessToken(apiKey!, apiSecret!, {
      identity: user.id,
      name: displayName,
      // Long enough for a full class; LiveKit only checks it when connecting.
      ttl: "4h",
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      // Used for raise-hand, which we send as a data message.
      canPublishData: true,
      // Only teachers can mute others or remove them.
      roomAdmin: isModerator,
    });

    return {
      mode: "livekit" as const,
      sfuUrl: null,
      token: await at.toJwt(),
      url: url!,
      ...common,
    };
  });
