-- Stale presence and abandoned doubts.
--
-- Cleanup ran only in the leaving browser: untrack(), clearPresence() and the
-- doubt withdrawal all fire from an unload handler. Browsers routinely kill
-- async work at that point — and a crash, a lost connection or a killed tab
-- never runs it at all — so rows survived and people stayed visible in rooms
-- they had left, with days-old doubts still listed.
--
-- Treat last_seen as the source of truth instead. The client heartbeats every
-- 45s, so anything older than two minutes is gone.

CREATE OR REPLACE FUNCTION public.presence_cutoff()
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT now() - interval '2 minutes';
$$;

-- Live participants for a classroom, already filtered.
CREATE OR REPLACE FUNCTION public.get_room_presence(_classroom_id uuid)
RETURNS TABLE (user_id uuid, last_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.user_id, p.last_seen
  FROM public.user_presence p
  WHERE p.classroom_id = _classroom_id
    AND p.last_seen > public.presence_cutoff();
$$;

REVOKE ALL ON FUNCTION public.get_room_presence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_room_presence(uuid) TO authenticated;

-- Live counts per subject, so the subject page stops counting ghosts.
CREATE OR REPLACE FUNCTION public.get_classroom_counts(_subject_slug text)
RETURNS TABLE (classroom_id uuid, live bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, count(p.user_id)
  FROM public.classrooms c
  LEFT JOIN public.user_presence p
    ON p.classroom_id = c.id
   AND p.last_seen > public.presence_cutoff()
  WHERE c.subject_slug = _subject_slug
  GROUP BY c.id;
$$;

REVOKE ALL ON FUNCTION public.get_classroom_counts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_classroom_counts(text) TO authenticated;

-- Live counts for every subject at once, for the home screen.
CREATE OR REPLACE FUNCTION public.get_subject_counts()
RETURNS TABLE (subject_slug text, live bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.slug, count(p.user_id)
  FROM public.subjects s
  LEFT JOIN public.user_presence p
    ON p.subject_slug = s.slug
   AND p.last_seen > public.presence_cutoff()
  GROUP BY s.slug;
$$;

REVOKE ALL ON FUNCTION public.get_subject_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subject_counts() TO authenticated;

-- Sweep on read: any client loading a room clears rows the owners never did.
-- Cheap, and it keeps realtime DELETE events flowing to everyone watching.
CREATE OR REPLACE FUNCTION public.sweep_stale_presence()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  stale_users uuid[];
BEGIN
  SELECT array_agg(user_id) INTO stale_users
  FROM public.user_presence
  WHERE last_seen <= public.presence_cutoff();

  IF stale_users IS NULL THEN
    RETURN;
  END IF;

  -- A doubt only makes sense while its author is in the room to be helped.
  DELETE FROM public.doubts WHERE author_id = ANY(stale_users);
  DELETE FROM public.user_presence WHERE user_id = ANY(stale_users);
END $$;

REVOKE ALL ON FUNCTION public.sweep_stale_presence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_presence() TO authenticated;

-- Clear out everything already stranded by the old client-only cleanup,
-- including the days-old doubts still showing in rooms.
DELETE FROM public.doubts
WHERE author_id IN (
  SELECT user_id FROM public.user_presence WHERE last_seen <= public.presence_cutoff()
);
DELETE FROM public.user_presence WHERE last_seen <= public.presence_cutoff();

-- Doubts whose author has no presence row at all are orphans from earlier
-- sessions; they can never be answered.
DELETE FROM public.doubts d
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_presence p
  WHERE p.user_id = d.author_id AND p.classroom_id = d.classroom_id
);
