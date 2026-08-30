-- Disable every automatic camera-moderation suspension immediately.
--
-- The prior implementation could set a 20-minute `suspended_until` after
-- classifier strikes. A classifier result must not prevent someone from using
-- the platform. Manual moderator suspensions are deliberately untouched: this
-- only clears profiles that have an automatic-ban audit record.
DROP FUNCTION IF EXISTS public.record_moderation_strike(text, uuid, numeric);

UPDATE public.profiles p
SET suspended_until = NULL
WHERE p.suspended_until IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.moderation_log m
    WHERE m.target_user_id = p.id
      AND m.action = 'auto_ban'
  );
