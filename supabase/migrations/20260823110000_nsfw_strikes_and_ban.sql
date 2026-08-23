-- Server-side camera-moderation strikes and the ban that follows them.
--
-- Strikes cannot live in the browser. The page is the thing being moderated, so
-- a refresh resets an in-memory counter and RLS lets students UPDATE their own
-- profile row — meaning a client-written `suspended_until` could simply be
-- cleared by the person it applies to. Both the tally and the ban are recorded
-- here through SECURITY DEFINER, which is the only path a student cannot edit.

CREATE TABLE IF NOT EXISTS public.moderation_strikes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL,          -- 'nsfw' | 'phone'
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  score        numeric,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_strikes_recent
  ON public.moderation_strikes (user_id, kind, created_at DESC);

-- Readable by moderators only; nobody writes to it directly. The recording
-- function below is SECURITY DEFINER and bypasses these.
GRANT SELECT ON public.moderation_strikes TO authenticated;
GRANT ALL ON public.moderation_strikes TO service_role;
ALTER TABLE public.moderation_strikes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strikes readable by mods" ON public.moderation_strikes;
CREATE POLICY "strikes readable by mods" ON public.moderation_strikes
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'moderator')
  OR public.has_role(auth.uid(), 'admin')
);

-- Record one strike and return where the student now stands.
--
-- Counts only strikes inside the rolling window, so somebody who trips the
-- detector once a week is not banned on their third-ever frame — three within
-- the window is a pattern, three across a term is noise.
--
-- Always acts on auth.uid(), never a passed-in id, so this cannot be used to
-- strike somebody else.
CREATE OR REPLACE FUNCTION public.record_moderation_strike(
  _kind text,
  _classroom_id uuid DEFAULT NULL,
  _score numeric DEFAULT NULL
)
RETURNS TABLE (strike_count int, banned_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me           uuid := auth.uid();
  window_start timestamptz := now() - interval '1 hour';
  strikes      int;
  ban_until    timestamptz;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _kind NOT IN ('nsfw', 'phone') THEN
    RAISE EXCEPTION 'Unknown strike kind: %', _kind;
  END IF;

  INSERT INTO public.moderation_strikes (user_id, kind, classroom_id, score)
  VALUES (me, _kind, _classroom_id, _score);

  SELECT count(*) INTO strikes
  FROM public.moderation_strikes
  WHERE user_id = me AND kind = _kind AND created_at > window_start;

  IF strikes >= 3 THEN
    ban_until := now() + interval '20 minutes';
    -- GREATEST so a fresh 20 minutes never shortens a longer existing ban,
    -- such as the 3-day suspension auto_flag_reported_user applies.
    UPDATE public.profiles
    SET suspended_until = GREATEST(COALESCE(suspended_until, now()), ban_until)
    WHERE id = me;

    SELECT p.suspended_until INTO ban_until FROM public.profiles p WHERE p.id = me;

    INSERT INTO public.moderation_log (actor_id, target_user_id, action, details)
    VALUES (
      me, me, 'auto_ban',
      jsonb_build_object('kind', _kind, 'strikes', strikes, 'until', ban_until)
    );
  END IF;

  RETURN QUERY SELECT strikes, ban_until;
END $$;

REVOKE ALL ON FUNCTION public.record_moderation_strike(text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_moderation_strike(text, uuid, numeric) TO authenticated;

-- moderation_log only accepts inserts from moderators, but the function above
-- runs as definer and writes an auto_ban row on the student's own behalf.
DROP POLICY IF EXISTS "modlog insert mods" ON public.moderation_log;
CREATE POLICY "modlog insert mods" ON public.moderation_log
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'moderator')
  OR public.has_role(auth.uid(), 'admin')
  OR actor_id = auth.uid()
);
