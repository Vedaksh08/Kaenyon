-- Put the rest of the live tables on the realtime publication.
--
-- Only public.doubts was ever added, so every other subscription in the app
-- silently received nothing: the subject page listens to user_presence to keep
-- classroom counts current, and the room reads answers to show when someone has
-- offered help. Both looked broken — numbers only moved when the page was
-- reloaded.
--
-- REPLICA IDENTITY FULL is required for DELETE events to carry the old row;
-- without it the payload is just the primary key, so filters like
-- `classroom_id=eq.x` never match and a removal is never delivered.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_presence', 'answers', 'classrooms', 'session_ratings']
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;  -- already published
    END;
  END LOOP;
END $$;
