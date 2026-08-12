
-- =========================
-- Enums
-- =========================
CREATE TYPE public.app_role AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE public.report_reason AS ENUM ('spam','abuse','off_topic','wrong_answer','other');
CREATE TYPE public.answer_status AS ENUM ('pending','accepted','rejected');

-- =========================
-- profiles
-- =========================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  college TEXT NOT NULL DEFAULT '',
  course TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  suspended_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles insert self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles update self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =========================
-- user_roles
-- =========================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles read own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Security-definer role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Admins can see and grant all roles
CREATE POLICY "user_roles admin read all" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- =========================
-- subjects
-- =========================
CREATE TABLE public.subjects (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subjects TO anon, authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjects public read" ON public.subjects FOR SELECT USING (true);

-- =========================
-- course_subject_map
-- =========================
CREATE TABLE public.course_subject_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_key TEXT NOT NULL,
  subject_slug TEXT NOT NULL REFERENCES public.subjects(slug) ON DELETE CASCADE,
  is_recommended BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (course_key, subject_slug)
);
GRANT SELECT ON public.course_subject_map TO anon, authenticated;
GRANT ALL ON public.course_subject_map TO service_role;
ALTER TABLE public.course_subject_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "course_map public read" ON public.course_subject_map FOR SELECT USING (true);

-- =========================
-- classrooms
-- =========================
CREATE TABLE public.classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_slug TEXT NOT NULL REFERENCES public.subjects(slug) ON DELETE CASCADE,
  room_number INT NOT NULL,
  capacity INT NOT NULL DEFAULT 30,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_slug, room_number)
);
GRANT SELECT ON public.classrooms TO anon, authenticated;
GRANT ALL ON public.classrooms TO service_role;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "classrooms public read" ON public.classrooms FOR SELECT USING (true);

-- =========================
-- doubts
-- =========================
CREATE TABLE public.doubts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doubts TO authenticated;
GRANT ALL ON public.doubts TO service_role;
ALTER TABLE public.doubts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doubts read all auth" ON public.doubts FOR SELECT TO authenticated USING (true);
CREATE POLICY "doubts insert self" ON public.doubts FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "doubts update own or mod" ON public.doubts FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "doubts delete own or mod" ON public.doubts FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- =========================
-- answers
-- =========================
CREATE TABLE public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doubt_id UUID NOT NULL REFERENCES public.doubts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status public.answer_status NOT NULL DEFAULT 'pending',
  rating INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answers TO authenticated;
GRANT ALL ON public.answers TO service_role;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "answers read all auth" ON public.answers FOR SELECT TO authenticated USING (true);
CREATE POLICY "answers insert self" ON public.answers FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "answers update own or mod" ON public.answers FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "answers delete own or mod" ON public.answers FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- =========================
-- reports
-- =========================
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  doubt_id UUID REFERENCES public.doubts(id) ON DELETE CASCADE,
  answer_id UUID REFERENCES public.answers(id) ON DELETE CASCADE,
  reason public.report_reason NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports insert self" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports read own or mod" ON public.reports FOR SELECT TO authenticated USING (
  auth.uid() = reporter_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin')
);

-- =========================
-- blocks
-- =========================
CREATE TABLE public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks manage own" ON public.blocks FOR ALL TO authenticated
  USING (auth.uid() = blocker_id) WITH CHECK (auth.uid() = blocker_id);

-- =========================
-- moderation_log
-- =========================
CREATE TABLE public.moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.moderation_log TO authenticated;
GRANT ALL ON public.moderation_log TO service_role;
ALTER TABLE public.moderation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modlog read mods" ON public.moderation_log FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "modlog insert mods" ON public.moderation_log FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin')
);

-- =========================
-- Auto-create profile on signup
-- =========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  -- Grant default 'user' role
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
