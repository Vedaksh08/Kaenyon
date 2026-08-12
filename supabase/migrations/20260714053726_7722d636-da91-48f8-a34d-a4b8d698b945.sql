
ALTER TABLE public.doubts REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.doubts';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
