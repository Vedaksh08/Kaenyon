-- Cap classrooms at what peer-to-peer video can actually carry.
--
-- Rooms allowed 30, but every participant opens a direct connection to every
-- other participant. At 20 people that is 19 uploads each — roughly 4.8 Mbps
-- out of a home connection — and 190 connections across the room. Browsers
-- start refusing and dropping connections well before that, which is why a
-- large room degraded into "some people see some others, nobody sees everyone,
-- and people randomly disappear".
--
-- 6 is the honest limit for a mesh. Raise this again once the SFU migration
-- lands, since an SFU sends one upload regardless of room size.
UPDATE public.classrooms SET capacity = 6 WHERE capacity > 6;

-- More rooms per subject, so capping the size does not mean fewer seats.
INSERT INTO public.classrooms (subject_slug, room_number, capacity, status)
SELECT s.slug, n, 6, 'open'
FROM public.subjects s
CROSS JOIN generate_series(1, 6) AS n
ON CONFLICT (subject_slug, room_number) DO NOTHING;
