
CREATE TYPE public.friend_status AS ENUM ('pending','accepted','declined');

CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.friend_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "friendships read own" ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY "friendships insert self" ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "friendships update involved" ON public.friendships FOR UPDATE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY "friendships delete involved" ON public.friendships FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  subject_slug text,
  last_seen timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "presence read auth" ON public.user_presence FOR SELECT TO authenticated USING (true);
CREATE POLICY "presence upsert own" ON public.user_presence FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "presence update own" ON public.user_presence FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "presence delete own" ON public.user_presence FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.session_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ratee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 10),
  solved text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.session_ratings TO authenticated;
GRANT ALL ON public.session_ratings TO service_role;
ALTER TABLE public.session_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings read auth" ON public.session_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ratings insert self" ON public.session_ratings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = rater_id AND (ratee_id IS NULL OR ratee_id <> auth.uid()));

CREATE OR REPLACE FUNCTION public.get_friends(_user_id uuid)
RETURNS TABLE (
  friend_id uuid, name text, avatar_url text, college text, course text, year text,
  status public.friend_status, direction text, online boolean, subject_name text, classroom_id uuid, room_number integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.avatar_url, p.college, p.course, p.year,
         f.status,
         CASE WHEN f.requester_id = _user_id THEN 'outgoing' ELSE 'incoming' END AS direction,
         (pr.last_seen IS NOT NULL AND pr.last_seen > now() - interval '2 minutes') AS online,
         s.name, pr.classroom_id, c.room_number
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = _user_id THEN f.addressee_id ELSE f.requester_id END
  LEFT JOIN public.user_presence pr ON pr.user_id = p.id
  LEFT JOIN public.classrooms c ON c.id = pr.classroom_id
  LEFT JOIN public.subjects s ON s.slug = COALESCE(pr.subject_slug, c.subject_slug)
  WHERE (f.requester_id = _user_id OR f.addressee_id = _user_id)
    AND f.status <> 'declined'
  ORDER BY online DESC, p.name;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard(_limit integer DEFAULT 25)
RETURNS TABLE (user_id uuid, name text, avatar_url text, course text, solved bigint, avg_rating numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.avatar_url, p.course,
         COALESCE(a.cnt, 0) AS solved,
         ROUND(COALESCE(r.avg_score, 0)::numeric, 2) AS avg_rating
  FROM public.profiles p
  LEFT JOIN (SELECT author_id, count(*) cnt FROM public.answers GROUP BY author_id) a ON a.author_id = p.id
  LEFT JOIN (SELECT ratee_id, avg(score) avg_score FROM public.session_ratings WHERE ratee_id IS NOT NULL GROUP BY ratee_id) r ON r.ratee_id = p.id
  ORDER BY COALESCE(a.cnt,0) DESC, COALESCE(r.avg_score,0) DESC, p.name
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

CREATE OR REPLACE FUNCTION public.get_my_stats(_user_id uuid)
RETURNS TABLE (doubts_asked bigint, answers_given bigint, friends bigint, avg_rating numeric, rank bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM public.doubts WHERE author_id = _user_id),
    (SELECT count(*) FROM public.answers WHERE author_id = _user_id),
    (SELECT count(*) FROM public.friendships WHERE status = 'accepted' AND (requester_id = _user_id OR addressee_id = _user_id)),
    (SELECT ROUND(COALESCE(avg(score), 0)::numeric, 2) FROM public.session_ratings WHERE ratee_id = _user_id),
    (SELECT 1 + count(*) FROM (
       SELECT author_id, count(*) c FROM public.answers GROUP BY author_id
     ) t WHERE t.c > (SELECT count(*) FROM public.answers WHERE author_id = _user_id));
$$;

CREATE OR REPLACE FUNCTION public.auto_flag_reported_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_count integer;
BEGIN
  IF NEW.reported_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(DISTINCT reporter_id) INTO recent_count
  FROM public.reports
  WHERE reported_user_id = NEW.reported_user_id
    AND created_at > now() - interval '7 days';
  IF recent_count >= 3 THEN
    UPDATE public.profiles
      SET suspended_until = GREATEST(COALESCE(suspended_until, now()), now() + interval '3 days')
      WHERE id = NEW.reported_user_id;
    INSERT INTO public.moderation_log (actor_id, target_user_id, action, details)
    VALUES (NEW.reporter_id, NEW.reported_user_id, 'auto_suspend',
            jsonb_build_object('reports_7d', recent_count, 'duration', '3 days'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_auto_flag AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.auto_flag_reported_user();
