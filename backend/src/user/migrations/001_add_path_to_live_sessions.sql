-- ══════════════════════════════════════════════════════════════════════
-- Migration: Add path tracking to live_sessions
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- 
-- Adds a JSONB column to store the route path coordinates during
-- live tracking sessions. Path is an array of {lat, lng, t} objects.
-- Also adds 30-day auto-cleanup for old sessions.
-- ══════════════════════════════════════════════════════════════════════

-- Add path column to live_sessions (stores coordinate history as JSONB array)
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS path jsonb DEFAULT '[]'::jsonb;

-- Add index for querying old sessions for cleanup
CREATE INDEX IF NOT EXISTS idx_live_sessions_ended_at
  ON public.live_sessions(ended_at)
  WHERE ended_at IS NOT NULL;

-- Function to append a coordinate to a live session's path
-- Called from the backend on each location update
CREATE OR REPLACE FUNCTION public.append_path_point(
  p_user_id uuid,
  p_lat real,
  p_lng real
)
RETURNS void AS $$
BEGIN
  UPDATE public.live_sessions
  SET path = COALESCE(path, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 't', extract(epoch from now())::bigint)
  ),
  current_lat = p_lat,
  current_lng = p_lng,
  last_update_at = now()
  WHERE user_id = p_user_id AND status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up sessions older than 30 days
-- Call this periodically (e.g. from a cron job or server interval)
CREATE OR REPLACE FUNCTION public.cleanup_old_sessions()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.live_sessions
  WHERE ended_at IS NOT NULL
    AND ended_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
