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
  ADD COLUMN IF NOT EXISTS first_clear_at               timestamptz,
  -- Phase 8 (1.9.7): expected FFLogs zone IDs for this content. When set,
  -- the FFLogs auto-link feature only matches reports whose zone.id is in
  -- this array — eliminates wrong-content matches when multiple raids
  -- happen on the same date. Empty / NULL = fall back to fuzzy bilingual
  -- group matching. Find zone IDs from any FFLogs report URL of that
  -- content (the report's zone field in the API response).
  ADD COLUMN IF NOT EXISTS expected_fflogs_zone_ids      integer[],
  -- Phase 9 (TODO #17, 1.9 (2026-04-28)): optional background image URL
  -- shown behind each card on /category. Free-form `text` URL — http(s)
  -- only at the UI layer (`safeHref`). NULL = no background image (default).
  ADD COLUMN IF NOT EXISTS background_image_url          text,
  -- Phase 10 (TODO #19, 2.0 (2026-04-28)): per-category Discord role gating.
  -- When NULL or empty array, the category is visible to all guild members.
  -- When non-empty, only users whose `auth.users.app_metadata.discord_roles`
  -- contains at least one of these IDs can see / open the category.
  -- Role IDs are Discord snowflakes (text) fetched via the bot from
  -- `GET /guilds/{id}/roles` and selected in the category edit dialog.
  ADD COLUMN IF NOT EXISTS required_role_ids             text[],
  -- Phase 11 (TODO #26, 2.1 (2026-04-29)): free-form 説明文 (description)。
  -- 例: 「絶バハムート討滅戦 — TODO」「LH 級零式 — 8 月から練習開始」。
  -- カテゴリ詳細ページのヘッダー下に短文として表示。
  ADD COLUMN IF NOT EXISTS description                   text,
  -- Phase 11 (TODO #25, 2.1 (2026-04-29)): 手動入力のクリアまでの累計時間。
  -- 動画 duration_seconds が NULL のままで自動計算が成立しない場合の
  -- 上書き値。`Hourglass` 表示は `manual_time_to_clear_seconds ?? 自動計算`
  -- の優先度で参照する。
  ADD COLUMN IF NOT EXISTS manual_time_to_clear_seconds  integer,
  -- Phase 12 (TODO #45, 2.1 (2026-04-29)): FFLogs auto-link 用カスタム
  -- マッチワード。CONTENT_GROUPS の標準キーワード (例: 「ライトヘビー級」
  -- 「M3S」「LH 級」) でも分類できないユーザー独自の report タイトル
  -- (例: 「4 層しょーか」「LH しょか」「練習会」) を強制マッチさせる
  -- ためのエスケープ弁。配列内のいずれかの文字列が report の
  -- title / zoneName に含まれていれば、cross-group reject を override
  -- して score=0 (確信マッチ) として扱う。部分一致 + 大文字小文字無視。
  -- 空配列 / NULL = 従来挙動。
  ADD COLUMN IF NOT EXISTS fflogs_match_keywords         text[];

-- NOTE: category_links / schedule_past_sessions の logs_url_source ALTER
-- は、それぞれ該当 CREATE TABLE 直後に移動済 (新規 fork で table 未作成
-- 時に ALTER が失敗するのを回避、TODO #8 fix, 2.1 (2026-05-01))。

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

-- 2.1 (2026-04-30) TODO #47: per-link favorite flag. Lets the videos page
-- expose a "★お気に入りのみ" filter and a star toggle on each card.
-- Strategy links don't surface this in the UI yet but the column lives
-- on the shared table for symmetry.
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

-- Phase 8.1 (1.9.10): track whether category_links.logs_url was set by
-- automated FFLogs sync ('auto') or by manual user edit ('manual'). This
-- lets the sync re-run safely: only 'auto' values are wiped before
-- re-matching, while user-curated 'manual' overrides are preserved.
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS logs_url_source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.category_links
  DROP CONSTRAINT IF EXISTS category_links_logs_url_source_check;
ALTER TABLE public.category_links
  ADD CONSTRAINT category_links_logs_url_source_check
  CHECK (logs_url_source IN ('auto','manual'));

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

-- Widen the source CHECK constraint to allow 'snapshot' on existing
-- deployments where the table was created with the old 2-value list.
ALTER TABLE public.schedule_past_sessions
  DROP CONSTRAINT IF EXISTS schedule_past_sessions_source_check;
ALTER TABLE public.schedule_past_sessions
  ADD CONSTRAINT schedule_past_sessions_source_check
  CHECK (source IN ('discord','manual','snapshot'));

-- ---- 5d. schedule_past_session_logs (multi-URL per date) ------------
-- TODO #64 (2.1, 2026-05-02 part5): replaces the legacy
-- `schedule_past_sessions.logs_url` (single text) + `logs_url_source`
-- pair with a child table that supports multiple FFLogs URLs per
-- session date. `source` distinguishes 'auto' (inserted by the FFLogs
-- sync action `linkReportsToSessions`) from 'manual' (added via the
-- memo popover editor).
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

-- One-shot migration: fold legacy logs_url + logs_url_source columns
-- into rows. Idempotent guard via information_schema so re-runs after
-- the column DROP below are safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'schedule_past_sessions'
       AND column_name = 'logs_url'
  ) THEN
    INSERT INTO public.schedule_past_session_logs (raw_date, url, source)
    SELECT raw_date, logs_url,
           COALESCE(NULLIF(logs_url_source, ''), 'manual')
      FROM public.schedule_past_sessions
     WHERE logs_url IS NOT NULL
    ON CONFLICT (raw_date, url) DO NOTHING;
  END IF;
END $$;

-- Drop legacy columns + their CHECK constraint. Idempotent.
ALTER TABLE public.schedule_past_sessions
  DROP CONSTRAINT IF EXISTS schedule_past_sessions_logs_url_source_check;
ALTER TABLE public.schedule_past_sessions
  DROP COLUMN IF EXISTS logs_url,
  DROP COLUMN IF EXISTS logs_url_source;

-- ---- 5e. native schedule (TODO #2 phase 1, 2026-05-07) ---------------
-- 自前スケジュール用テーブル。`app_settings.schedule_source_mode='native'`
-- のときだけ参照される (sync='character-sheets', disabled='機能停止')。
-- 設計詳細:
-- - raw_date を sync 互換 format ("YYYY/MM/DD(曜) HH:MM~HH:MM") にして
--   `schedule_session_memos` / `schedule_past_session_logs` を共用可能に。
-- - mode 切替は `app_settings.schedule_source_mode` の 1 行 update のみ。
--   両方のデータは破壊せず残置 (sync↔native 往復で履歴を失わない)。
-- - メンバー識別子は Discord OAuth `app_metadata.discord_id` を採用。
--   portal 内発番は導入しない (= 二重管理の罠を避ける)。
-- - phase 1 では SELECT skeleton のみ実装、INSERT/UPDATE は phase 2 以降。

CREATE TABLE IF NOT EXISTS public.native_schedule_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_date      text NOT NULL UNIQUE,
  parsed_date   timestamptz NOT NULL,
  start_time    text NOT NULL,
  end_time      text NOT NULL,
  day_of_week   text NOT NULL,
  status        text NOT NULL DEFAULT 'CANDIDATE'
                CHECK (status IN ('CANDIDATE','DECISION','CANCELLED')),
  note          text,
  created_by_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS native_schedule_sessions_date_idx
  ON public.native_schedule_sessions(parsed_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_native_schedule_sessions
  ON public.native_schedule_sessions;
CREATE TRIGGER set_updated_at_native_schedule_sessions
  BEFORE UPDATE ON public.native_schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.native_schedule_members (
  discord_user_id text PRIMARY KEY,
  display_name    text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_native_schedule_members
  ON public.native_schedule_members;
CREATE TRIGGER set_updated_at_native_schedule_members
  BEFORE UPDATE ON public.native_schedule_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.native_schedule_attendances (
  session_id      uuid NOT NULL
                  REFERENCES public.native_schedule_sessions(id) ON DELETE CASCADE,
  discord_user_id text NOT NULL
                  REFERENCES public.native_schedule_members(discord_user_id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  comment         text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, discord_user_id)
);
CREATE INDEX IF NOT EXISTS native_schedule_attendances_session_idx
  ON public.native_schedule_attendances(session_id);

DROP TRIGGER IF EXISTS set_updated_at_native_schedule_attendances
  ON public.native_schedule_attendances;
CREATE TRIGGER set_updated_at_native_schedule_attendances
  BEFORE UPDATE ON public.native_schedule_attendances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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

-- ---- 7. RLS — SELECT 解放 / 書き込みは admin (is_admin claim) のみ ----
-- TODO #36 phase 1 (2.1, 2026-04-29): 書き込みを `TO authenticated` に。
-- TODO #36 phase 2 (2.1, 2026-04-29): さらに `auth.jwt()->>is_admin` を
--   WITH CHECK に組み込み、RLS 層でも admin role を要求する。
--
--   設計:
--   - SELECT: anon + authenticated 解放 (Realtime / 公開読み取り温存)
--   - INSERT/UPDATE/DELETE: authenticated かつ
--     `auth.jwt()->'app_metadata'->>'is_admin' = 'true'` のときのみ通す
--   - is_admin は OAuth callback で `DISCORD_ADMIN_ROLE_IDS` env と
--     `discord_roles` の交差で計算され、`auth.users.app_metadata.is_admin`
--     に書き込まれる。Supabase が JWT を発行する際 app_metadata 全体が
--     claim として同梱される。
--   - 環境変数未設定時は `userIsAdmin()` が `true` を返すので backward
--     compat (= 既存運用は変わらない)。
--
--   既存 user の JWT が古い (is_admin claim 無し) 場合、RLS は false 扱
--   いで write を deny する。1 時間以内の auto-refresh で claim が乗っ
--   てくる、もしくはサインアウト → 再ログインで即時解決。
--
-- アプリ層の admin role 制限 (`assertAdminResult`) は Server Action の
-- 入口で引き続きかかる (三重防御: proxy gate / app admin gate / RLS)。
--
-- dev bypass 環境 (`DEV_AUTH_BYPASS=true`) では Supabase auth session を
-- 持たないため、`createClient()` 側で `SUPABASE_SERVICE_ROLE_KEY` 経由
-- の service role client に切替えて RLS をバイパスする。production では
-- `NODE_ENV=production` でこの分岐は走らない。

ALTER TABLE public.categories                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_links                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_past_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_past_session_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_macros               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_session_memos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loot_items                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loot_entries                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitigation_phases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mitigation_entries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_docs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_schedule_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_schedule_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_schedule_attendances   ENABLE ROW LEVEL SECURITY;

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
    'schedule_past_session_logs',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    'native_schedule_attendances'
  ]) LOOP
    FOREACH op IN ARRAY ops LOOP
      policy_name := t || '_anon_' || op;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);
      IF op = 'select' THEN
        -- SELECT は anon にも開放: Realtime subscribe や server-side
        -- 公開読み取り (next-session.ts 等) を壊さないため。
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
          policy_name, t
        );
      ELSIF op = 'insert' THEN
        -- 書き込みは authenticated + is_admin claim (TODO #36 phase 2)。
        -- `auth.jwt() -> 'app_metadata' ->> 'is_admin'` は text なので
        -- 文字列 'true' と比較。NULL の場合 (claim 無し) は deny。
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
          policy_name, t
        );
      ELSIF op = 'update' THEN
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
          policy_name, t
        );
      ELSIF op = 'delete' THEN
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
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

ALTER TABLE public.categories                    REPLICA IDENTITY FULL;
ALTER TABLE public.category_links                REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings                  REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_past_sessions        REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_past_session_logs    REPLICA IDENTITY FULL;
ALTER TABLE public.recruitment_templates         REPLICA IDENTITY FULL;
ALTER TABLE public.category_macros               REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_session_memos        REPLICA IDENTITY FULL;
ALTER TABLE public.loot_items                    REPLICA IDENTITY FULL;
ALTER TABLE public.loot_entries                  REPLICA IDENTITY FULL;
ALTER TABLE public.mitigation_phases             REPLICA IDENTITY FULL;
ALTER TABLE public.mitigation_entries            REPLICA IDENTITY FULL;
ALTER TABLE public.strategy_docs                 REPLICA IDENTITY FULL;
ALTER TABLE public.tags                          REPLICA IDENTITY FULL;
ALTER TABLE public.native_schedule_sessions      REPLICA IDENTITY FULL;
ALTER TABLE public.native_schedule_members       REPLICA IDENTITY FULL;
ALTER TABLE public.native_schedule_attendances   REPLICA IDENTITY FULL;

-- ---- 8. Realtime publication ------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','app_settings','schedule_past_sessions',
    'schedule_past_session_logs',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    'native_schedule_attendances'
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

-- ---- 9. Migration: cleanup 旧 seed (TODO #8 follow-up, 2026-05-01) ----
-- 当初 (1.x 系) は `arc-heavy` / `arc-cruiser` / `arc-lightheavy` の 3 件を
-- name=`アルカディア:〜` で seed していたが、Section 11 で導入した
-- `arcadion-heavy` (name=`至天の座アルカディア：ヘビー級`) と内容が重複し
-- 始めたため、`arcadion-*` に統合する方針に変更。
--
-- 安全策: name が **旧 seed の初期値のまま** (= ユーザー編集が入っていない)
-- 行のみ削除。カスタマイズ済の name の行は意図的に残置 (誤削除防止)。
-- 旧 seed の categories には子テーブル参照が無いので CASCADE 影響なし。
DELETE FROM public.categories
WHERE slug IN ('arc-heavy','arc-cruiser','arc-lightheavy')
  AND name IN (
    'アルカディア:ヘビー級',
    'アルカディア:クルーザー級',
    'アルカディア:ライトヘビー級'
  );

-- ---- 9.5. Secrets table (TODO #35, 2.1) -----------------------------
-- 機密値 (FFLogs session cookie / OAuth access+refresh token 等) を
-- AES-256-GCM で暗号化して保管する専用テーブル。アプリ側で encrypt
-- してから INSERT、SELECT 後に decrypt する仕組み。
--
-- 旧設計では `app_settings` に平文で保存していたが、当 repo は RLS
-- が `USING (true)` で全開なため anon key を持つ任意のユーザーが
-- `SELECT value FROM app_settings WHERE key='fflogs_session_cookie'`
-- で盗聴可能だった (HANDOFF security TODO #35)。
--
-- このテーブルは RLS で anon を完全 deny にし、書き込みは service
-- role 経由 (server-side) のみ。SELECT も service role 必須なので、
-- ブラウザ JS から ciphertext すら触れない設計。
CREATE TABLE IF NOT EXISTS secrets (
  key text PRIMARY KEY,
  -- ciphertext は base64 + IV + auth tag を `iv:tag:ciphertext` 形式
  -- (各 base64) で連結したものを保存。アプリ側で解釈する。
  encrypted_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "secrets deny all anon" ON secrets;
-- anon (含 authenticated 一般) を完全に拒否。service role はそもそも
-- RLS をバイパスする (Postgres superuser 相当) ので server からは
-- 読み書き可能。
CREATE POLICY "secrets deny all anon"
  ON secrets FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---- 10. Storage bucket for category background images ---------------
-- Phase 9 (TODO #17 follow-up, 1.9 (2026-04-28)): public bucket so the
-- category card edit dialog can upload local images and the resulting
-- public URL is stored in `categories.background_image_url`.
--
-- TODO #34 強化 (2.1, 2026-04-29):
-- - `file_size_limit = 5MB` を bucket レベルで強制 (anon insert で
--   多量データを送られるのを RLS では無く storage 層で弾く)
-- - `allowed_mime_types` に画像系のみ許可 (`image/svg+xml` は XSS
--   ベクタになり得るので除外)
-- - anon UPDATE / DELETE policy を撤去。ユーザー UI に消去操作は
--   無く、攻撃者が anon key で他人の画像を消すリスクを排除。
--   再アップロード = 別 path (`{Date.now()}-{rand}.{ext}`) なので
--   UPDATE 不要。古い画像のクリーンアップは admin Server Action で
--   別途実装する想定 (現状はオブジェクトストレージに残置でも害なし)。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'category-backgrounds',
  'category-backgrounds',
  true,
  5242880,  -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "category-backgrounds public read"          ON storage.objects;
DROP POLICY IF EXISTS "category-backgrounds anon insert"          ON storage.objects;
DROP POLICY IF EXISTS "category-backgrounds anon update"          ON storage.objects;
DROP POLICY IF EXISTS "category-backgrounds anon delete"          ON storage.objects;
DROP POLICY IF EXISTS "category-backgrounds authenticated insert" ON storage.objects;

CREATE POLICY "category-backgrounds public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'category-backgrounds');

-- TODO #36 phase 1 (2.1, 2026-04-29): INSERT は authenticated のみ。
-- TODO #36 phase 2 (2.1, 2026-04-29): さらに is_admin claim も要求。
-- Discord OAuth callback で `is_admin` が true で書かれたユーザー
-- (= DISCORD_ADMIN_ROLE_IDS のロール持ち) のみアップロード可能。
CREATE POLICY "category-backgrounds authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'category-backgrounds'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  );
-- NOTE: anon UPDATE / anon DELETE は撤去 (TODO #34)。anon INSERT も
-- TODO #36 phase 1 で削除して authenticated 限定にした。古い画像の
-- クリーンアップは将来 admin Server Action で対応 (現状は新 path 別名
-- でアップロード→旧画像はオブジェクトストレージに残置)。

-- ---- 11. Sample seed categories (idempotent) -------------------------
-- TODO #8 (2.1, 2026-05-01): 新規 fork 直後の空 portal だと使い方が掴み
-- にくいため、サンプルカテゴリ 5 件を投入する。実コンテンツ名 (現行零式
-- + Variant + Extreme + Ultimate 2 件) を入れて status 4 種類を一通り
-- カバー。ON CONFLICT (slug) DO NOTHING で既存値は上書きしないので、
-- 再実行・編集後の再 apply でも安全。
-- 全データ初期化 (TODO #23) で削除した後に schema.sql を再実行すれば
-- 復活する = リカバリ手段としても機能。
INSERT INTO public.categories (slug, name, status, sort_order) VALUES
  ('arcadion-heavy',            '至天の座アルカディア：ヘビー級',         '練習中',   10),
  ('arcadion-cruiser',          '至天の座アルカディア：クルーザー級',     '練習中',   11),
  ('arcadion-lightheavy',       '至天の座アルカディア：ライトヘビー級',   '未着手',   12),
  ('variant-shokyaku',          '異聞商客物語',                           '未着手',   20),
  ('extreme-cloud-of-darkness', '滅暗闇の雲激闘戦',                       'クリア済', 30),
  ('ultimate-omega-protocol',   '絶オメガ検証戦',                         '未着手',   40),
  ('ultimate-futures-rewritten','絶もうひとつの未来',                     '休止中',   50)
ON CONFLICT (slug) DO NOTHING;

-- ---- 12. Demo data bulk seed (TODO #8 part C-ii, 2.1 (2026-05-01)) ----
-- モックサイト見栄え用の demo data 一括投入。Section 11 のサンプル 5
-- カテゴリ (arcadion-heavy / variant-shokyaku / extreme-cloud-of-darkness
-- / ultimate-omega-protocol / ultimate-futures-rewritten) に紐付ける形で
-- 残り 10 テーブル (category_links / loot_items / loot_entries /
-- mitigation_phases / mitigation_entries / strategy_docs / category_macros
-- / recruitment_templates / tags / schedule_past_sessions /
-- schedule_session_memos / app_settings) に bulk insert する。
--
-- 設計方針 (TODO #8 で承認済):
--   - 実 fork でも seed は走る (mockup と実運用の差別化はしない)
--   - 誤って入った場合は TODO #23「全データ初期化」ボタンで一括削除可能
--   - 冪等: app_settings の sentinel `demo_seed_applied=1` で 2 回目以降スキップ
--   - 全データ初期化で app_settings 行も消えるので、init 直後の再 schema
--     apply で復活する = リカバリ手段として動作

DO $$
DECLARE
  v_arc uuid;  -- arcadion-heavy (練習中)
  v_var uuid;  -- variant-shokyaku (未着手)
  v_ext uuid;  -- extreme-cloud-of-darkness (クリア済)
  v_omg uuid;  -- ultimate-omega-protocol (未着手)
  v_fru uuid;  -- ultimate-futures-rewritten (休止中)
  v_phase uuid;
  v_item uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'demo_seed_applied') THEN
    RAISE NOTICE 'Demo seed already applied — skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_arc FROM public.categories WHERE slug = 'arcadion-heavy';
  SELECT id INTO v_var FROM public.categories WHERE slug = 'variant-shokyaku';
  SELECT id INTO v_ext FROM public.categories WHERE slug = 'extreme-cloud-of-darkness';
  SELECT id INTO v_omg FROM public.categories WHERE slug = 'ultimate-omega-protocol';
  SELECT id INTO v_fru FROM public.categories WHERE slug = 'ultimate-futures-rewritten';

  IF v_arc IS NULL OR v_var IS NULL OR v_ext IS NULL OR v_omg IS NULL OR v_fru IS NULL THEN
    RAISE NOTICE 'Section 11 sample categories missing — skipping demo seed.';
    RETURN;
  END IF;

  -- ---- 12.1 categories: enrich existing 5 rows ----
  UPDATE public.categories SET
    description = '現行零式・週固定運営。LH 級コンプリート後の継続コンテンツ。',
    fflogs_match_keywords = ARRAY['ヘビー','heavy','M5S','M6S','M7S','M8S']
  WHERE id = v_arc;

  UPDATE public.categories SET
    description = '8 名 PT 用の異聞 raid。武器は出ないが防具・素材狙いで周回中。',
    fflogs_match_keywords = ARRAY['異聞','商客','variant']
  WHERE id = v_var;

  UPDATE public.categories SET
    description = '極コンテンツ — 撃破済。武器目当てに不定期周回。',
    first_clear_at = '2026-02-18T22:14:30+09:00',
    manual_time_to_clear_seconds = 18000,
    fflogs_match_keywords = ARRAY['暗闇の雲','cloud of darkness']
  WHERE id = v_ext;

  UPDATE public.categories SET
    description = '絶級コンテンツ。次クール本格挑戦予定、現在は事前学習フェーズ。',
    fflogs_match_keywords = ARRAY['オメガ','omega protocol','TOP']
  WHERE id = v_omg;

  UPDATE public.categories SET
    description = '絶級コンテンツ — メンバー復帰待ちで一時休止中。',
    manual_time_to_clear_seconds = 144000,
    fflogs_match_keywords = ARRAY['もうひとつの未来','futures rewritten','FRU']
  WHERE id = v_fru;

  -- ---- 12.2 category_links: strategy (12 件) ----
  INSERT INTO public.category_links (category_id, kind, title, url, description, sort_order, source) VALUES
    (v_arc, 'strategy', 'M5S 攻略 wiki',           'https://example.com/strategy/m5s',           '基本ギミック解説',          0, 'manual'),
    (v_arc, 'strategy', 'M6S 散開図',              'https://example.com/strategy/m6s-pos',       'デバフ散開位置の図解',      1, 'manual'),
    (v_arc, 'strategy', 'M7S タイムライン',         'https://example.com/strategy/m7s-tl',        '軽減合わせ用 TL',           2, 'manual'),
    (v_var, 'strategy', '異聞商客物語 攻略まとめ',   'https://example.com/strategy/variant',       'ルート分岐込み',            0, 'manual'),
    (v_var, 'strategy', '異聞 ボス挙動表',           'https://example.com/strategy/variant-boss',  '',                          1, 'manual'),
    (v_ext, 'strategy', '極暗闇の雲 攻略',           'https://example.com/strategy/cot',           '基本散開のみ',              0, 'manual'),
    (v_ext, 'strategy', '極暗闇の雲 マクロまとめ',   'https://example.com/strategy/cot-macros',    '',                          1, 'manual'),
    (v_omg, 'strategy', '絶オメガ検証戦 全体像',     'https://example.com/strategy/top-overview',  'P1〜P6 概要',               0, 'manual'),
    (v_omg, 'strategy', '絶オメガ P3 PROTEAN',      'https://example.com/strategy/top-p3',        '個別フェーズ詳細',          1, 'manual'),
    (v_omg, 'strategy', '絶オメガ DPS チェック',     'https://example.com/strategy/top-dps',       '',                          2, 'manual'),
    (v_fru, 'strategy', '絶もうひとつの未来 攻略',    'https://example.com/strategy/fru',           '基本ギミック解説',          0, 'manual'),
    (v_fru, 'strategy', 'FRU タイムライン',          'https://example.com/strategy/fru-tl',        '軽減合わせ',                1, 'manual');

  -- ---- 12.3 category_links: video (25 件) ----
  -- YouTube ID は demo placeholder。実 fork ではアップロード時に上書きされる想定。
  INSERT INTO public.category_links (category_id, kind, title, url, logs_url, description, sort_order, source, duration_seconds, posted_at, is_favorite) VALUES
    (v_arc, 'video', '【M5S】初回挑戦 / 2026-04-08',     'https://www.youtube.com/watch?v=demoARC01aaa', 'https://www.fflogs.com/reports/demoARC01aaaaaa', '', 0, 'discord', 7200,  '2026-04-08T22:30:00+09:00', false),
    (v_arc, 'video', '【M5S】2026-04-15',                 'https://www.youtube.com/watch?v=demoARC02aaa', 'https://www.fflogs.com/reports/demoARC02aaaaaa', '', 1, 'discord', 8100,  '2026-04-15T22:30:00+09:00', false),
    (v_arc, 'video', '【M6S】2026-04-22 デバフ確認',       'https://www.youtube.com/watch?v=demoARC03aaa', 'https://www.fflogs.com/reports/demoARC03aaaaaa', '練習回',                       2, 'discord', 9300,  '2026-04-22T22:30:00+09:00', true),
    (v_arc, 'video', '【M6S】2026-04-29 後半詰め',         'https://www.youtube.com/watch?v=demoARC04aaa', 'https://www.fflogs.com/reports/demoARC04aaaaaa', '',                              3, 'discord', 8700,  '2026-04-29T22:30:00+09:00', false),
    (v_arc, 'video', '【M7S】お試し見学会',                'https://www.youtube.com/watch?v=demoARC05aaa', NULL,                                              '雑談多め',                     4, 'manual',  4200,  '2026-04-26T21:00:00+09:00', false),
    (v_arc, 'video', '【M5S】クリア / 2026-04-30',         'https://www.youtube.com/watch?v=demoARC06aaa', 'https://www.fflogs.com/reports/demoARC06aaaaaa', '初クリア',                     5, 'discord', 6500,  '2026-04-30T22:30:00+09:00', true),
    (v_var, 'video', '【異聞】Aルート 2026-04-12',         'https://www.youtube.com/watch?v=demoVAR01aaa', NULL,                                              '',                              0, 'discord', 5400,  '2026-04-12T20:00:00+09:00', false),
    (v_var, 'video', '【異聞】Bルート 2026-04-19',         'https://www.youtube.com/watch?v=demoVAR02aaa', NULL,                                              'B 経由 ノーミス',              1, 'discord', 4800,  '2026-04-19T20:00:00+09:00', true),
    (v_var, 'video', '【異聞】Cルート 2026-04-26',         'https://www.youtube.com/watch?v=demoVAR03aaa', NULL,                                              '',                              2, 'discord', 5100,  '2026-04-26T20:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】初回見学 2026-02-04',       'https://www.youtube.com/watch?v=demoEXT01aaa', 'https://www.fflogs.com/reports/demoEXT01aaaaaa', '',                              0, 'discord', 3600,  '2026-02-04T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】2026-02-11',                'https://www.youtube.com/watch?v=demoEXT02aaa', 'https://www.fflogs.com/reports/demoEXT02aaaaaa', '',                              1, 'discord', 4500,  '2026-02-11T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】クリア 2026-02-18',          'https://www.youtube.com/watch?v=demoEXT03aaa', 'https://www.fflogs.com/reports/demoEXT03aaaaaa', '初クリア記念',                 2, 'discord', 3900,  '2026-02-18T22:14:30+09:00', true),
    (v_ext, 'video', '【極暗闇】武器周回 2026-03-04',        'https://www.youtube.com/watch?v=demoEXT04aaa', NULL,                                              '',                              3, 'manual',  2700,  '2026-03-04T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】武器周回 2026-03-25',        'https://www.youtube.com/watch?v=demoEXT05aaa', NULL,                                              '',                              4, 'manual',  2400,  '2026-03-25T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】予習会 2026-04-05',        'https://www.youtube.com/watch?v=demoOMG01aaa', 'https://www.fflogs.com/reports/demoOMG01aaaaaa', 'P1 のみ',                      0, 'discord', 9600,  '2026-04-05T22:00:00+09:00', true),
    (v_omg, 'video', '【絶オメガ】P1 詰め 2026-04-12',        'https://www.youtube.com/watch?v=demoOMG02aaa', 'https://www.fflogs.com/reports/demoOMG02aaaaaa', '',                              1, 'discord', 10200, '2026-04-12T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P2 突入 2026-04-19',        'https://www.youtube.com/watch?v=demoOMG03aaa', 'https://www.fflogs.com/reports/demoOMG03aaaaaa', '',                              2, 'discord', 11400, '2026-04-19T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P3 PROTEAN 2026-04-26',     'https://www.youtube.com/watch?v=demoOMG04aaa', 'https://www.fflogs.com/reports/demoOMG04aaaaaa', '事故あり',                     3, 'discord', 10800, '2026-04-26T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】予習動画 解説',            'https://www.youtube.com/watch?v=demoOMG05aaa', NULL,                                              '事前学習用',                   4, 'manual',  1800,  '2026-04-01T12:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P4 突入 2026-04-29',        'https://www.youtube.com/watch?v=demoOMG06aaa', 'https://www.fflogs.com/reports/demoOMG06aaaaaa', '',                              5, 'discord', 11700, '2026-04-29T22:00:00+09:00', true),
    (v_fru, 'video', '【FRU】P1 詰め 2026-01-14',            'https://www.youtube.com/watch?v=demoFRU01aaa', 'https://www.fflogs.com/reports/demoFRU01aaaaaa', '',                              0, 'discord', 11400, '2026-01-14T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】P2 突入 2026-01-28',            'https://www.youtube.com/watch?v=demoFRU02aaa', 'https://www.fflogs.com/reports/demoFRU02aaaaaa', '',                              1, 'discord', 12000, '2026-01-28T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】P3 詰め 2026-02-11',            'https://www.youtube.com/watch?v=demoFRU03aaa', 'https://www.fflogs.com/reports/demoFRU03aaaaaa', '',                              2, 'discord', 11700, '2026-02-11T22:00:00+09:00', true),
    (v_fru, 'video', '【FRU】P4 ULTIMATE RELATIVITY',       'https://www.youtube.com/watch?v=demoFRU04aaa', 'https://www.fflogs.com/reports/demoFRU04aaaaaa', '休止前 最終練習',              3, 'discord', 12600, '2026-02-25T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】解説動画',                      'https://www.youtube.com/watch?v=demoFRU05aaa', NULL,                                              '',                              4, 'manual',  2700,  '2026-01-10T12:00:00+09:00', false);

  -- ---- 12.4 loot_items + loot_entries ----
  -- Helper: loot を category 1 つにつき主要装備スロット軸で投入。
  -- entries は status 4 種類 (次優先 / 辞退 / 取得済 / 未定) を均等にローテ。

  -- arcadion-heavy: 8 items
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_arc, 'M5S 詩学耳飾り',   '耳', 0),
    (v_arc, 'M5S 詩学首飾り',   '首', 1),
    (v_arc, 'M6S 詩学腕輪',     '腕', 2),
    (v_arc, 'M6S 詩学指輪',     '指', 3),
    (v_arc, 'M7S 詩学頭防具',   '頭', 4),
    (v_arc, 'M7S 詩学胴防具',   '胴', 5),
    (v_arc, 'M8S 詩学武器',     '武器', 6),
    (v_arc, 'M8S 詩学脚防具',   '脚', 7);

  -- arcadion: entries (item ごとに 2 名)
  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_arc ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'アルファ', '次優先', NULL),
      (v_item, 'ブラボー', '未定',   NULL);
  END LOOP;

  -- 数件だけ取得済 / 辞退に変える (見栄え)
  UPDATE public.loot_entries SET status = '取得済', note = '2026-04-08 取得'
    WHERE player_name = 'アルファ'
      AND loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc AND sort_order IN (0, 2));
  UPDATE public.loot_entries SET status = '辞退'
    WHERE player_name = 'ブラボー'
      AND loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc AND sort_order = 4);

  -- variant: 装備出ないが報酬枠 2 件
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_var, '異聞商客物語 鞄飾り', 'その他', 0),
    (v_var, '異聞商客物語 称号',   'その他', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_var ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'チャーリー', '次優先', NULL),
      (v_item, 'デルタ',     '未定',   NULL);
  END LOOP;

  -- extreme: 武器 1 / マウント 1 / マテリア 2 = 4 items
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_ext, '極暗闇の雲 武器',         '武器', 0),
    (v_ext, '極暗闇の雲 マウント',     'マウント', 1),
    (v_ext, '極暗闇の雲 ペット',       'ペット',   2),
    (v_ext, '極暗闇の雲 オーケストリオン', 'その他', 3);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_ext ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'エコー',   '次優先', NULL),
      (v_item, 'フォックス', '取得済', '2026-02-18 初クリア時');
  END LOOP;

  -- ultimate-omega-protocol: 武器 + マウント
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_omg, '絶オメガ検証戦 武器', '武器',     0),
    (v_omg, '絶オメガ マウント',   'マウント', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_omg ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'ゴルフ', '次優先', NULL),
      (v_item, 'ホテル', '未定',   NULL);
  END LOOP;

  -- ultimate-futures-rewritten: 武器 + マウント
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_fru, '絶もうひとつの未来 武器',   '武器',     0),
    (v_fru, '絶もうひとつの未来 マウント', 'マウント', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_fru ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'アルファ',   '次優先', NULL),
      (v_item, 'チャーリー', '辞退',   '休止中');
  END LOOP;

  -- ---- 12.5 mitigation_phases + mitigation_entries ----
  -- arcadion-heavy: 4 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P1 開幕', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:08',  'オートアタック',     '全員',   'リプライザル', '',                       0),
    (v_phase, '0:30',  '全体攻撃 (中)',     'WHM',    'テンパランス', '',                       1),
    (v_phase, '0:55',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2),
    (v_phase, '1:20',  '全体攻撃 (大)',     'SCH',    '陣',           '',                       3),
    (v_phase, '1:45',  'デバフ散開',         '全員',   '個人軽減',     'マクロ参照',             4);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P2 移動フェーズ', 1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:10',  '線取り',             'タンク', 'インビン後',   '',                       0),
    (v_phase, '2:35',  '塔処理',             'DPS',    '個人軽減',     '',                       1),
    (v_phase, '2:55',  '全体攻撃',           'AST',    'マクロコスモス', 'ノクターン重ね',       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P3 中ギミック', 2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:20',  'ノックバック',       '全員',   'ステップ無敵', '',                       0),
    (v_phase, '3:50',  '頭割り',             'WHM',    'アサイラム',   '',                       1),
    (v_phase, '4:15',  '塔割り',             'SCH',    'セラフィム',   'WHM とローテ',           2),
    (v_phase, '4:40',  '全体大ダメージ',     'PLD',    '迅速 + パッセージ', '',                  3);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P4 詰め', 3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '5:00',  'エンレイジ前 大攻撃', 'AST',    'ホロスコープ', '',                       0),
    (v_phase, '5:20',  '頭割り',             'SCH',    '陣',           '',                       1),
    (v_phase, '5:45',  '全員集合',           '全員',   'ファイト or フライト', '',               2),
    (v_phase, '6:00',  'エンレイジ',         '-',      '-',            '撃破ライン',             3);

  -- variant: 1 phase 簡易
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_var, 'ボス戦全体', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  '範囲攻撃',           'WHM',    'テンパランス', '',                       0),
    (v_phase, '1:10',  'タンクスワップ',     'タンク', 'インビン交代', '',                       1),
    (v_phase, '1:50',  'ルート分岐確認',     '全員',   '-',            'ボス HP で判定',         2);

  -- extreme-cloud-of-darkness: 2 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_ext, 'P1 通常戦', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:25',  '全体攻撃',           'WHM',    'アサイラム',   '',                       0),
    (v_phase, '1:00',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       1),
    (v_phase, '1:35',  '頭割り',             'SCH',    '陣',           '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_ext, 'P2 LB チェック', 1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:10',  '全体大ダメージ',     'AST',    'マクロコスモス', 'LB3 重ね',             0),
    (v_phase, '2:40',  'エンレイジ確認',     '-',      '-',            '',                       1);

  -- ultimate-omega-protocol: 6 phase 概形
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P1 通常',         0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  '全体攻撃',           'WHM',    'アサイラム',   '',                       0),
    (v_phase, '1:00',  '頭割り',             'SCH',    '陣',           '',                       1),
    (v_phase, '1:30',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P2 OMEGA',        1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:00',  'PROGRAM LOOP',       'AST',    'ホロスコープ', '',                       0),
    (v_phase, '2:30',  'CRITICAL ERROR',     '全員',   '個人軽減',     '',                       1),
    (v_phase, '3:00',  '全体攻撃',           'WHM',    'アサイラム',   '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P3 PROTEAN',      2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:30',  'PROTEAN WAVE',       '全員',   '個人軽減',     '',                       0),
    (v_phase, '4:00',  'STORAGE VIOLATION',  'SCH',    '陣',           '',                       1),
    (v_phase, '4:30',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P4 通常',         3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '5:00',  '全体攻撃',           'AST',    'マクロコスモス', '',                     0),
    (v_phase, '5:30',  '頭割り',             'WHM',    'テンパランス', '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P5 BLUE SCREEN',  4) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '6:00',  'BLUE SCREEN',        '全員',   'LB3',          '',                       0),
    (v_phase, '6:30',  '全体大ダメージ',     'SCH',    'セラフィム',   '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P6 詰め',         5) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '7:00',  'エンレイジ前',       'AST',    'ホロスコープ', '',                       0),
    (v_phase, '7:30',  'エンレイジ',         '-',      '-',            '',                       1);

  -- ultimate-futures-rewritten: 5 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P1 FATEBREAKER',          0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  'BURNT STRIKE',       'PLD',    'シェルトロン', '',                       0),
    (v_phase, '1:00',  'POWDER MARK TRAIL',  '全員',   '個人軽減',     '',                       1),
    (v_phase, '1:30',  '全体攻撃',           'WHM',    'アサイラム',   '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P2 USURPER OF FROST',     1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:00',  'DIAMOND DUST',       'AST',    'マクロコスモス', '',                     0),
    (v_phase, '2:30',  '頭割り',             'SCH',    '陣',           '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P3 OPTIONAL',             2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:00',  'INTERMISSION',       '-',      '-',            '休憩',                   0);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P4 ULTIMATE RELATIVITY',  3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '4:00',  'RELATIVITY',         '全員',   '個人軽減',     '',                       0),
    (v_phase, '4:30',  '頭割り',             'WHM',    'テンパランス', '',                       1),
    (v_phase, '5:00',  '全体大ダメージ',     'AST',    'ホロスコープ', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P5 PANDORA',              4) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '6:00',  'PANDORA',            '全員',   'LB3',          'エンレイジ前',           0);

  -- ---- 12.6 strategy_docs ----
  INSERT INTO public.strategy_docs (category_id, title, body_md, updated_by_name) VALUES
    (v_arc, 'M5S 攻略メモ',
     E'# M5S 攻略メモ\n\n## 散開位置\n- 北 MT / 南 ST\n- 東西 D1〜D4\n\n## 軽減タイムライン\n- 0:30 全体: WHM テンパ\n- 1:20 全体大: SCH 陣 + LB2 確認\n\n## 注意点\n- ノックバック前にステップ無敵を切らさない\n- デバフ散開時のマクロは pinned 参照',
     'アルファ'),
    (v_var, '異聞商客物語 ルート分岐',
     E'# 異聞商客物語\n\n## ルート選択\n- HP 50% 時の挙動でルート判定\n  - A: ボス左移動 = 武器ルート\n  - B: ボス右移動 = 防具ルート\n  - C: 中央維持 = 素材ルート\n\n## 注意\n- 8 名 PT 専用、IL シンク確認\n- 初手は B 推奨 (火力チェックゆるい)',
     'チャーリー'),
    (v_ext, '極暗闇の雲 攻略 (撃破済)',
     E'# 極暗闇の雲 — クリア済\n\n## 散開\n- 北 MT / 南 ST\n- D1〜D4 時計回り\n\n## クリア時編成\n- PLD / WAR / WHM / SCH / DRG / SAM / BRD / SMN\n\n## 武器周回時の覚え書き\n- 火力チェックは余裕、軽減は P2 LB3 重ねのみ意識すれば安定',
     'エコー'),
    (v_omg, '絶オメガ検証戦 全体ノート',
     E'# 絶オメガ検証戦\n\n## フェーズ概要\n1. P1: 通常 (1:30 まで)\n2. P2: OMEGA (2:00〜)\n3. P3: PROTEAN (3:30〜)\n4. P4: 通常 (5:00〜)\n5. P5: BLUE SCREEN (6:00〜)\n6. P6: 詰め (7:00〜エンレイジ 7:30)\n\n## 現状\n- P3 PROTEAN まで安定、P4 突入直後で事故多め\n- 次回練習会で P4 詰め予定',
     'ゴルフ'),
    (v_fru, '絶もうひとつの未来 休止前メモ',
     E'# FRU 休止前メモ\n\n## 進捗\n- P4 ULTIMATE RELATIVITY 詰め中で休止\n- メンバー復帰後は P4 から再開\n\n## 引き継ぎ\n- 軽減タイムラインは pinned 参照\n- 散開図は最新版が strategy リンクの 1 番目',
     'アルファ');

  -- ---- 12.7 category_macros ----
  INSERT INTO public.category_macros (category_id, label, body, sort_order) VALUES
    (v_arc, 'カウントダウン',  E'/cd 5\n/p 開始します！軽減合わせをお願いします。', 0),
    (v_arc, '散開位置',         E'/p 【M5S 散開】\n/p 北 MT / 南 ST / 東西 D1〜D4\n/p デバフ散開はマクロ参照', 1),
    (v_var, 'カウントダウン',   E'/cd 5\n/p 異聞 開始します！', 0),
    (v_var, 'ルート選択',       E'/p ルート: B (防具)\n/p HP 50% で判定', 1),
    (v_ext, 'カウントダウン',   E'/cd 5\n/p 極 行きまーす', 0),
    (v_ext, 'LB3 タイミング',   E'/p P2 全体大ダメージで LB3\n/p 1:50 軽減合わせ', 1),
    (v_omg, 'カウントダウン',   E'/cd 5\n/p 絶 突入', 0),
    (v_omg, 'P3 散開',          E'/p 【P3 PROTEAN】\n/p 1MT / 2ST / 3D1 / 4D2 / 5D3 / 6D4 / 7H1 / 8H2', 1),
    (v_fru, 'カウントダウン',   E'/cd 5\n/p FRU 行きます', 0),
    (v_fru, 'P4 散開',          E'/p 【P4 ULTIMATE RELATIVITY】\n/p 散開図参照、軽減 4:00', 1);

  -- ---- 12.8 recruitment_templates ----
  INSERT INTO public.recruitment_templates (category_id, label, body, sort_order) VALUES
    (v_arc, '週固定 募集',
     E'【M5S〜M8S 週固定 募集】\n曜日: 火/木 22:00-24:00\nIL: 760 以上\nボイチャ: Discord 必須\n進捗: M5S 安定 / M6S 中ギミックまで\nDM 歓迎', 0),
    (v_var, '異聞 単発募集',
     E'【異聞商客物語 単発】\n日時: 今晩 21:00 〜\n人数: 8 名\nルート: B 経由\nIL: 740 以上\n初見歓迎、攻略事前読み込みお願いします', 0),
    (v_ext, '極 武器周回 募集',
     E'【極暗闇の雲 武器周回】\n気軽に 1 戦だけでも OK\n曜日: 不定 (Discord で告知)\n初見歓迎', 0),
    (v_omg, '絶オメガ 練習会',
     E'【絶オメガ 練習会 募集】\n曜日: 土 22:00-25:00\n進捗: P3 PROTEAN 練習中\nIL: 770 以上\n予習必須 (解説動画 link 共有あり)', 0),
    (v_fru, 'FRU 復帰待ち',
     E'【FRU 復帰メンバー募集】\n現在休止中、メンバー復帰待ち\n進捗: P4 ULTIMATE RELATIVITY\n復帰目処が立ったメンバーから DM ください', 0);

  -- ---- 12.9 tags ----
  INSERT INTO public.tags (target_type, target_id, label, color, created_by_name) VALUES
    ('category', v_arc, '現行零式',   'amber', 'アルファ'),
    ('category', v_arc, '週固定',     'sky',   'アルファ'),
    ('category', v_var, '8 名 PT',    'violet','チャーリー'),
    ('category', v_ext, 'クリア済',   'emerald','エコー'),
    ('category', v_omg, '絶級',       'rose',  'ゴルフ'),
    ('category', v_fru, '休止中',     'slate', 'アルファ'),
    ('strategy_doc',     (SELECT id FROM public.strategy_docs WHERE category_id = v_arc LIMIT 1), '最新版', 'amber', 'アルファ'),
    ('strategy_doc',     (SELECT id FROM public.strategy_docs WHERE category_id = v_omg LIMIT 1), 'WIP',    'rose',  'ゴルフ'),
    ('mitigation_entry', (SELECT id FROM public.mitigation_entries WHERE phase_id IN (SELECT id FROM public.mitigation_phases WHERE category_id = v_arc) ORDER BY created_at LIMIT 1), '要確認', 'rose', 'ブラボー'),
    ('loot_item',        (SELECT id FROM public.loot_items WHERE category_id = v_arc ORDER BY sort_order LIMIT 1), '次回優先', 'amber', 'アルファ'),
    ('loot_entry',       (SELECT id FROM public.loot_entries WHERE loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc) ORDER BY created_at LIMIT 1), 'ロット権', 'sky', 'アルファ');

  -- ---- 12.10 schedule_past_sessions (16 件 / 過去 8 週 × 週 2) ----
  -- 火曜 + 木曜の 22:00-24:00 を 8 週分。最も古い日 (2026-03-05) → 直近 (2026-04-30)
  INSERT INTO public.schedule_past_sessions (raw_date, parsed_date, start_time, end_time, day_of_week, source, attendances, user_names, logs_url, logs_url_source) VALUES
    ('2026/03/03 (火)', '2026-03-03T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"×","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/05 (木)', '2026-03-05T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"×","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"×"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/10 (火)', '2026-03-10T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH01aaaaaa', 'auto'),
    ('2026/03/12 (木)', '2026-03-12T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"×","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"×","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/17 (火)', '2026-03-17T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"×","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH02aaaaaa', 'auto'),
    ('2026/03/19 (木)', '2026-03-19T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"×","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/24 (火)', '2026-03-24T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH03aaaaaa', 'auto'),
    ('2026/03/26 (木)', '2026-03-26T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"×","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/31 (火)', '2026-03-31T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH04aaaaaa', 'auto'),
    ('2026/04/02 (木)', '2026-04-02T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"×","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/07 (火)', '2026-04-07T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH05aaaaaa', 'auto'),
    ('2026/04/09 (木)', '2026-04-09T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"×","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/14 (火)', '2026-04-14T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH06aaaaaa', 'auto'),
    ('2026/04/16 (木)', '2026-04-16T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/21 (火)', '2026-04-21T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH07aaaaaa', 'auto'),
    ('2026/04/23 (木)', '2026-04-23T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/28 (火)', '2026-04-28T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH08aaaaaa', 'auto'),
    ('2026/04/30 (木)', '2026-04-30T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH09aaaaaa', 'auto')
  ON CONFLICT (raw_date) DO NOTHING;

  -- ---- 12.11 schedule_session_memos ----
  INSERT INTO public.schedule_session_memos (raw_date, body, author_name) VALUES
    ('2026/04/30 (木)', 'M5S 初クリアおめでとうございます！次は M6S 練習に切替えます。', 'アルファ'),
    ('2026/04/30 (木)', '次回 22:00 開始、軽減 TL を pinned に更新済',                  'チャーリー'),
    ('2026/04/28 (火)', 'M5S 安定したので来週からはスキップ可',                          'ブラボー'),
    ('2026/04/23 (木)', '21:30 に Discord ボイチャ集合、開始 22:00',                     'アルファ'),
    ('2026/04/16 (木)', 'メンバー全員出席ありがとう！',                                  'エコー'),
    ('2026/04/09 (木)', 'M6S 練習回。デバフ散開要復習',                                  'デルタ'),
    ('2026/04/02 (木)', 'チャーリー欠席連絡あり。代理あり (ホテル)',                      'アルファ'),
    ('2026/03/24 (火)', 'M5S 初突入！ボイス確認お願いします',                            'アルファ');

  -- ---- 12.12 app_settings ----
  -- schedule_url の placeholder + sentinel
  INSERT INTO public.app_settings (key, value) VALUES
    ('schedule_url',        'https://character-sheets.appspot.com/schedule/list?key=demoplaceholder'),
    ('demo_seed_applied',   '1')
  ON CONFLICT (key) DO NOTHING;

  RAISE NOTICE 'Demo seed applied — categories=5, links=37, loot_items=18, mitigation_phases=20, mitigation_entries~=60, strategy_docs=5, macros=10, recruit_templates=5, tags=11, past_sessions=18, memos=8.';

END $$;

-- ---- 13. 追加コンテンツ seed (TODO #8 follow-up, 2.1 (2026-05-01)) ----
-- ユーザー指定の追加リンク。Section 12 の demo seed sentinel に依存せず、
-- URL ベース NOT EXISTS guard で冪等 (重複 INSERT 回避)。Section 11 で
-- 新規追加した arcadion-cruiser / arcadion-lightheavy は Section 12 の
-- demo data 対象外なので、本ブロックがそれらの最初のコンテンツ投入を担う。

DO $$
DECLARE
  v_arc      uuid;
  v_cruiser  uuid;
  v_lh       uuid;
BEGIN
  SELECT id INTO v_arc     FROM public.categories WHERE slug = 'arcadion-heavy';
  SELECT id INTO v_cruiser FROM public.categories WHERE slug = 'arcadion-cruiser';
  SELECT id INTO v_lh      FROM public.categories WHERE slug = 'arcadion-lightheavy';

  -- arcadion-heavy: 動画 + 攻略
  IF v_arc IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_arc, 'video', 'M5S〜M8S 解説動画', 'https://www.youtube.com/watch?v=ZHoZ5981rPg', 'manual', 99
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_arc AND url = 'https://www.youtube.com/watch?v=ZHoZ5981rPg'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_arc, 'strategy', 'FFXIV パッチ 7.4 公式 — ヘビー級', 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_4/', 'manual', 99
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_arc AND url = 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_4/'
    );
  END IF;

  -- arcadion-cruiser: 動画 + 攻略
  IF v_cruiser IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_cruiser, 'video', 'クルーザー級 解説動画', 'https://www.youtube.com/watch?v=X4rIEOt6Wl8', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_cruiser AND url = 'https://www.youtube.com/watch?v=X4rIEOt6Wl8'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_cruiser, 'strategy', 'FFXIV パッチ 7.2 公式 — クルーザー級', 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_2/', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_cruiser AND url = 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_2/'
    );
  END IF;

  -- arcadion-lightheavy: 動画 + 攻略
  IF v_lh IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_lh, 'video', 'ライトヘビー級 解説動画', 'https://www.youtube.com/watch?v=aSU-swmCxVM', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_lh AND url = 'https://www.youtube.com/watch?v=aSU-swmCxVM'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_lh, 'strategy', 'FFXIV: 黄金のレガシー 公式', 'https://jp.finalfantasyxiv.com/dawntrail/', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_lh AND url = 'https://jp.finalfantasyxiv.com/dawntrail/'
    );
  END IF;
END $$;
