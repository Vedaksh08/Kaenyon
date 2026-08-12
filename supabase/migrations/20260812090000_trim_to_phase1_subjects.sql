-- Phase 1 scope: seven CS subjects only.
--
-- The earlier seed carried the full 44-subject catalogue (law, biochemistry,
-- surveying, ...) inherited from the original project. Phase 1 ships CS only,
-- so everything else goes. classrooms.subject_slug is ON DELETE CASCADE, so
-- removing a subject takes its classrooms (and their doubts/answers) with it.
--
-- Also clears user-generated rows so we launch on a clean slate. Profiles are
-- left to auth.users' own cascade — deleting a user in the dashboard removes
-- the profile row.

DELETE FROM public.subjects
WHERE slug NOT IN (
  'computer-science',
  'ai',
  'data-structures',
  'software-engineering',
  'operating-systems',
  'web-development',
  'cyber-security'
);

-- Test/seed activity from pre-launch poking around.
DELETE FROM public.session_ratings;
DELETE FROM public.answers;
DELETE FROM public.doubts;
DELETE FROM public.user_presence;
DELETE FROM public.reports;
DELETE FROM public.moderation_log;
DELETE FROM public.friendships;
DELETE FROM public.blocks;

-- Re-assert the 3-rooms-per-subject baseline for whatever survived.
INSERT INTO public.classrooms (subject_slug, room_number, capacity, status)
SELECT s.slug, n, 30, 'open'
FROM public.subjects s
CROSS JOIN generate_series(1, 3) AS n
ON CONFLICT (subject_slug, room_number) DO NOTHING;
