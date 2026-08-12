CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.cleanup_old_doubts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.answers a
  USING public.doubts d
  WHERE a.doubt_id = d.id AND d.created_at < now() - interval '1 hour';

  DELETE FROM public.answers WHERE created_at < now() - interval '1 hour';

  DELETE FROM public.doubts WHERE created_at < now() - interval '1 hour';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_doubts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_doubts() TO service_role;