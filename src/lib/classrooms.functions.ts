import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Keeps exactly OPEN_TARGET joinable (non-full) classrooms available for a
 * subject at all times. When rooms fill up, new ones are created automatically.
 */
const OPEN_TARGET = 3;
// Peer-to-peer video is a full mesh: everyone connects directly to everyone
// else, so cost grows quadratically. At 20 people each browser holds 19
// connections and uploads ~4.8 Mbps, which home wifi cannot sustain — rooms
// degraded into "some see some, nobody sees everyone". Six is what a mesh
// actually carries. Raise this when the SFU migration lands.
const DEFAULT_CAPACITY = 6;
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

export const ensureOpenClassrooms = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ subject: z.string().min(1).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: subject } = await supabaseAdmin
      .from("subjects")
      .select("slug")
      .eq("slug", data.subject)
      .maybeSingle();
    if (!subject) return { created: 0, open: 0 };

    const { data: rooms } = await supabaseAdmin
      .from("classrooms")
      .select("id, room_number, capacity")
      .eq("subject_slug", data.subject);

    const list = rooms ?? [];
    const ids = list.map((r) => r.id);

    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: presence } = await supabaseAdmin
        .from("user_presence")
        .select("classroom_id")
        .in("classroom_id", ids)
        .gt("last_seen", new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString());
      counts = (presence ?? []).reduce<Record<string, number>>((acc, p) => {
        if (p.classroom_id) acc[p.classroom_id] = (acc[p.classroom_id] ?? 0) + 1;
        return acc;
      }, {});
    }

    const open = list.filter((r) => (counts[r.id] ?? 0) < r.capacity).length;
    const missing = OPEN_TARGET - open;
    if (missing <= 0) return { created: 0, open };

    let next = list.reduce((max, r) => Math.max(max, r.room_number), 0);
    const inserts = Array.from({ length: missing }, () => ({
      subject_slug: data.subject,
      room_number: ++next,
      capacity: DEFAULT_CAPACITY,
      status: "open",
    }));

    const { error } = await supabaseAdmin.from("classrooms").insert(inserts);
    if (error) throw error;

    return { created: inserts.length, open: open + inserts.length };
  });
