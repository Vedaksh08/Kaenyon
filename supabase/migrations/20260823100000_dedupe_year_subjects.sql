-- One classroom per subject per year, not per semester.
--
-- A subject that runs across both semesters of a year (Engineering Mathematics
-- and Programming Language in B.Tech CSE year 1, for example) was returned
-- twice, so the dashboard showed two cards pointing at the same classroom.
-- Collapse to one row per subject and drop the semester from the result — the
-- dashboard groups by subject now, not by semester.
DROP FUNCTION IF EXISTS public.get_course_subjects(text, int);

CREATE OR REPLACE FUNCTION public.get_course_subjects(_course_slug text, _year int)
RETURNS TABLE (slug text, name text, sort_order int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.slug, s.name, MIN(cs.sort_order)::int AS sort_order
  FROM public.course_subjects cs
  JOIN public.subjects s ON s.slug = cs.subject_slug
  WHERE cs.course_slug = _course_slug
    AND cs.semester IN (_year * 2 - 1, _year * 2)
  GROUP BY s.slug, s.name
  ORDER BY MIN(cs.sort_order), s.name;
$$;

REVOKE ALL ON FUNCTION public.get_course_subjects(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_subjects(text, int) TO authenticated;
