-- Seed the subject catalogue.
--
-- Phase 1 ships CS only. A later migration
-- (20260812090000_trim_to_phase1_subjects) prunes anything beyond this list,
-- so keep the two in step if subjects are added.
--
-- ON CONFLICT keeps this safe to re-run and non-destructive to live edits.

INSERT INTO public.subjects (slug, name, category) VALUES
  ('computer-science', 'Computer Science', 'cs'),
  ('ai', 'AI', 'cs'),
  ('data-structures', 'Data Structures', 'cs'),
  ('software-engineering', 'Software Engineering', 'cs'),
  ('operating-systems', 'Operating Systems', 'cs'),
  ('web-development', 'Web Development', 'cs'),
  ('cyber-security', 'Cyber Security', 'cs')
ON CONFLICT (slug) DO NOTHING;
