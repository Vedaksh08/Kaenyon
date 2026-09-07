import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Checks whether this student may enter this classroom, and returns what the
 * page needs to render around the video.
 *
 * Video itself is Cloudflare Realtime, opened separately by
 * cloudflare-realtime.functions.ts. This call exists because the header and
 * the mute rules need the room title, capacity and the caller's role before
 * any media starts.
 *
 * Authorisation is decided on the server rather than in the page: whatever the
 * UI believes, the media layer will only ever hand out a session to somebody
 * who passed this check.
 */
export const authorizeClassroom = createServerFn({ method: "POST" })
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
    if (!process.env.CF_REALTIME_APP_ID || !process.env.CF_REALTIME_APP_TOKEN) {
      throw new Error(
        "Classroom video is not configured. Set CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN — see CLOUDFLARE-SFU.md.",
      );
    }

    const { authorizeClassroomAccess } = await import("@/lib/classroom-access");
    const access = await authorizeClassroomAccess(data.accessToken, data.classId);

    return {
      isModerator: access.isModerator,
      title: access.title,
      capacity: access.capacity,
      identity: access.userId,
      name: access.displayName,
    };
  });
