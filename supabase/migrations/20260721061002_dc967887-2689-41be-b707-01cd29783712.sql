
DROP FUNCTION IF EXISTS public.get_public_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id uuid)
RETURNS TABLE(id uuid, name text, avatar_url text, college text, course text, year text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id, name, avatar_url, college, course, year FROM public.profiles WHERE id = _user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;
