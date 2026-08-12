-- Cross-user profile reads.
--
-- `profiles` SELECT is owner-only (see 20260711104505), which is correct: it keeps
-- email/college/suspension private. But several screens legitimately need other
-- users' display names, and querying public.profiles directly just returns zero
-- rows for them — names silently render as "Student" / "—".
--
-- get_public_profile(uuid) already solves this for a single user. These add the
-- batch equivalent, plus the moderator-only view the admin screen needs.

-- Batch version of get_public_profile, matching its column list. Never exposes
-- email or suspension state. Used for chat authors, room rosters, admin name
-- maps.
DROP FUNCTION IF EXISTS public.get_public_profiles(uuid[]);

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (id uuid, name text, avatar_url text, college text, course text, year text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.avatar_url, p.college, p.course, p.year
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

-- Suspended-user list for the admin screen. Exposes email and suspension state,
-- so it is gated on has_role(admin|moderator) *inside* the function — a plain
-- SECURITY DEFINER without this check would leak every user's email.
CREATE OR REPLACE FUNCTION public.get_suspended_profiles(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, name text, email text, suspended_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.email, p.suspended_until
  FROM public.profiles p
  WHERE p.suspended_until IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'moderator')
    )
  ORDER BY p.suspended_until DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.get_suspended_profiles(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_suspended_profiles(integer) TO authenticated;
