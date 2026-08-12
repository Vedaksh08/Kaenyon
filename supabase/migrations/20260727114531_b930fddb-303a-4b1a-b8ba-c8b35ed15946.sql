
REVOKE ALL ON FUNCTION public.get_friends(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_leaderboard(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_stats(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auto_flag_reported_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_friends(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_stats(uuid) TO authenticated;
