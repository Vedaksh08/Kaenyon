-- Give every subject its starting set of classrooms.
--
-- src/lib/classrooms.functions.ts tops rooms up at runtime, but that needs the
-- service_role key and only fires when someone opens a subject page. Without a
-- baseline, a brand-new database shows every subject as having no rooms to join.
--
-- Derived from public.subjects rather than dumped as literal rows, so it stays
-- correct no matter which subjects exist. Matches OPEN_TARGET = 3 and
-- DEFAULT_CAPACITY = 30 in classrooms.functions.ts.

INSERT INTO public.classrooms (subject_slug, room_number, capacity, status)
SELECT s.slug, n, 30, 'open'
FROM public.subjects s
CROSS JOIN generate_series(1, 3) AS n
ON CONFLICT (subject_slug, room_number) DO NOTHING;
