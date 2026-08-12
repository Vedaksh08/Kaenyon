-- Seed the subject catalogue.
-- These 44 rows were created by hand in the original Lovable-provisioned project
-- and never captured in a migration, so a fresh database came up with an empty
-- app (no subjects => no classrooms => nothing to browse). Exported 2026-08-11.
--
-- ON CONFLICT keeps this safe to re-run and non-destructive to live edits.

INSERT INTO public.subjects (slug, name, category) VALUES
  ('computer-science', 'Computer Science', 'cs'),
  ('ai', 'AI', 'cs'),
  ('data-structures', 'Data Structures', 'cs'),
  ('software-engineering', 'Software Engineering', 'cs'),
  ('operating-systems', 'Operating Systems', 'cs'),
  ('web-development', 'Web Development', 'cs'),
  ('cyber-security', 'Cyber Security', 'cs'),
  ('thermodynamics', 'Thermodynamics', 'mechanical'),
  ('fluid-mechanics', 'Fluid Mechanics', 'mechanical'),
  ('machine-design', 'Machine Design', 'mechanical'),
  ('manufacturing', 'Manufacturing', 'mechanical'),
  ('dynamics', 'Dynamics', 'mechanical'),
  ('circuits', 'Circuits', 'electrical'),
  ('power-systems', 'Power Systems', 'electrical'),
  ('electronics', 'Electronics', 'electrical'),
  ('signals-and-systems', 'Signals & Systems', 'electrical'),
  ('control-systems', 'Control Systems', 'electrical'),
  ('structural-engineering', 'Structural Engineering', 'civil'),
  ('geotechnical', 'Geotechnical', 'civil'),
  ('surveying', 'Surveying', 'civil'),
  ('anatomy', 'Anatomy', 'medical'),
  ('physiology', 'Physiology', 'medical'),
  ('biochemistry', 'Biochemistry', 'medical'),
  ('pharmacology', 'Pharmacology', 'medical'),
  ('pathology', 'Pathology', 'medical'),
  ('marketing', 'Marketing', 'business'),
  ('finance', 'Finance', 'business'),
  ('accounting', 'Accounting', 'business'),
  ('strategy', 'Strategy', 'business'),
  ('operations', 'Operations', 'business'),
  ('accountancy', 'Accountancy', 'commerce'),
  ('economics', 'Economics', 'commerce'),
  ('business-studies', 'Business Studies', 'commerce'),
  ('constitutional-law', 'Constitutional Law', 'law'),
  ('criminal-law', 'Criminal Law', 'law'),
  ('english-literature', 'English Literature', 'arts'),
  ('history', 'History', 'arts'),
  ('psychology', 'Psychology', 'arts'),
  ('physics', 'Physics', 'science'),
  ('chemistry', 'Chemistry', 'science'),
  ('mathematics', 'Mathematics', 'science'),
  ('biology', 'Biology', 'science'),
  ('design-studio', 'Design Studio', 'arch'),
  ('building-technology', 'Building Technology', 'arch')
ON CONFLICT (slug) DO NOTHING;
