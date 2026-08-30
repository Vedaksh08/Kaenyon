-- Restore 30-seat classrooms now that video runs through Jitsi.
--
-- Capacity was dropped to 6 because peer-to-peer video made every participant
-- connect directly to every other one, so a large room collapsed. Jitsi routes
-- through an SFU — one upload per browser regardless of how many people are in
-- the room — so the original 30 is viable again.
UPDATE public.classrooms SET capacity = 30 WHERE capacity < 30;
