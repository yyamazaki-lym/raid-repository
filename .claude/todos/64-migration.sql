-- TODO #64 (2.1, 2026-05-02 part5) production migration
-- Applied via MCP supabase apply_migration after Vercel main deploy lands.

-- 1. Child table for multi-URL session logs.
CREATE TABLE IF NOT EXISTS public.schedule_past_session_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_date    text NOT NULL
              REFERENCES public.schedule_past_sessions(raw_date)
              ON DELETE CASCADE,
  url         text NOT NULL,
  source      text NOT NULL DEFAULT 'manual'
              CHECK (source IN ('auto','manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_date, url)
);

CREATE INDEX IF NOT EXISTS schedule_past_session_logs_raw_date_idx
  ON public.schedule_past_session_logs(raw_date);

-- 2. Seed existing logs_url rows into the new table. Idempotent guard
-- via information_schema so a re-run after the column DROP below
-- becomes a no-op.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'schedule_past_sessions'
       AND column_name  = 'logs_url'
  ) THEN
    INSERT INTO public.schedule_past_session_logs (raw_date, url, source)
    SELECT raw_date, logs_url,
           COALESCE(NULLIF(logs_url_source, ''), 'manual')
      FROM public.schedule_past_sessions
     WHERE logs_url IS NOT NULL
    ON CONFLICT (raw_date, url) DO NOTHING;
  END IF;
END
$migration$;

-- 3. Drop legacy columns + their CHECK constraint.
ALTER TABLE public.schedule_past_sessions
  DROP CONSTRAINT IF EXISTS schedule_past_sessions_logs_url_source_check;
ALTER TABLE public.schedule_past_sessions
  DROP COLUMN IF EXISTS logs_url,
  DROP COLUMN IF EXISTS logs_url_source;

-- 4. RLS — same pattern as the other portal tables (Section 7 of schema.sql).
ALTER TABLE public.schedule_past_session_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_past_session_logs_anon_select
  ON public.schedule_past_session_logs;
CREATE POLICY schedule_past_session_logs_anon_select
  ON public.schedule_past_session_logs
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS schedule_past_session_logs_anon_insert
  ON public.schedule_past_session_logs;
CREATE POLICY schedule_past_session_logs_anon_insert
  ON public.schedule_past_session_logs
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

DROP POLICY IF EXISTS schedule_past_session_logs_anon_update
  ON public.schedule_past_session_logs;
CREATE POLICY schedule_past_session_logs_anon_update
  ON public.schedule_past_session_logs
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

DROP POLICY IF EXISTS schedule_past_session_logs_anon_delete
  ON public.schedule_past_session_logs;
CREATE POLICY schedule_past_session_logs_anon_delete
  ON public.schedule_past_session_logs
  FOR DELETE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

-- 5. Realtime — REPLICA IDENTITY FULL + publication add.
ALTER TABLE public.schedule_past_session_logs REPLICA IDENTITY FULL;

DO $pub$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_past_session_logs';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$pub$;
