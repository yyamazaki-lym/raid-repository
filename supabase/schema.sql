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
  -- NOTE (2026-06-11 audit): this gating is APPLICATION-LAYER ONLY (a UI
  -- show/hide convenience), NOT a security boundary. SELECT is open to anon
  -- on every table (single-tenant trust model, see file header), so anyone
  -- with the public anon key can read role-gated categories' rows + child
  -- content directly via REST/Realtime, bypassing the app-layer filter. Do
  -- NOT store group-internal secrets in role-gated categories. Making this a
  -- real boundary requires RLS role conditions (a partial walk-back of the
  -- "SELECT open to anon" design).
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
  ADD COLUMN IF NOT EXISTS fflogs_match_keywords         text[],
  -- Phase 13 (2.1 (2026-05-13)): Discord 取り込みフィルタキーワード。
  -- カテゴリごとに kind 別 (video / strategy) で別配列。Discord メッセージ本文
  -- (m.content) または抽出 URL のどちらかに、配列内のいずれかが (大小無視・
  -- 部分一致) 含まれている投稿だけを取り込む OR マッチ。
  -- 空配列 / NULL = フィルタ無効 = 従来通り全件取り込み (後方互換)。
  -- video ch では「クリア / 軽減 / 解説」、strategy ch では「軽減 / ロット /
  -- 動き」など、ch ごとのノイズ排除のために用途を分けて使う。
  ADD COLUMN IF NOT EXISTS discord_video_filter_keywords    text[],
  ADD COLUMN IF NOT EXISTS discord_strategy_filter_keywords text[],
  -- Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル表示 ON/OFF。
  -- false (default) で従来通り / 既存挙動と同じカードレイアウト。
  -- true にすると category_links.thumbnail_url が NULL でない攻略リンクの
  -- カード上部に og:image / YouTube oEmbed thumbnail を表示する。
  -- カテゴリ単位設定 (全閲覧者で共有)。動画 (kind=video) には影響しない。
  ADD COLUMN IF NOT EXISTS show_strategy_thumbnails boolean NOT NULL DEFAULT false,
  -- Phase 17 (2026-05-13): カテゴリカードから category 詳細を開いた時に
  -- 最初に着地する SubTab。カテゴリごとに「軽減表 / ロット / 攻略情報 /
  -- 動画 / マクロ」のいずれかを既定にできる。default は従来挙動の mitigation。
  ADD COLUMN IF NOT EXISTS default_tab text NOT NULL DEFAULT 'mitigation',
  -- Phase 17 (2026-05-13): SubTabs の表示 ON/OFF と任意ラベル上書き。構造は
  --   `{<tabId>: {enabled?: boolean, label?: string|null}}`
  -- key 未指定 / object 未指定 → enabled=true、label はデフォルトを使用
  -- (後方互換)。空 jsonb (= '{}') が default なので新規カテゴリは従来通り
  -- 全タブ表示 + デフォルトラベルになる。
  ADD COLUMN IF NOT EXISTS tab_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- default_tab の値域を新規追加時に絞っておく (今後タブが増えたら CHECK を
-- 拡張する)。既存行 ('mitigation' default) は当該制約を満たす。
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_default_tab_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_default_tab_check
  CHECK (default_tab IN ('mitigation','loot','strategy','videos','macros'));

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

-- Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル URL。
-- 新規追加時に server-side で og:image (kind=strategy のみ) または YouTube
-- oEmbed の thumbnail_url を取得して保存。NULL のままでも登録は妨げない
-- (Discord cron 取り込み・既存行は backfill しない)。video の表示は従来通り
-- youtubeThumbnailUrl(ytId) を使うので、このカラムは現状 strategy 用。
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Phase 15 (2.x, 2026-05-13): kind=image を追加。攻略タブで画像
-- (Supabase Storage アップロード or 外部 URL) を直接貼れるようにするための拡張。
-- インライン CHECK 制約 (CREATE TABLE 時に postgres が自動命名) を一旦
-- 落として、image を含む新制約で再定義する冪等パターン。既存行の値は
-- ('strategy','video') のみなので、新制約適用時の violate は発生しない。
-- Phase 16 (2026-05-13): kind=gphoto も追加 (Google フォト共有アルバム展開)。
ALTER TABLE public.category_links
  DROP CONSTRAINT IF EXISTS category_links_kind_check;
ALTER TABLE public.category_links
  ADD CONSTRAINT category_links_kind_check
  CHECK (kind IN ('strategy','video','image','gphoto'));

CREATE INDEX IF NOT EXISTS category_links_category_kind_idx
  ON public.category_links(category_id, kind, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_category_links ON public.category_links;
CREATE TRIGGER set_updated_at_category_links
  BEFORE UPDATE ON public.category_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 2c. category_gphoto_albums (Phase 16, 2026-05-13) ----------------
-- Google フォト共有アルバム URL を 1 件貼ると、アルバム内の全画像を
-- server-side scrape で `lh3.googleusercontent.com` 直リンクとして抽出し、
-- 個別の category_links 行 (kind='gphoto') に展開する。アルバム単位の
-- メタ (タイトル / 最終同期日 / 共有元 URL) はこのテーブルで保持し、
-- 子の category_links 行は gphoto_album_id で参照する。ON DELETE CASCADE
-- でアルバム削除時に子行を一括消去できる。直リンク 1 枚貼り
-- (lh3.googleusercontent.com 直接) は gphoto_album_id=NULL の単独行で扱う。
CREATE TABLE IF NOT EXISTS public.category_gphoto_albums (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  share_url       text NOT NULL,
  title           text,
  image_count     integer NOT NULL DEFAULT 0,
  last_synced_at  timestamptz,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS category_gphoto_albums_category_idx
  ON public.category_gphoto_albums(category_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_category_gphoto_albums
  ON public.category_gphoto_albums;
CREATE TRIGGER set_updated_at_category_gphoto_albums
  BEFORE UPDATE ON public.category_gphoto_albums
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 子の category_links に album 参照列を追加 (NULL 可)。
-- ON DELETE CASCADE: アルバム削除で子行を 1 query で一括消去する。
ALTER TABLE public.category_links
  ADD COLUMN IF NOT EXISTS gphoto_album_id uuid
    REFERENCES public.category_gphoto_albums(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS category_links_gphoto_album_idx
  ON public.category_links(gphoto_album_id)
  WHERE gphoto_album_id IS NOT NULL;

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
  start_time    text,
  end_time      text,
  day_of_week   text NOT NULL,
  status        text NOT NULL DEFAULT 'CANDIDATE'
                CHECK (status IN ('CANDIDATE','DECISION','CANCELLED')),
  note          text,
  created_by_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- TODO #2 phase 4 (2026-05-08): Vercel cron at-least-once retry の二重投稿を
-- 避けるための dedup 列。POST 成功直後に now() で埋める、cron は IS NULL の
-- 行だけ拾う。手動 button は本列を見ない (admin が再送可能)。
ALTER TABLE public.native_schedule_sessions
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
-- 2.1 (2026-05-12): Default Raid Time 変更が既存 placeholder 行に追従するよう
-- start_time / end_time を NULL 許可に変更。NULL = app_settings の
-- native_schedule_default_{start,end}_time を fallback として使用、NOT NULL
-- = 日個別の override (session-time-edit-popover で UPDATE)。
-- 既存 DB に対しては idempotent (DROP NOT NULL は重複実行で no-op)。
ALTER TABLE public.native_schedule_sessions
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time   DROP NOT NULL;
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
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- 2.1 (2026-05-12) PR3-D: メンバー全体コメント (同期式準拠で 1 メンバー = 1 行)。
-- session ごとの comment (`native_schedule_attendances.comment`) は別概念で
-- 並存する (UI 上は本コメントを優先表示し、attendances.comment は当面 UI 露出なし)。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS comment text;

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

-- ---- 5f. native_schedule_session_logs (FFLogs link、TODO #73) ---------
-- 2.5 (2026-06-10): native スケジュールの確定済 session (status='DECISION')
-- に FFLogs report URL を紐づける子テーブル。sync 側の
-- `schedule_past_session_logs` (raw_date FK) と並列の構造で、native は
-- session の UUID PK (`native_schedule_sessions.id`) を FK ターゲットに採用。
-- 別テーブル新設方針 (TODO #73 設計判断 D1) で sync/native の RLS / FK / 行
-- スキーマを明確分離する。
CREATE TABLE IF NOT EXISTS public.native_schedule_session_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  native_session_id uuid NOT NULL
                    REFERENCES public.native_schedule_sessions(id)
                    ON DELETE CASCADE,
  url               text NOT NULL,
  source            text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('auto','manual')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (native_session_id, url)
);
CREATE INDEX IF NOT EXISTS native_schedule_session_logs_session_idx
  ON public.native_schedule_session_logs(native_session_id);

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
ALTER TABLE public.category_gphoto_albums        ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE public.native_schedule_session_logs  ENABLE ROW LEVEL SECURITY;

-- Replay-safe policy creation: drop then create per (table, action).
DO $$
DECLARE
  t text;
  ops text[] := ARRAY['select','insert','update','delete'];
  op text;
  policy_name text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','category_gphoto_albums',
    'app_settings','schedule_past_sessions',
    'schedule_past_session_logs',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    'native_schedule_attendances',
    'native_schedule_session_logs'
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

-- ---- 7a. native_schedule_attendances 本人 row 例外 (TODO #2 phase 2-A) ---
-- 上の 7 章ループは admin-only policy を生成するが、出欠入力は本人が
-- 自分の行を編集する設計のため、attendances のみ self-row insert/update
-- を別名 policy で許可する。複数 policy は OR 評価されるので admin (上の
-- ループ生成) と self-row (ここで生成) のどちらか TRUE で許可される。
-- delete は admin-only のまま (本人 delete は不要 — symbol 変更で表現)。
--
-- マッチ条件: `auth.jwt() -> 'app_metadata' ->> 'discord_id' = discord_user_id`
-- discord_id claim は OAuth callback で書き込まれる (Phase 1 と同じ経路)。

DROP POLICY IF EXISTS native_schedule_attendances_self_insert
  ON public.native_schedule_attendances;
CREATE POLICY native_schedule_attendances_self_insert
  ON public.native_schedule_attendances
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'discord_id') = discord_user_id
  );

DROP POLICY IF EXISTS native_schedule_attendances_self_update
  ON public.native_schedule_attendances;
CREATE POLICY native_schedule_attendances_self_update
  ON public.native_schedule_attendances
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'discord_id') = discord_user_id
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'discord_id') = discord_user_id
  );

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
ALTER TABLE public.category_gphoto_albums        REPLICA IDENTITY FULL;
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
ALTER TABLE public.native_schedule_session_logs  REPLICA IDENTITY FULL;

-- ---- 8. Realtime publication ------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','category_gphoto_albums',
    'app_settings','schedule_past_sessions',
    'schedule_past_session_logs',
    'recruitment_templates','category_macros','schedule_session_memos',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    'native_schedule_attendances',
    'native_schedule_session_logs'
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

-- ---- 10b. Storage bucket for strategy images (Phase 15, 2026-05-13) ----
-- 攻略タブの画像エントリ (category_links kind=image) 用の public bucket。
-- 仕様は category-backgrounds と完全同型 (5MB / 画像 MIME ホワイトリスト /
-- public read / authenticated + is_admin claim のみ INSERT)。
-- path 規則: `<categoryId>/<timestamp>-<rand>.<ext>` (slug は将来変わる
-- ため UUID の categoryId を採用)。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'category-strategy-images',
  'category-strategy-images',
  true,
  5242880,  -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "category-strategy-images public read"          ON storage.objects;
DROP POLICY IF EXISTS "category-strategy-images authenticated insert" ON storage.objects;

CREATE POLICY "category-strategy-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'category-strategy-images');

CREATE POLICY "category-strategy-images authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'category-strategy-images'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
  );

-- ============================================================================
-- Section 11-13a: Sample / demo seed data — MOVED to supabase/seed-demo.sql
--
-- 旧 Section 11 (sample 7 categories) は元々 demo 用途であり、本番 fork
-- では空 portal の方が望ましい (運営者が自分のカテゴリを追加するだけ) と
-- ユーザー判断で確定 (TODO #76 follow-up, 2026-05-08)。旧 Section 12
-- (demo bulk seed) と 13a (追加コンテンツ seed) と合わせて完全に
-- seed-demo.sql 側へ集約し、本 schema.sql は DDL / RLS / extensions /
-- 必須 cron のみの純粋なスキーマ定義にする。
--
-- 旧 Section 11 INSERT で本番 fork に既に入ってしまった 7 sample
-- categories の cleanup は **本ファイルでは自動実行しない** (削除挙動が
-- 暗黙的になり既存運用を壊しうるため)。本 PR 後にユーザー側で必要に
-- 応じて手動 SQL で削除する想定 (HANDOFF.md の TODO #76 完了エントリに
-- クリーンアップ用 SQL あり)。
--
-- For demo deploy:        apply schema.sql, then seed-demo.sql
-- For production / fork:  apply schema.sql ONLY
-- ============================================================================

-- ---- 13. Hourly cron for native schedule Discord notify ----------------
-- TODO #2 候補 B (2026-05-08 案 D): Vercel Hobby cron は sub-daily 限定
-- (日 1 回以下) で、毎時 cron を含む vercel.json は build 前 reject される
-- (PR #66/#67/#68 の連続 deploy 失敗で確定、PR #69 で daily に revert 済)。
-- この制約を回避するため、毎時発火を Supabase pg_cron に逃がす。
--
-- 役割分担:
--   * pg_cron: 毎時 0 分 UTC = JST 毎時 0 分発火 (DB 内 scheduler、秒単位精度)
--   * pg_net.http_get: Vercel route URL に Bearer auth で GET (async)
--   * vault: CRON_SECRET を暗号化保管 (Vercel env と同値、ユーザーが手動登録)
--   * route 側 HH gate: getJstHour() === target hour のみ実通知
--     (`app_settings.native_schedule_discord_notify_hour`、PR #66 実装済)
--
-- 運用前提:
--   1. Supabase Dashboard → SQL Editor で
--      `SELECT vault.create_secret('<CRON_SECRET 値>', 'cron_notify_native_schedule_bearer');`
--      を 1 回だけ実行 (本セクション反映の前後どちらでも OK)
--   2. 本セクション反映で extension 自動 enable + cron job 自動登録
--   3. 確認: `SELECT * FROM cron.job WHERE jobname = 'notify-native-schedule-hourly';`

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 初回は cron.schedule、既存時は cron.alter_job で更新 (jobid 安定化、2.4 2026-06-10)。
-- 旧実装は毎回 cron.unschedule + cron.schedule で再登録していたが、GitHub Actions の
-- schema 自動再 deploy (PR #86) で main push 毎に新規 jobid が採番される副作用が判明
-- (TODO #2 24h 観察 follow-up、1 ヶ月で jobid=1→4→...→15 と 12 回切替を観測)。
-- alter_job は jobid を維持したまま schedule/command を上書きするため、観察 SQL を
-- 固定 jobid で書ける + 再 deploy 切替窓の発火欠落 (累計 6 hour 程度) も解消。
-- 毎時 0 分 UTC = JST 毎時 0 分 (JST/UTC は分単位ずれなし)。
DO $$
DECLARE
  existing_jobid bigint;
  c_schedule constant text := '0 * * * *';
  c_command constant text := $cmd$
    SELECT net.http_get(
      url := 'https://yurutto-raid-repository.vercel.app/api/cron/notify-native-schedule',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'cron_notify_native_schedule_bearer'
          LIMIT 1
        )
      ),
      timeout_milliseconds := 60000
    );
  $cmd$;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'notify-native-schedule-hourly';

  IF existing_jobid IS NULL THEN
    PERFORM cron.schedule(
      'notify-native-schedule-hourly',
      c_schedule,
      c_command
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := existing_jobid,
      schedule := c_schedule,
      command := c_command
    );
  END IF;
END $$;

-- ---- 13b. Atomic sort_order allocator RPCs (TODO #10, 2.x) ------------
-- 2.x (2026-06-09): SELECT max(sort_order)+1 → INSERT の TOCTOU で
-- 並行 insert 同士が同じ sort_order を取り得る問題があった。実害は
-- 並び順の不安定化だが、Discord cron が並列に同カテゴリの strategy /
-- video を書く場合に踏みやすい。SQL 関数化して atomic に確定する。
--
-- 戻り値はその関数呼び出し時点で割り当てるべき次の sort_order 整数。
-- 既存行が無い場合は 0 を返す (NOT NULL DEFAULT 0 と整合)。
--
-- SECURITY DEFINER で RLS を bypass するが、引数だけ参照する read-only
-- 関数なので安全。anon / authenticated に EXECUTE GRANT して server
-- action から呼び出せるようにする。
CREATE OR REPLACE FUNCTION public.next_category_sort_order()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.categories
$$;

CREATE OR REPLACE FUNCTION public.next_category_link_sort_order(
  p_category_id uuid,
  p_kind text
)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_links
  WHERE category_id = p_category_id AND kind = p_kind
$$;

GRANT EXECUTE ON FUNCTION public.next_category_sort_order() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_category_link_sort_order(uuid, text)
  TO anon, authenticated;

-- ---- 13c. sort_order allocator RPCs (TODO #83, 2.4) -------------------
-- TODO #83 (2026-06-09): `recruitment_templates` / `category_macros` の
-- INSERT パス (`recruitment-templates-client.ts` / `category-macros-client.ts`)
-- では `SELECT sort_order ORDER BY ... LIMIT 1 → +1 → INSERT` の JS 側
-- TOCTOU が残っていた。実害は表示順の不安定化のみで cron 並列書き込みは
-- 無いが、admin が複数 tab で同時に「テンプレ追加」を押す経路で衝突
-- しうるため、PR #135 と同パターンの SECURITY DEFINER RPC を追加して
-- 1 round-trip 化 + RLS の影響を受けず確実に最新 max を返せる形に揃える。
--
-- スコープ外: `loot_items` / `mitigation_phases` / `mitigation_entries` /
-- `strategy_docs` は現行 portal に対応する insert UI が存在しない
-- (schema.sql にテーブル定義のみ残る legacy) ため、JS 側 sort_order
-- race の経路自体が無い。将来これらに UI が戻る際は同パターンで
-- RPC を追加する想定。

CREATE OR REPLACE FUNCTION public.next_recruitment_template_sort_order()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.recruitment_templates
$$;

CREATE OR REPLACE FUNCTION public.next_category_macro_sort_order(
  p_category_id uuid
)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_macros
  WHERE category_id = p_category_id
$$;

GRANT EXECUTE ON FUNCTION public.next_recruitment_template_sort_order()
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_category_macro_sort_order(uuid)
  TO anon, authenticated;

-- ---- 13d. native placeholder raid time retro-update RPC (TODO #85) ----
-- 2.6 (2026-06-10): TODO #81 follow-up。`ensureNativeMonthlyPlaceholders()`
-- が auto-insert する placeholder 行は raw_date (`YYYY/MM/DD(曜) HH:MM~HH:MM`)
-- に生成時の default 時刻を焼き込む設計のため、admin が設定 dialog で
-- default 時刻を変更しても既存 placeholder は旧 default のまま残る非対称が
-- あった。本 RPC で `setNativeScheduleDefaultRaidTimeAction` の延長として
-- JST 今日 0:00 以降の未来日付 placeholder を新 default で再構成する。
--
-- 設計判断 (ユーザー確認済):
--  - 対象範囲: parsed_date >= JST 今日 0:00 のみ (過去 placeholder は履歴として温存)
--  - placeholder 判定: created_by_id IS NULL AND start_time IS NULL AND end_time IS NULL
--    (admin が CandidateDateDialog から手動追加した行は created_by_id 明示 INSERT なので除外)
--  - 衝突処理: raw_date UPDATE が UNIQUE 違反 (23505) になった場合 (= admin が
--    新 default と同 raw_date を手動追加済) は placeholder 行を DELETE して
--    手動行を温存。admin の意図 (手動追加) を尊重して上書きしない
--  - memo 同期: schedule_session_memos.raw_date は FK 制約なしの loose join
--    (raw_date は string match で参照される) のため、UPDATE 分岐で同期 UPDATE
--    する。DELETE 分岐では memo を temper せず、衝突先の手動行に紐付くまま温存
--  - SECURITY DEFINER + search_path 固定 + GRANT は authenticated のみ
--    (anon は除外、admin gate 通過済 server action 専用)。
--    ⚠ 2.9 follow-up (2026-06-12): Postgres は関数作成時にデフォルトで
--    PUBLIC へ EXECUTE を付与するため、GRANT 文だけでは anon を除外
--    できておらず、anon key だけで PostgREST RPC (/rest/v1/rpc/...) から
--    実行可能な状態だった (Supabase security advisor の実 ACL 検査で検出)。
--    下の明示 REVOKE で意図どおりに修正
--
-- per-row LOOP + EXCEPTION で衝突を捕まえる: CTE 一括 UPDATE は最初の衝突で
-- 全 ROLLBACK されるため、衝突した行だけ DELETE に分岐する PL/pgSQL LOOP を
-- 採用 (UPDATE 試行 → unique_violation catch → DELETE)。

CREATE OR REPLACE FUNCTION public.update_native_placeholder_raid_times(
  p_start_time text,
  p_end_time   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_today_jst_start timestamptz;
  v_row             record;
  v_date_prefix     text;
  v_new_raw_date    text;
  v_updated         integer := 0;
  v_deleted         integer := 0;
  v_memo_updated    integer := 0;
  v_memo_delta      integer;
BEGIN
  -- 入力 validate (HH:MM regex、start != end)。サーバー側 server action でも
  -- 同等 validate するが二重化して RPC 単体実行 (Supabase SQL Editor 等) でも
  -- 不正値を弾けるようにする。
  IF p_start_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'invalid p_start_time: %', p_start_time USING ERRCODE = '22023';
  END IF;
  IF p_end_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'invalid p_end_time: %', p_end_time USING ERRCODE = '22023';
  END IF;
  IF p_start_time = p_end_time THEN
    RAISE EXCEPTION 'start equals end' USING ERRCODE = '22023';
  END IF;

  -- JST 今日 0:00 (timestamptz)。`AT TIME ZONE 'Asia/Tokyo'` で round-trip
  -- することで「JST のカレンダー上の今日 0:00」を正確に timestamptz 化する
  -- (DST 無しなので `now() - interval '9 hours'` でも数値上は同じだが、
  -- 意図が読み取りづらいので明示的なタイムゾーン演算を採用)。
  v_today_jst_start :=
    ((now() AT TIME ZONE 'Asia/Tokyo')::date)::timestamp
      AT TIME ZONE 'Asia/Tokyo';

  FOR v_row IN
    SELECT id, raw_date
      FROM public.native_schedule_sessions
     WHERE created_by_id IS NULL
       AND start_time    IS NULL
       AND end_time      IS NULL
       AND parsed_date  >= v_today_jst_start
     ORDER BY parsed_date
  LOOP
    -- 日付 prefix `YYYY/MM/DD(曜)` を抽出。time edit popover 等で override
    -- された行は raw_date format が崩れている可能性があるが、placeholder
    -- 判定 (start_time/end_time IS NULL) でほぼ弾かれるので safety net 程度。
    v_date_prefix := substring(
      v_row.raw_date FROM '^(\d{4}/\d{2}/\d{2}\([日月火水木金土]\))'
    );
    IF v_date_prefix IS NULL THEN
      CONTINUE;
    END IF;

    v_new_raw_date := v_date_prefix || ' ' || p_start_time || '~' || p_end_time;

    -- 既に新 default と同じ raw_date になっている場合 (例: 同じ default で
    -- 連打された) は noop で次へ。
    IF v_new_raw_date = v_row.raw_date THEN
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.native_schedule_sessions
         SET raw_date = v_new_raw_date
       WHERE id = v_row.id;
      v_updated := v_updated + 1;

      -- UPDATE 成功時のみ memo 同期。loose join (FK なし) なので明示的に
      -- raw_date を追従させないと orphan 化する。複数 memo が同 raw_date
      -- を持つ可能性も考慮して UPDATE ... RETURNING COUNT(*) で件数集計。
      WITH memo_upd AS (
        UPDATE public.schedule_session_memos
           SET raw_date = v_new_raw_date
         WHERE raw_date = v_row.raw_date
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_memo_delta FROM memo_upd;
      v_memo_updated := v_memo_updated + v_memo_delta;

    EXCEPTION WHEN unique_violation THEN
      -- 衝突 (admin が新 default と同 raw_date を手動追加済の場合)。
      -- placeholder 側を DELETE して手動行を温存 (user intent 尊重)。
      -- memo は手動行に紐付くため touch しない。
      DELETE FROM public.native_schedule_sessions WHERE id = v_row.id;
      v_deleted := v_deleted + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'updated_count',      v_updated,
    'deleted_count',      v_deleted,
    'memo_updated_count', v_memo_updated
  );
END;
$func$;

-- 2.9 follow-up (2026-06-12): デフォルト PUBLIC EXECUTE を明示剥奪してから
-- authenticated にだけ再付与する (REVOKE が無いと anon が default grant 経由で
-- 実行できてしまう — 未認証で未来 placeholder の時刻書き換え / 衝突 DELETE /
-- memo 追従書き換えが可能だった)。anon は PUBLIC 経由の継承のみだが、意図の
-- 明文化として両方から剥奪する。
REVOKE EXECUTE ON FUNCTION
  public.update_native_placeholder_raid_times(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.update_native_placeholder_raid_times(text, text)
  TO authenticated;

-- ---- 13e. Warmup ping cron (2.9 follow-up, 2026-06-11) ------------------
-- ポータル全ページの Node runtime 化 (PR #181) 後、デプロイ後/アイドル後の
-- 初回アクセスに Node 関数の cold start ≒ 3.4s が残ることを実測で確認
-- (demo 実測: cold TTFB 3.84s / warm TTFB 0.40〜0.45s)。Fluid Compute の
-- インスタンスはアイドルで回収されるため、5 分毎に ping して常時 warm に保つ。
--
-- 設計判断:
--   * ping 先は `/login` — 公開パス (proxy の PUBLIC_PATHS) なので認証不要で
--     Node page 関数を実際に起動できる。`/` は未認証だと proxy (middleware) が
--     302 を返すだけで page 関数が起きないため warmup にならない。/login は
--     force-dynamic + DB アクセスなしの最軽量ページ
--   * Vercel Hobby の vercel.json cron は daily 限定 (§13 と同じ制約) なので
--     pg_cron + pg_net で組む。認証ヘッダー不要なので vault も不要
--   * 過去に撤廃した warmup (/api/health、58432aa) は全ページ Edge runtime
--     時代のもの — Node 関数を温めてもユーザーが踏むのは Edge だったため無意味
--     だった。現在はページ自体が Node なので温め先 = ユーザーが踏む関数
--   * demo Supabase にも本 schema が自動 deploy されるため、demo 側 pg_cron も
--     本番 URL を ping する (§13 の notify cron と同じ割り切り)。本番が 5 分間隔
--     ×2 系統で温まるだけで実害なし。demo 自体は温まらないが mock site なので不要
--   * デプロイ直後の最初の 1 アクセス (ping 間隔の隙間) には効かない — そこは
--     Cache Components (PPR) の静的シェル化が構造的対策 (別途調査)
DO $$
DECLARE
  existing_jobid bigint;
  c_schedule constant text := '*/5 * * * *';
  c_command constant text := $cmd$
    SELECT net.http_get(
      url := 'https://yurutto-raid-repository.vercel.app/login',
      timeout_milliseconds := 30000
    );
  $cmd$;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'warmup-portal-function';

  IF existing_jobid IS NULL THEN
    PERFORM cron.schedule(
      'warmup-portal-function',
      c_schedule,
      c_command
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := existing_jobid,
      schedule := c_schedule,
      command := c_command
    );
  END IF;
END $$;

-- ---- 14. Migration: 旧 plaintext FFLogs token / OAuth state を一掃 -----
-- 2.x (2026-06-09): `fflogs-oauth.ts` の app_settings 平文 fallback と
-- `app_settings` 経由の OAuth state 保管を撤去した。anon SELECT が全テーブル
-- 全開のため、`SECRET_ENCRYPTION_KEY` 未設定 fork で書かれた過去の plaintext
-- token が browser から見える状態だったので一括削除する。idempotent。
--
-- 該当 key:
--   - fflogs_oauth_access_token   ← 旧 plaintext fallback
--   - fflogs_oauth_refresh_token  ← 旧 plaintext fallback
--   - fflogs_session_cookie       ← 旧 plaintext fallback
--   - fflogs_oauth_state_pending  ← cookie 化により app_settings には書かれない
DELETE FROM public.app_settings
  WHERE key IN (
    'fflogs_oauth_access_token',
    'fflogs_oauth_refresh_token',
    'fflogs_session_cookie',
    'fflogs_oauth_state_pending'
  );
