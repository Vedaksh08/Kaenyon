DO $$
DECLARE _uid uuid;
BEGIN
  SELECT id INTO _uid FROM public.profiles WHERE email = 'nah@hfjf.com';
  IF _uid IS NULL THEN RETURN; END IF;

  DELETE FROM public.session_ratings WHERE rater_id = _uid OR ratee_id = _uid;
  DELETE FROM public.answers WHERE author_id = _uid;
  DELETE FROM public.doubts WHERE author_id = _uid;
  DELETE FROM public.reports WHERE reporter_id = _uid OR reported_user_id = _uid;
  DELETE FROM public.moderation_log WHERE actor_id = _uid OR target_user_id = _uid;
  DELETE FROM public.blocks WHERE blocker_id = _uid OR blocked_id = _uid;
  DELETE FROM public.friendships WHERE requester_id = _uid OR addressee_id = _uid;
  DELETE FROM public.user_presence WHERE user_id = _uid;
  DELETE FROM public.user_roles WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE id = _uid;
END $$;