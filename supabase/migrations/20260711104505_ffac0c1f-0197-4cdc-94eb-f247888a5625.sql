
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;

CREATE POLICY "profiles readable by owner"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Safe, minimal public view for name/avatar lookups (no email, college, suspension, etc.)
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true) AS
SELECT id, name, avatar_url
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated;

-- Allow the view to bypass the tightened profiles SELECT policy safely
CREATE POLICY "profiles name/avatar readable to authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (false);
-- (view uses security_invoker; readers still need a permitting policy)

DROP POLICY IF EXISTS "profiles name/avatar readable to authenticated" ON public.profiles;

-- Instead: create a SECURITY DEFINER function to expose minimal fields
CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id uuid)
RETURNS TABLE(id uuid, name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, avatar_url FROM public.profiles WHERE id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;

-- Drop the view approach since it depends on RLS which we now restrict to owner
DROP VIEW IF EXISTS public.public_profiles;
