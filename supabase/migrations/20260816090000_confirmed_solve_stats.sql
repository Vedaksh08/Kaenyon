-- Base the rankings on confirmed help, not on clicking a button.
--
-- "Doubts solved" counted rows in public.answers, but an answers row is written
-- the moment someone presses "Offer Help" — before any help has happened. So
-- the leaderboard rewarded clicking, and a student who offered on fifty doubts
-- and helped with none outranked someone who actually taught.
--
-- session_ratings.solved already records the truth: the person who raised the
-- doubt marks 'yes' / 'partial' / 'no' when they rate. That column was written
-- but never read. Count it instead:
--   yes     -> a solve
--   partial -> a solve (they did help; the score carries the nuance)
--   no      -> not a solve
--
-- Ratings are per (rater, ratee, session), so someone who genuinely helps three
-- people in a session earns three solves — and nobody can inflate their own
-- count, because only the asker can confirm.

-- Ranked by confirmed solves first, then rating. Everyone with any activity
-- appears, so a new student can see where they stand rather than an empty page.
CREATE OR REPLACE FUNCTION public.get_leaderboard(_limit integer DEFAULT 25)
RETURNS TABLE (
  user_id uuid,
  name text,
  avatar_url text,
  course text,
  solved bigint,
  avg_rating numeric,
  ratings_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH confirmed AS (
    SELECT
      ratee_id,
      count(*) FILTER (WHERE solved IN ('yes', 'partial')) AS solves,
      avg(score)                                          AS avg_score,
      count(*)                                            AS ratings
    FROM public.session_ratings
    WHERE ratee_id IS NOT NULL
    GROUP BY ratee_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.course,
    COALESCE(c.solves, 0)                          AS solved,
    ROUND(COALESCE(c.avg_score, 0)::numeric, 2)    AS avg_rating,
    COALESCE(c.ratings, 0)                         AS ratings_count
  FROM public.profiles p
  LEFT JOIN confirmed c ON c.ratee_id = p.id
  WHERE p.onboarded_at IS NOT NULL
  ORDER BY
    COALESCE(c.solves, 0)    DESC,
    COALESCE(c.avg_score, 0) DESC,
    COALESCE(c.ratings, 0)   DESC,
    p.name
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO authenticated;

-- Same definition of "solved" on the personal stats, so a student's own numbers
-- match their row on the leaderboard. `answers_given` keeps counting offers —
-- it is a different, still-useful figure — but it is no longer what ranks them.
CREATE OR REPLACE FUNCTION public.get_my_stats(_user_id uuid)
RETURNS TABLE (
  doubts_asked bigint,
  answers_given bigint,
  solved bigint,
  friends bigint,
  avg_rating numeric,
  ratings_count bigint,
  rank bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT
      count(*) FILTER (WHERE solved IN ('yes', 'partial')) AS solves,
      avg(score)                                          AS avg_score,
      count(*)                                            AS ratings
    FROM public.session_ratings
    WHERE ratee_id = _user_id
  ),
  everyone AS (
    SELECT ratee_id, count(*) FILTER (WHERE solved IN ('yes', 'partial')) AS solves
    FROM public.session_ratings
    WHERE ratee_id IS NOT NULL
    GROUP BY ratee_id
  )
  SELECT
    (SELECT count(*) FROM public.doubts  WHERE author_id = _user_id),
    (SELECT count(*) FROM public.answers WHERE author_id = _user_id),
    (SELECT COALESCE(solves, 0) FROM me),
    (SELECT count(*) FROM public.friendships
      WHERE status = 'accepted' AND (requester_id = _user_id OR addressee_id = _user_id)),
    (SELECT ROUND(COALESCE(avg_score, 0)::numeric, 2) FROM me),
    (SELECT COALESCE(ratings, 0) FROM me),
    -- Rank is "how many people are ahead of me", so ties share a position.
    (SELECT 1 + count(*) FROM everyone e
      WHERE e.solves > (SELECT COALESCE(solves, 0) FROM me));
$$;

REVOKE ALL ON FUNCTION public.get_my_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_stats(uuid) TO authenticated;
