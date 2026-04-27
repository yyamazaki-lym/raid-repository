-- ============================================================
-- Raid Repository — Supabase schema (Phase 2)
-- ============================================================
-- Single-tenant: each raid group runs their own Supabase + Vercel.
-- Anon key has full read/write via RLS (no auth model).
--
-- Run in Supabase Dashboard → SQL Editor → New query → Run.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---- 1. Helpers --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ---- 2. categories -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT '未着手'
              CHECK (status IN ('未着手','練習中','クリア済','休止中')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Idempotent CHECK widening — recreate the constraint so re-running this
-- file after the original three-value version expands it to four values.
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_status_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_status_check
  CHECK (status IN ('未着手','練習中','クリア済','休止中'));
-- Phase 3 additions: external spreadsheet URLs (added later via migration).
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS loot_sheet_url               text,
  ADD COLUMN IF NOT EXISTS mitigation_sheet_url         text,
  -- Phase 4: per-category Discord channels for the daily auto-import job.
  ADD COLUMN IF NOT EXISTS discord_strategy_channel_id  text,
  ADD COLUMN IF NOT EXISTS discord_video_channel_id     text,
  -- Phase 4.1: per-category pause toggle for the Discord import.
  ADD COLUMN IF NOT EXISTS discord_import_enabled       boolean NOT NULL DEFAULT true,
  -- Phase 4.4: first-clear timestamp. Manually editable via the category
  -- dialog, and also auto-populated when a video link with "クリア" / "clear"
  -- in the title first appears (manual add or Discord import) AND this field
  -- is still NULL. Once set, never auto-overwritten — only manual edits.
  ADD COLUMN IF NOT EXISTS first_clear_at               timestamptz;

CREATE INDEX IF NOT EXISTS categories_sort_order_idx
  ON public.categories(sort_order);

DROP TRIGGER IF EXISTS set_updated_at_categories ON public.categories;
CREATE TRIGGER set_updated_at_categories
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 2b. category_links (strategy links + videos) ----------------------

CREATE TABLE IF NOT EXISTS public.category_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('strategy','video')),
  title       text NOT NULL,
  url         text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Phase 4.1: track origin so the UI can mark Discord-imported entries.
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','discord'));

-- Phase 4.3: optional secondary URL — used by videos to link to the
-- corresponding FFLogs report (or any related external page).
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS logs_url text;

-- Phase 4.5: video duration in seconds. Auto-fetched from YouTube on
-- insert (HTML scrape) or manually filled. Used to compute the
-- cumulative "practice time" total per category.
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- Phase 4.6: original post timestamp distinct from `created_at`
-- (which is the row insert time). Discord-imported rows store the
-- message timestamp here; YouTube-sourced rows fall back to the
-- video's upload date. Used by first-clear detection so a single
-- batch import doesn't end up giving every category the same date.
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;
CREATE INDEX IF NOT EXISTS category_links_category_kind_idx
  ON public.category_links(category_id, kind, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_category_links ON public.category_links;
CREATE TRIGGER set_updated_at_category_links
  BEFORE UPDATE ON public.category_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 3. loot -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.loot_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slot         text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loot_items_category_idx
  ON public.loot_items(category_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_loot_items ON public.loot_items;
CREATE TRIGGER set_updated_at_loot_items
  BEFORE UPDATE ON public.loot_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.loot_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loot_item_id  uuid NOT NULL REFERENCES public.loot_items(id) ON DELETE CASCADE,
  player_name   text NOT NULL,
  status        text NOT NULL DEFAULT '未定'
                CHECK (status IN ('次優先','辞退','取得済','未定')),
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loot_entries_item_idx
  ON public.loot_entries(loot_item_id);

DROP TRIGGER IF EXISTS set_updated_at_loot_entries ON public.loot_entries;
CREATE TRIGGER set_updated_at_loot_entries
  BEFORE UPDATE ON public.loot_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 4. mitigation -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mitigation_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mitigation_phases_category_idx
  ON public.mitigation_phases(category_id, sort_order);

CREATE TABLE IF NOT EXISTS public.mitigation_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id     uuid NOT NULL REFERENCES public.mitigation_phases(id) ON DELETE CASCADE,
  time_label   text,
  mechanic     text NOT NULL,
  player_name  text,
  skill        text,
  note         text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mitigation_entries_phase_idx
  ON public.mitigation_entries(phase_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_mitigation_entries ON public.mitigation_entries;
CREATE TRIGGER set_updated_at_mitigation_entries
  BEFORE UPDATE ON public.mitigation_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5. strategy docs -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.strategy_docs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  title           text,
  body_md         text NOT NULL DEFAULT '',
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_docs_category_idx
  ON public.strategy_docs(category_id);

DROP TRIGGER IF EXISTS set_updated_at_strategy_docs ON public.strategy_docs;
CREATE TRIGGER set_updated_at_strategy_docs
  BEFORE UPDATE ON public.strategy_docs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5b. app_settings (shared key/value across all members) -----------

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_app_settings ON public.app_settings;
CREATE TRIGGER set_updated_at_app_settings
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5c-2. schedule_session_memos (per-date shared notes) ------------
-- Free-form notes attached to a particular session (keyed by rawDate
-- so the same key joins both live character-sheets data and the
-- snapshot table). Multiple memos per date, all visible to every
-- viewer (no auth model — same trust scope as the rest of the app).

CREATE TABLE IF NOT EXISTS public.schedule_session_memos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_date    text NOT NULL,
  body        text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_session_memos_date_idx
  ON public.schedule_session_memos(raw_date, created_at);

DROP TRIGGER IF EXISTS set_updated_at_schedule_session_memos
  ON public.schedule_session_memos;
CREATE TRIGGER set_updated_at_schedule_session_memos
  BEFORE UPDATE ON public.schedule_session_memos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5d-pre. category_macros (in-game text macros per category) ------
-- FF14 chat-window macros (`/p ...` / `/say ...` style payloads) that
-- a group typically posts during a fight to coordinate calls. Modeled
-- per category so each content's macros stay scoped to its tab.

CREATE TABLE IF NOT EXISTS public.category_macros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT '',
  body        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS category_macros_category_idx
  ON public.category_macros(category_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_category_macros
  ON public.category_macros;
CREATE TRIGGER set_updated_at_category_macros
  BEFORE UPDATE ON public.category_macros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5d. recruitment_templates (PT募集文 templates, shared) -----------
-- Text templates that get copy-pasted into Discord / FF14 PT-募集 sites.
-- Each template is associated with a category (heavy / cruiser / ...)
-- so the dropdown groups sensibly. Multiple templates per category is
-- expected (e.g. one for each floor 1-4). The optional `label` is a
-- short sub-name within the category — empty when there's only one.

CREATE TABLE IF NOT EXISTS public.recruitment_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL DEFAULT '',
  body        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Phase 5b: per-category association.
ALTER TABLE public.recruitment_templates
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL;

-- Allow empty labels (originally NOT NULL with no default — pre-migration
-- rows are fine since label was always entered, but we want future
-- inserts to be able to omit it).
ALTER TABLE public.recruitment_templates
  ALTER COLUMN label DROP NOT NULL,
  ALTER COLUMN label SET DEFAULT '';

CREATE INDEX IF NOT EXISTS recruitment_templates_sort_idx
  ON public.recruitment_templates(sort_order);
CREATE INDEX IF NOT EXISTS recruitment_templates_category_idx
  ON public.recruitment_templates(category_id);

DROP TRIGGER IF EXISTS set_updated_at_recruitment_templates
  ON public.recruitment_templates;
CREATE TRIGGER set_updated_at_recruitment_templates
  BEFORE UPDATE ON public.recruitment_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5c. schedule_past_sessions (Discord-sourced history) -------------
-- Past raid session dates parsed from a Discord notification channel.
-- Useful when character-sheets has aged out old dates but the group
-- still wants a complete historical record. Idempotent: rawDate is the
-- primary key so a re-import won't double-insert.

CREATE TABLE IF NOT EXISTS public.schedule_past_sessions (
  raw_date    text PRIMARY KEY,
  parsed_date timestamptz NOT NULL,
  start_time  text NOT NULL,
  end_time    text NOT NULL,
  day_of_week text NOT NULL,
  source      text NOT NULL DEFAULT 'discord'
              CHECK (source IN ('discord','manual','snapshot')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_past_sessions_date_idx
  ON public.schedule_past_sessions(parsed_date DESC);

-- Phase 5: attendance snapshot. Discord-only rows get NULL here; rows
-- created from a character-sheets snapshot store the attendance map +
-- user-name list so we can reconstruct the past detail table even
-- after character-sheets ages the date out.
ALTER TABLE public.schedule_past_sessions
  ADD COLUMN IF NOT EXISTS attendances jsonb,
  ADD COLUMN IF NOT EXISTS user_names jsonb;
-- attendances format: { "Alice": "◯", "Bob": "×", ... }
-- user_names format:  ["Alice","Bob","Charlie", ...] (order = column order)

-- Phase 6: per-session FFLogs URL. Populated by the FFLogs sync action
-- when a report's start time falls within the session's window — lets
-- the schedule UI surface a Logs link for sessions that have no
-- matching video (e.g. a session that wasn't recorded).
ALTER TABLE public.schedule_past_sessions
  ADD COLUMN IF NOT EXISTS logs_url text;

-- Widen the source CHECK constraint to allow 'snapshot' on existing
-- deployments where the table was created with the old 2-value list.
ALTER TABLE public.schedule_past_sessions
  DROP CONSTRAINT IF EXISTS schedule_past_sessions_source_check;
ALTER TABLE public.schedule_past_sessions
  ADD CONSTRAINT schedule_past_sessions_source_check
  CHECK (source IN ('discord','manual','snapshot'));

-- ---- 6. tags (universal — D scheme) ----------------------------------

CREATE TABLE IF NOT EXISTS public.tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type     text NOT NULL
                  CHECK (target_type IN
                    ('category','loot_item','loot_entry',
                     'mitigation_entry','strategy_doc')),
  target_id       uuid NOT NULL,
  label           text NOT NULL,
  color           text,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tags_target_idx
  ON public.tags(target_type, target_id);

-- ---- 7. RLS — fully open for the anon key -----------------------------

ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_past_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_macros        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_session_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loot_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loot_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitigation_phases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitigation_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_docs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags                   ENABLE ROW LEVEL SECURITY;

-- Replay-safe policy creation: drop then create per (table, action).
DO $$
DECLARE
  t text;
  ops text[] := ARRAY['select','insert','update','delete'];
  op text;
  policy_name text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','app_settings','schedule_past_sessions',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags'
  ]) LOOP
    FOREACH op IN ARRAY ops LOOP
      policy_name := t || '_anon_' || op;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);
      IF op = 'select' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
          policy_name, t
        );
      ELSIF op = 'insert' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)',
          policy_name, t
        );
      ELSIF op = 'update' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)',
          policy_name, t
        );
      ELSIF op = 'delete' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR DELETE TO anon, authenticated USING (true)',
          policy_name, t
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---- 7b. Realtime: REPLICA IDENTITY FULL ------------------------------
-- Without this, Supabase Realtime DELETE events only carry the primary
-- key in the payload — which means the client-side filter
-- `category_id=eq.<id>` (and similar) can't match (the column it's
-- filtering on isn't present), so the subscription doesn't fire and
-- the deleted row stays visible until reload.
--
-- REPLICA IDENTITY FULL ships the entire OLD row in DELETE events, so
-- filters on any column work as expected. Slight WAL overhead, but
-- our row sizes are small.

ALTER TABLE public.categories             REPLICA IDENTITY FULL;
ALTER TABLE public.category_links         REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings           REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_past_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.recruitment_templates  REPLICA IDENTITY FULL;
ALTER TABLE public.category_macros        REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_session_memos REPLICA IDENTITY FULL;
ALTER TABLE public.loot_items             REPLICA IDENTITY FULL;
ALTER TABLE public.loot_entries           REPLICA IDENTITY FULL;
ALTER TABLE public.mitigation_phases      REPLICA IDENTITY FULL;
ALTER TABLE public.mitigation_entries     REPLICA IDENTITY FULL;
ALTER TABLE public.strategy_docs          REPLICA IDENTITY FULL;
ALTER TABLE public.tags                   REPLICA IDENTITY FULL;

-- ---- 8. Realtime publication ------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','app_settings','schedule_past_sessions',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags'
  ]) LOOP
    BEGIN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    EXCEPTION
      WHEN duplicate_object THEN
        -- already in publication, ignore
        NULL;
    END;
  END LOOP;
END $$;

-- ---- 9. Seed initial categories ---------------------------------------

INSERT INTO public.categories (slug, name, status, sort_order) VALUES
  ('arc-heavy',       'アルカディア:ヘビー級',         '練習中', 0),
  ('arc-cruiser',     'アルカディア:クルーザー級',     '練習中', 1),
  ('arc-lightheavy',  'アルカディア:ライトヘビー級',   '未着手', 2)
ON CONFLICT (slug) DO NOTHING;
