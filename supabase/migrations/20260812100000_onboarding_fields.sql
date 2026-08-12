-- Onboarding moved out of signup.
--
-- Sign-up now collects nothing but an email (or a Google account), and the
-- student fills in their details on first sign-in instead. That needs two
-- things the schema did not have: a date of birth, and a way to tell "has not
-- filled the form in yet" apart from "filled it in and left a field blank".

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Existing accounts that already have the details are treated as onboarded, so
-- nobody gets sent back through a form they have already completed.
UPDATE public.profiles
SET onboarded_at = COALESCE(onboarded_at, now())
WHERE onboarded_at IS NULL
  AND NULLIF(btrim(name), '') IS NOT NULL
  AND NULLIF(btrim(college), '') IS NOT NULL;

-- Keep the batch profile lookup in step with the new columns. Still no email
-- and no suspension state — this is the "anyone signed in may read" view.
--
-- DROP first: an earlier revision of this function returned only
-- (id, name, avatar_url), and CREATE OR REPLACE cannot widen the OUT
-- parameters of an existing function.
DROP FUNCTION IF EXISTS public.get_public_profiles(uuid[]);

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (id uuid, name text, avatar_url text, college text, course text, year text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.avatar_url, p.college, p.course, p.year
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
  LIMIT 500;
$$;

-- DROP took the grants with it, so re-apply them.
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
