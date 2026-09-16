-- Authoritative leases enforce the 30-seat limit and camera policy. Presence
-- remains only a roster/track-discovery mechanism for the SFU.
CREATE TABLE IF NOT EXISTS public.classroom_video_participants (
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
  camera_on boolean NOT NULL DEFAULT true, camera_off_since timestamptz, last_warning_at timestamptz,
  warning_count smallint NOT NULL DEFAULT 0 CHECK (warning_count BETWEEN 0 AND 3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','kicked','left')),
  PRIMARY KEY (classroom_id,user_id)
);
ALTER TABLE public.classroom_video_participants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_classroom_video_seat(p_classroom_id uuid,p_user_id uuid,p_session_id uuid)
RETURNS TABLE(status text,warning_count smallint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seats integer; old_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom_id::text,0));
  DELETE FROM classroom_video_participants WHERE classroom_id=p_classroom_id AND status='active' AND last_seen < now()-interval '75 seconds';
  SELECT cvp.status INTO old_status FROM classroom_video_participants cvp WHERE cvp.classroom_id=p_classroom_id AND cvp.user_id=p_user_id FOR UPDATE;
  IF old_status='kicked' THEN RAISE EXCEPTION 'You were removed because your camera remained off.'; END IF;
  SELECT count(*) INTO seats FROM classroom_video_participants WHERE classroom_id=p_classroom_id AND status='active' AND user_id<>p_user_id;
  IF seats >= 30 THEN RAISE EXCEPTION 'This classroom is full (30 participants).'; END IF;
  INSERT INTO classroom_video_participants(classroom_id,user_id,session_id) VALUES(p_classroom_id,p_user_id,p_session_id)
  ON CONFLICT(classroom_id,user_id) DO UPDATE SET session_id=EXCLUDED.session_id,status='active',camera_on=true,camera_off_since=NULL,last_seen=now(),joined_at=now();
  RETURN QUERY SELECT 'active'::text,0::smallint;
END $$;

CREATE OR REPLACE FUNCTION public.heartbeat_classroom_video(p_classroom_id uuid,p_user_id uuid,p_session_id uuid,p_camera_on boolean)
RETURNS TABLE(status text,warning_count smallint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE row_status text; warnings smallint; off_since timestamptz; warned_at timestamptz;
BEGIN
  SELECT cvp.status,cvp.warning_count,cvp.camera_off_since,cvp.last_warning_at INTO row_status,warnings,off_since,warned_at FROM classroom_video_participants cvp WHERE classroom_id=p_classroom_id AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your classroom session is no longer active.'; END IF;
  IF row_status <> 'active' THEN RETURN QUERY SELECT row_status,warnings; RETURN; END IF;
  IF p_camera_on THEN
    UPDATE classroom_video_participants SET last_seen=now(),camera_on=true,camera_off_since=NULL,last_warning_at=NULL,warning_count=0 WHERE classroom_id=p_classroom_id AND user_id=p_user_id;
  ELSE
    UPDATE classroom_video_participants SET last_seen=now(),camera_on=false,camera_off_since=COALESCE(camera_off_since,now()) WHERE classroom_id=p_classroom_id AND user_id=p_user_id;
    SELECT warning_count,camera_off_since,last_warning_at INTO warnings,off_since,warned_at FROM classroom_video_participants WHERE classroom_id=p_classroom_id AND user_id=p_user_id;
    IF off_since <= now()-interval '5 seconds' AND (warned_at IS NULL OR warned_at <= now()-interval '10 seconds') THEN
      IF warnings >= 3 THEN UPDATE classroom_video_participants SET status='kicked' WHERE classroom_id=p_classroom_id AND user_id=p_user_id;
      ELSE UPDATE classroom_video_participants SET warning_count=warning_count+1,last_warning_at=now() WHERE classroom_id=p_classroom_id AND user_id=p_user_id; END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT cvp.status,cvp.warning_count FROM classroom_video_participants cvp WHERE classroom_id=p_classroom_id AND user_id=p_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.leave_classroom_video(p_classroom_id uuid,p_user_id uuid,p_session_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE classroom_video_participants SET status='left',last_seen=now() WHERE classroom_id=p_classroom_id AND user_id=p_user_id AND session_id=p_session_id;
$$;
REVOKE ALL ON FUNCTION public.claim_classroom_video_seat(uuid,uuid,uuid),public.heartbeat_classroom_video(uuid,uuid,uuid,boolean),public.leave_classroom_video(uuid,uuid,uuid) FROM PUBLIC;
