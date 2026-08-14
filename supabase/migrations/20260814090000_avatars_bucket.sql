-- Storage for profile pictures.
--
-- The old profile screen stashed the image as a base64 data URL in
-- profiles.avatar_url. That inflates the row by megabytes and ships the whole
-- image with every profile query, including the batch lookups the classroom
-- runs for names. Store the file properly and keep only its URL in the column.

-- Newer Supabase builds add file_size_limit / allowed_mime_types; older ones
-- do not. Insert the minimal shape, then widen it only if the columns exist,
-- so this runs on either.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'file_size_limit'
  ) THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET file_size_limit = 2097152,
          allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
      WHERE id = 'avatars'
    $sql$;
  END IF;
END $$;

-- Public read: avatars are shown next to names all over the app, and the
-- bucket holds nothing private.
DROP POLICY IF EXISTS "avatars are publicly readable" ON storage.objects;
CREATE POLICY "avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Writes are confined to a folder named after the user's id, so nobody can
-- overwrite anyone else's picture.
DROP POLICY IF EXISTS "users manage their own avatar" ON storage.objects;
CREATE POLICY "users manage their own avatar"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
