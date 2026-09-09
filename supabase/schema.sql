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

-- ⚠ `SET search_path` を固定する (2026-09-09、Supabase lint
-- `function_search_path_mutable`)。トリガー関数は呼び出し元のロールの
-- search_path で走るため、固定しないと同名の関数・型を先に解決される
-- (`now()` を差し替えられる) 余地が残る。この関数は SECURITY INVOKER だが、
-- 全テーブルの updated_at を書く共通経路なので閉じておく。
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
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
  -- 2026-08-30: 軽減表の「層タブ」手動登録 (JSON 配列 [{label,gid}])。
  -- 公開設定によっては pubhtml / htmlview からワークシート一覧を取得
  -- できない (取得できても Google のマークアップ変更で壊れる) ため、
  -- admin が層ごとの gid を登録できる経路を正とし、自動検出は補助に
  -- 落とす。空 / NULL なら従来どおり自動検出のみ。
  ADD COLUMN IF NOT EXISTS mitigation_sheet_tabs        text,
  -- 2026-08-30: 軽減表のチェックボックス列に付ける名前。見出しがアイコン
  -- 画像だけの列は CSV に文字が出ないため自動では名前を付けられない。
  -- 形は {"<gid>": {"<列番号>": "堅陣"}} (層ごとに列構成が違うため gid 別)。
  ADD COLUMN IF NOT EXISTS mitigation_column_labels     text,
  -- 2026-08-30: 練習ログの取り込み難易度フィルタ。FFLogs の difficulty は
  -- コンテンツ種別で値が変わる (零式とノーマルで別値) が、公開された
  -- 対応表が無いため **観測値をそのまま使う**: 取り込み済みの difficulty を
  -- 画面に出し、admin が「これ未満は入れない」を数値で決める。NULL = 無効。
  ADD COLUMN IF NOT EXISTS fflogs_min_difficulty        integer,
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
  -- 2026-09-03: 背景画像を **カードのどの位置で見せるか** (焦点)。カードは
  -- 横長で画像は object-cover で切り取られるため、既定の中央固定では
  -- 「出したい部分が切れる」(実機要望)。CSS の object-position に渡す
  -- 0-100 の % で保持する。NULL = 50 (中央) なので既存行の見た目は不変。
  -- style に入る値なので値域は下の CHECK でも縛る (整数 0-100 のみ)。
  ADD COLUMN IF NOT EXISTS background_pos_x              smallint,
  ADD COLUMN IF NOT EXISTS background_pos_y              smallint,
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

-- ---- W-33 ① (2026-09-07): 難易度軸と進行モデルを名前から切り離す --------
--
-- 練習ログはこれまで **カテゴリ名の文字列マッチ**だけで挙動を決めていた
-- (`isUltimateContent` → フェーズ管理 / `isSavageContent` → 4 層構成)。
-- 8.0「白銀のワンダラー」(2027-01) はノーマルと零式の中間の新難易度が入り、
-- 2026-09 時点で **正式名称が未発表** (調査ノート第 4 回 5-2)。名前が
-- 分からないものは辞書に足せないので、新難易度のカテゴリを作った瞬間に
-- 表示が崩れる。
--
-- 対策は **enum を増やさず設定値で吸収する** (調査ノートの W-33 の判断):
--   difficulty_label … 表示用の自由記述 (「零式」「絶」「新難易度 (仮)」)。
--                      空なら従来どおり名前から推測して出す。
--   progress_model   … 'auto' (名前から推測 = 従来) / 'floors' / 'phases'。
-- 8.0 の名前が判明したら content-groups.ts の辞書に足せば 'auto' で通る。
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS difficulty_label text,
  ADD COLUMN IF NOT EXISTS progress_model text NOT NULL DEFAULT 'auto';

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_progress_model_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_progress_model_check
  CHECK (progress_model IN ('auto','floors','phases'));

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_difficulty_label_sane;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_difficulty_label_sane
  CHECK (
    difficulty_label IS NULL
    OR (char_length(difficulty_label) <= 24 AND difficulty_label !~ '[[:cntrl:]]')
  ) NOT VALID;

-- default_tab の値域を新規追加時に絞っておく (今後タブが増えたら CHECK を
-- 拡張する)。既存行 ('mitigation' default) は当該制約を満たす。
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_default_tab_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_default_tab_check
  CHECK (default_tab IN ('mitigation','loot','strategy','videos','macros','logs'));

-- 背景画像の焦点 (2026-09-03) は 0-100 の整数のみ。NULL は「未設定 = 中央」。
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_background_pos_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_background_pos_check
  CHECK (
    (background_pos_x IS NULL OR background_pos_x BETWEEN 0 AND 100)
    AND (background_pos_y IS NULL OR background_pos_y BETWEEN 0 AND 100)
  ) NOT VALID;

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

-- 2026-07-12 監査 B-1: kind 先頭の複合 index。TOP 描画の
-- buildSessionVideoLinkMap (kind='video' + posted_at 範囲 or IS NULL) と
-- 日次 fflogs-sync の対象抽出 (kind='video' + logs_url IS NULL) は
-- category_id で絞らないため、上の (category_id, kind, ...) 複合では効かず
-- 最大成長テーブルを seq scan していた。`.or(and(gte,lte),is.null)` は
-- BitmapOr で範囲枝 / NULL 枝の両方に本 index が使える。
CREATE INDEX IF NOT EXISTS category_links_kind_posted_at_idx
  ON public.category_links(kind, posted_at);

-- A-5.1 (2026-06-13): (category_id, kind, url) の UNIQUE 制約。
-- Discord cron 取り込みの dedupe が SELECT→INSERT で非原子的なため、
-- cron × 手動「Import now」の競合で同一 URL が二重挿入され得た
-- (discord-import.ts を upsert(onConflict, ignoreDuplicates) に変更して
-- 原子的に冪等化する。その土台となる制約)。
-- ⚠ UNIQUE は NOT VALID にできず、既存重複があると ADD CONSTRAINT が失敗する。
--   先に重複を 1 行へ圧縮する (各グループで最小 ctid を残す。重複行は
--   category_id/kind/url が同一なので、どの行を残しても参照内容は変わらない)。
--   制約適用後は重複が発生し得ないため、この DELETE は再デプロイ時には 0 行
--   (= 冪等な no-op)。本番では適用時に 1 行のみ圧縮 (asphodelos の手動二重登録)。
DELETE FROM public.category_links a
  USING public.category_links b
 WHERE a.category_id = b.category_id
   AND a.kind        = b.kind
   AND a.url         = b.url
   AND a.ctid        > b.ctid;
ALTER TABLE public.category_links
  DROP CONSTRAINT IF EXISTS category_links_category_kind_url_key;
ALTER TABLE public.category_links
  ADD CONSTRAINT category_links_category_kind_url_key
  UNIQUE (category_id, kind, url);

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

-- ---- 2d. category_discord_blocklist (2026-06-15) ----------------------
-- Discord 自動取り込み (cron / 手動「Discord 取込」) で **skip する URL** の
-- リスト。動画/攻略リンクを「削除」しても dedup は URL の在不在だけを見るため
-- (discord-import.ts §3)、Discord メッセージが残る限り次の取り込みで復活する。
-- ここに URL を登録すると取り込み処理 (service role) が当該 URL を除外する。
--
-- これは公開コンテンツではない運用情報なので、汎用 RLS ループ (第 7 章、SELECT
-- を anon に全開) には **入れず**、secrets と同様に当章で個別 policy を張る
-- (read/write 共に is_admin claim のみ、anon deny)。取り込み処理は service role
-- で読むため RLS をバイパスする。
CREATE TABLE IF NOT EXISTS public.category_discord_blocklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  url         text NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 同一カテゴリへの同一 URL の重複登録を防ぐ。再デプロイ安全のため
-- DROP IF EXISTS → ADD の対で書く (2b の UNIQUE と同型)。
ALTER TABLE public.category_discord_blocklist
  DROP CONSTRAINT IF EXISTS category_discord_blocklist_category_url_key;
ALTER TABLE public.category_discord_blocklist
  ADD CONSTRAINT category_discord_blocklist_category_url_key
  UNIQUE (category_id, url);

-- 2026-07-12 監査 B-4: 単独 (category_id) index は UNIQUE(category_id, url)
-- の先頭列が包含するため冗長 — 削除 (過去デプロイ分の掃除、再適用は no-op)。
DROP INDEX IF EXISTS public.category_discord_blocklist_category_idx;

ALTER TABLE public.category_discord_blocklist ENABLE ROW LEVEL SECURITY;

-- read/write 共に admin (is_admin claim) のみ。anon は TO 句に含めないので
-- policy にマッチせず 0 行 = deny。service role は RLS bypass = 取り込み処理は
-- 影響を受けない。is_admin 検査式は category_links 等 (第 7 章) と同一。
-- 2026-07-12 監査 B-3: `auth.jwt()` を `(SELECT auth.jwt() ...)` に包み
-- per-row → per-statement 評価 (initPlan キャッシュ、Supabase lint
-- auth_rls_initplan と同型)。意味は等価。
DROP POLICY IF EXISTS category_discord_blocklist_admin_select
  ON public.category_discord_blocklist;
CREATE POLICY category_discord_blocklist_admin_select
  ON public.category_discord_blocklist
  FOR SELECT TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true');

DROP POLICY IF EXISTS category_discord_blocklist_admin_insert
  ON public.category_discord_blocklist;
CREATE POLICY category_discord_blocklist_admin_insert
  ON public.category_discord_blocklist
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true');

DROP POLICY IF EXISTS category_discord_blocklist_admin_delete
  ON public.category_discord_blocklist;
CREATE POLICY category_discord_blocklist_admin_delete
  ON public.category_discord_blocklist
  FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true');

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
-- viewer (read は anon 含め全員)。
-- 書込は「ログイン済みメンバーなら誰でも」(admin 限定ではない): 汎用ループの
-- admin policy に加えて 7a-2 で authenticated 全体に INSERT/UPDATE/DELETE を
-- 開放している (所有者カラムを持たない共有メモ。総合レビュー A-4)。anon は
-- read-only。本番は proxy で全 viewer が認証済みメンバー = 実質「全員編集可」。

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

-- TODO #92 / 2026-08-05 監査 M-1 (2026-09-09 にユーザー決定で保留解除):
-- **メモに所有者を持たせる。**
--
-- それまでは 7a-2 の member policy が `USING (true)` で、**非 admin メンバー
-- 1 人が PostgREST 直叩き 1 リクエストで全メモを削除・改竄できた**
-- (`DELETE /rest/v1/schedule_session_memos?id=neq.<uuid>`。ローカル PG16 で
-- 3 件全消しを実測再現)。UI は 1 件ずつしか消せないので誰がやったかも残らない。
-- Supabase の advisor も同じ箇所を `rls_policy_always_true` として警告した。
--
-- ⚠ **`author_name` は所有者ではない。** あれは localStorage 由来の表示名で、
-- 誰でも好きな名前を書ける。所有者判定に使ってはいけない。
--
-- ⚠ 値は **Discord ID** (`app_metadata.discord_id`)。この repo の本人判定は
-- 全部これで、7a の出欠 self-row policy と同じキーになる。
--
-- ⚠ DEFAULT に **subquery は書けない**ので `auth.jwt()` を直接呼ぶ
-- (ポリシー側は `(SELECT auth.jwt())` に包む — lint auth_rls_initplan)。
-- これで client は列を送らなくても自分の ID が入る。送ってきた場合も
-- INSERT の WITH CHECK が自分の ID 以外を弾く。
ALTER TABLE public.schedule_session_memos
  ADD COLUMN IF NOT EXISTS author_user_id text
  DEFAULT (auth.jwt() -> 'app_metadata' ->> 'discord_id');
-- ⚠ **既存行は NULL のまま**。移行期は admin だけが触れる (誰の物か
-- 分からない行を他人に消させない)。埋め戻しはしない — `author_name` から
-- 推測すると別人の物を渡す危険がある。
CREATE INDEX IF NOT EXISTS schedule_session_memos_author_idx
  ON public.schedule_session_memos(author_user_id);

-- 2026-07-12 監査 B-5: 本テーブルは 7a-2 の member policy で **非 admin の
-- authenticated 全員が INSERT/UPDATE 可能** なのに length CHECK が無く、
-- PostgREST 直叩きで巨大 body / 異常 author_name を注入できた
-- (category_macros / recruitment_templates の監査 #253 と同クラスの残存)。
-- body はメモ本文で改行を含むため長さのみ、author_name は単一行の表示名
-- なので制御文字も弾く。
--
-- ⚠ NOT VALID は既存行の一括検証をスキップするだけで、その行を **次に
-- UPDATE する時には CHECK が効く**。違反 legacy 行が残っていると
-- 無関係なカラムだけの UPDATE (例: update_native_placeholder_raid_times の
-- memo raw_date 同期) が失敗し RPC 全体を abort しうる。ADD の前に
-- 一回きりの丸め cleanup を入れる (A-5.1 の dedupe DELETE と同じ先例。
-- 通常は WHERE で 0 行 = 冪等 no-op、違反行があるときだけ丸める)。
UPDATE public.schedule_session_memos
   SET body = left(body, 4000)
 WHERE char_length(body) > 4000;
UPDATE public.schedule_session_memos
   SET author_name = left(regexp_replace(author_name, '[[:cntrl:]]', '', 'g'), 100)
 WHERE char_length(author_name) > 100 OR author_name ~ '[[:cntrl:]]';
ALTER TABLE public.schedule_session_memos
  DROP CONSTRAINT IF EXISTS schedule_session_memos_text_sane;
ALTER TABLE public.schedule_session_memos
  ADD CONSTRAINT schedule_session_memos_text_sane
  CHECK (
    char_length(body) <= 4000
    AND char_length(author_name) <= 100
    AND author_name !~ '[[:cntrl:]]'
  ) NOT VALID;

-- 2026-09-07 (UI-3): 重要度。日付メモが平坦な時系列で「今夜必ず直すこと」と
-- 「参考情報」が同じ見た目で並んでいたので、3 段階のラベルを付けて並び替え /
-- 絞り込みできるようにする (調査ノート第 4 回 8-3 UI-3)。
--
-- 既定は 'none' (未設定)。既存メモに後から 'medium' を割り当てると、ただの
-- 連絡が全部「注意」の色で並んで色の意味が薄れる。重要度は付けたい人が
-- 付けるものにして、付いていないメモは今までと同じ見た目のままにする。
ALTER TABLE public.schedule_session_memos
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'none';
-- 想定外の値が入った行があれば既定へ丸めてから CHECK を張る (text_sane の
-- 先例と同じ順。通常は 0 行 = 冪等 no-op)。
UPDATE public.schedule_session_memos
   SET severity = 'none'
 WHERE severity NOT IN ('none', 'major', 'medium', 'minor');
ALTER TABLE public.schedule_session_memos
  DROP CONSTRAINT IF EXISTS schedule_session_memos_severity_valid;
ALTER TABLE public.schedule_session_memos
  ADD CONSTRAINT schedule_session_memos_severity_valid
  CHECK (severity IN ('none', 'major', 'medium', 'minor')) NOT VALID;

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

-- 監査バッチC #14 (2026-06-24): body は UI に大きく表示される領域で、admin
-- 信頼モデル下でも巨大ペイロード / 異常長を防ぐため length CHECK を入れる
-- (native_schedule_attendances の symbol/comment と同方針)。⚠ body は FF14
-- チャットマクロ (/p ... の複数行) で改行を含むため、制御文字は弾かず長さのみ
-- 制限する。label は短い単一行のサブ名。既存行は満たすが安全のため NOT VALID
-- で追加し新規 write のみ検証する。
ALTER TABLE public.category_macros
  DROP CONSTRAINT IF EXISTS category_macros_text_sane;
ALTER TABLE public.category_macros
  ADD CONSTRAINT category_macros_text_sane
  CHECK (char_length(body) <= 8000 AND char_length(label) <= 200) NOT VALID;

-- UI-7 (2026-09-08): 「採用中」の印。複数のマクロ (層ごと / 攻略サイトごと)
-- が並ぶとき、**うちが使っているのはどれか**が画面から分からなかった
-- (調査ノート第 4 回 8-3 UI-7)。
--
-- ⚠ **1 コンテンツに 1 本だけ**を DB で保証する (部分 UNIQUE index)。
-- 「採用中が 2 本」は表示が壊れるだけでなく、差分表示の基準が決まらない。
-- 切り替えは Server Action が「同カテゴリの他を false → 対象を true」の
-- 順で更新する (逆順だと一瞬 2 本になって index に弾かれる)。
ALTER TABLE public.category_macros
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS category_macros_current_uidx
  ON public.category_macros (category_id)
  WHERE is_current;

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

-- 監査バッチC #14 (2026-06-24): category_macros と同様に body / label の
-- length CHECK。body は募集文で改行を含むため制御文字は弾かず長さのみ。NOT VALID。
ALTER TABLE public.recruitment_templates
  DROP CONSTRAINT IF EXISTS recruitment_templates_text_sane;
ALTER TABLE public.recruitment_templates
  ADD CONSTRAINT recruitment_templates_text_sane
  CHECK (char_length(body) <= 8000 AND char_length(label) <= 200) NOT VALID;

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

-- 2.9 (2026-08-24): 「実施しなかったのに記録された過去日程」を過去ログから
-- 外すための除外マーカー (ユーザー要望: 取り消し忘れで記録された日を消す)。
--
-- なぜ DELETE ではなく列マーカーなのか:
--   (a) 行を消すと `schedule_past_session_logs` の FK ON DELETE CASCADE で
--       手動紐づけした FFLogs URL まで巻き添えになる (再入力でしか復旧不能)
--   (b) 消しても翌日の snapshot cron (21:50 JST) が char-sheets の DECISION 行
--       を再 UPSERT し、Discord 取り込みも同じ raw_date を再 insert しうるため
--       「消したのに翌朝復活する」(category_discord_blocklist を導入したのと
--       同型の問題)。excluded_at は snapshot / import の書き込み payload に
--       含まれないため上書きされず、除外が永続する
--   (c) 解除 (NULL 戻し) で出席スナップショットも FFLogs URL もそのまま復帰
--
-- 表示側は `fetchStoredPastSessions()` が `excluded_at IS NULL` で絞る。
-- 除外された raw_date は「実開催の証拠なし」扱いになるので、char-sheets 由来
-- の過去行も `mergeStoredPastSessions` の verified 判定から落ちて消える。
--
-- native mode (`native_schedule_sessions`) 側は status='CANCELLED' が同じ役割を
-- 果たすため、この列は sync mode 専用。
ALTER TABLE public.schedule_past_sessions
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz;

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
-- 2026-07-12 監査 B-4: 単独 (raw_date) index は UNIQUE(raw_date, url) の
-- 先頭列が包含するため冗長 — 削除 (過去デプロイ分の掃除、再適用は no-op)。
DROP INDEX IF EXISTS public.schedule_past_session_logs_raw_date_idx;

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

-- 2026-07-12 監査 B-5: note の app 層 200 字制限
-- (updateNativeScheduleSessionNoteAction) を DB 層でも担保。NOT VALID。
-- ⚠ 違反 legacy 行を後続 UPDATE (last_notified_at 書き込みの通知 cron /
-- status トグル / raw_date 同期 RPC) が abort しうるため、ADD 前に丸める
-- (通常は 0 行 = 冪等)。
UPDATE public.native_schedule_sessions
   SET note = left(note, 200)
 WHERE note IS NOT NULL AND char_length(note) > 200;
ALTER TABLE public.native_schedule_sessions
  DROP CONSTRAINT IF EXISTS native_schedule_sessions_note_sane;
ALTER TABLE public.native_schedule_sessions
  ADD CONSTRAINT native_schedule_sessions_note_sane
  CHECK (note IS NULL OR char_length(note) <= 200) NOT VALID;

-- 2026-09-08 (調査ノート第 4 回 W-18): 有志練習 (任意参加) フラグ。
-- 「参加できる人だけ」の日を公式化するための 1 列で、次の 3 つを外す:
--   1. 自動確定 (native_schedule_auto_confirm) — 全員回答を待つ意味がない
--   2. 未回答の催促 (attendance-reminder) — 任意参加なのにメンションは矛盾
--   3. 出席統計 (W-19) — 母数に入れると「休んだ人」に見えてしまう
-- 既存行は false (= 従来の本活動) なので、未使用のデプロイは挙動が変わらない。
ALTER TABLE public.native_schedule_sessions
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

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
-- W-33 ③ (2026-09-07): メンバー行に DC 表記。
-- 8.0 で Switch 2 版 (2026-08-04 開始) を含むクロスプレイ前提が固まり、
-- 別 DC のメンバーが混在する固定が増えている (調査ノート第 4 回 5-2)。
-- DC 名は運営の再編で増減するので enum にせず自由記述 (20 文字) にする。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS data_center text;
ALTER TABLE public.native_schedule_members
  DROP CONSTRAINT IF EXISTS native_schedule_members_dc_sane;
ALTER TABLE public.native_schedule_members
  ADD CONSTRAINT native_schedule_members_dc_sane
  CHECK (
    data_center IS NULL
    OR (char_length(data_center) <= 20 AND data_center !~ '[[:cntrl:]]')
  ) NOT VALID;

-- W-6 (2026-09-08): 出席の自動突合に使う FFLogs のキャラクター名。
-- ログの参加者名 ↔ メンバーの対応表で、**これだけが名前を持つ列**
-- (突合結果の表は名前を持たない。理由は 6b-9 節)。本人のキャラ名は
-- FFLogs 上で既に公開されている情報で、admin が入力する。
-- 表示名での一致も試すので、表示名 = キャラ名の固定では入力不要。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS fflogs_character_name text;
ALTER TABLE public.native_schedule_members
  DROP CONSTRAINT IF EXISTS native_schedule_members_charname_sane;
-- UI-4 (2026-09-08): メンバーのロール。軽減表のカードを「自分のロールだけ」
-- に絞るために使う (調査ノート第 4 回 8-3 UI-4 の前提だった「ロール」を
-- portal 側に置く最小の形)。
--
-- ⚠ **3 値に固定する。** DC 名 (自由記述) と違い、タンク / ヒーラー / DPS は
-- ゲームの構造で、運営の再編で増減しない。MT/ST/H1/H2/D1〜D4 の細かい
-- 位置は固定ごとの呼び方が違うので**持たない** (シートの列見出しが正)。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.native_schedule_members
  DROP CONSTRAINT IF EXISTS native_schedule_members_role_sane;
ALTER TABLE public.native_schedule_members
  ADD CONSTRAINT native_schedule_members_role_sane
  CHECK (role IS NULL OR role IN ('tank', 'healer', 'dps')) NOT VALID;

-- L-8 (2026-09-08): 本人のジョブ。値は **FFLogs 名** (`RedMage` 等) で、
-- 死亡イベントの `job` と同じ体系 (`lib/jobs.ts` / `JOB_ABBR`)。
--
-- なぜ role とは別に持つのか:
--   * 軽減表の担当は**シートのジョブ名の行**に入っているので、列と本人を
--     結ぶキーはジョブ名になる (表示名やロールでは当たらない)。
--   * ロールは**ジョブから導出できる** (`roleOfJob`)。本人に選ばせるのは
--     ジョブだけにして設定を 1 つ減らす。既存の `role` は残し、ジョブが
--     未設定のときの手動指定として使い続ける。
--
-- ⚠ **CHECK でジョブ名を列挙しない。** 拡張でジョブが増えるたびに
-- schema の変更が必要になるのを避ける。妥当性 (既知のジョブか) は
-- アプリ側 (`isJobKey`) で見て、ここは長さと制御文字だけを見る。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS job text;
ALTER TABLE public.native_schedule_members
  DROP CONSTRAINT IF EXISTS native_schedule_members_job_sane;
ALTER TABLE public.native_schedule_members
  ADD CONSTRAINT native_schedule_members_job_sane
  CHECK (
    job IS NULL
    OR (char_length(job) <= 32 AND job ~ '^[A-Za-z]+$')
  ) NOT VALID;

ALTER TABLE public.native_schedule_members
  ADD CONSTRAINT native_schedule_members_charname_sane
  CHECK (
    fflogs_character_name IS NULL
    OR (
      char_length(fflogs_character_name) <= 64
      AND fflogs_character_name !~ '[[:cntrl:]]'
    )
  ) NOT VALID;

-- 2.1 (2026-05-12) PR3-D: メンバー全体コメント (同期式準拠で 1 メンバー = 1 行)。
-- session ごとの comment (`native_schedule_attendances.comment`) は別概念で
-- 並存する (UI 上は本コメントを優先表示し、attendances.comment は当面 UI 露出なし)。
ALTER TABLE public.native_schedule_members
  ADD COLUMN IF NOT EXISTS comment text;

-- 2026-07-12 監査 B-5: comment は本人 (非 admin) が Server Action 経由で
-- 書ける列。app 層の 500 字制限 (updateNativeScheduleMemberCommentAction) を
-- DB 層でも担保する。attendances.symbol/comment の CHECK (#253) と同方針、
-- NOT VALID で既存行は検証しない。ADD 前の丸めは上記 note と同趣旨
-- (違反行の後続 UPDATE abort を防ぐ、通常 0 行)。
UPDATE public.native_schedule_members
   SET comment = left(comment, 500)
 WHERE comment IS NOT NULL AND char_length(comment) > 500;
ALTER TABLE public.native_schedule_members
  DROP CONSTRAINT IF EXISTS native_schedule_members_comment_sane;
ALTER TABLE public.native_schedule_members
  ADD CONSTRAINT native_schedule_members_comment_sane
  CHECK (comment IS NULL OR char_length(comment) <= 500) NOT VALID;

DROP TRIGGER IF EXISTS set_updated_at_native_schedule_members
  ON public.native_schedule_members;
CREATE TRIGGER set_updated_at_native_schedule_members
  BEFORE UPDATE ON public.native_schedule_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 5e-2. native_schedule_member_jobs (L-10: ジョブを複数 + コンテンツ別) --
-- 2026-09-09 実機報告「ロールは複数変わることもあるので、コンテンツごとに
-- 変更できたり複数指定できるようにしたい」への対応。
--
-- L-8 (2026-09-08) で入れた `native_schedule_members.job` は **1 人 1 ジョブ**
-- で、固定の実態 (層ごとにジョブを変える / サブジョブも触る) を表せなかった。
--
-- ## 形
--
-- 1 行 = 「この人が、このコンテンツで、このジョブ」。`category_id` が NULL の
-- 行が**既定** (どのコンテンツでも使う) で、あるコンテンツに行があれば
-- **そのコンテンツではそちらだけ**を使う (既定との合併はしない — 「4 層では
-- 暗黒騎士だけ」と言えないと上書きの意味が無い)。
--
-- ⚠ **CHECK でジョブ名を列挙しない。** `native_schedule_members.job` と同じ
-- 理由 (拡張でジョブが増えるたびに schema 変更が要るのを避ける)。妥当性は
-- アプリ側の `isJobKey` で見て、ここは長さと文字種だけを見る。
--
-- ⚠ **一意制約は COALESCE の式インデックスで張る。** 素の
-- `UNIQUE (discord_user_id, category_id, job)` では Postgres が NULL を
-- 互いに異なる値として扱うため、**既定の行だけ重複して入る**。
-- `UNIQUE NULLS NOT DISTINCT` は PG15 以降でしか使えないので、どのバージョン
-- でも同じ意味になる式インデックスにする (NULL を固定の zero UUID に畳む)。
CREATE TABLE IF NOT EXISTS public.native_schedule_member_jobs (
  discord_user_id text NOT NULL
                  REFERENCES public.native_schedule_members(discord_user_id) ON DELETE CASCADE,
  -- NULL = 既定 (どのコンテンツでも)。
  category_id     uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  job             text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.native_schedule_member_jobs
  DROP CONSTRAINT IF EXISTS native_schedule_member_jobs_job_sane;
ALTER TABLE public.native_schedule_member_jobs
  ADD CONSTRAINT native_schedule_member_jobs_job_sane
  CHECK (char_length(job) <= 32 AND job ~ '^[A-Za-z]+$') NOT VALID;
-- ⚠ **主キーを持たせる** (2026-09-09、Supabase lint `no_primary_key`)。
-- 自然キー (本人 + コンテンツ + ジョブ) は `category_id` が NULL 可なので
-- 主キーにできない (NULL を含む列は PK 不可) — 下の式インデックスで一意性を
-- 守り、行の識別子は代理キーにする。
ALTER TABLE public.native_schedule_member_jobs
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.native_schedule_member_jobs'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE public.native_schedule_member_jobs
      ADD CONSTRAINT native_schedule_member_jobs_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS native_schedule_member_jobs_uniq
  ON public.native_schedule_member_jobs (
    discord_user_id,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    job
  );
-- 読み取りは「この人の全行」(既定 + 上書きをまとめて 1 回で引く) なので、
-- discord_user_id の単独 index は上の一意インデックスの先頭列で足りる。
-- コンテンツ削除時の CASCADE のために category_id 側だけ張る。
CREATE INDEX IF NOT EXISTS native_schedule_member_jobs_category_idx
  ON public.native_schedule_member_jobs (category_id);

-- 移行 (idempotent): L-8 の単一 `job` 列に入っている値を既定の行として
-- 取り込む。⚠ **列は残す** — この節が適用されていないデプロイでも
-- `fetchMyJobs` が列の値に落ちて動くようにしてある (下の fallback)。
-- 二重に入らないよう ON CONFLICT DO NOTHING。
INSERT INTO public.native_schedule_member_jobs (discord_user_id, category_id, job)
  SELECT discord_user_id, NULL, job
    FROM public.native_schedule_members
   WHERE job IS NOT NULL AND job ~ '^[A-Za-z]+$'
ON CONFLICT DO NOTHING;

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
-- 2026-07-12 監査 B-4: 単独 (session_id) index は PK(session_id,
-- discord_user_id) の先頭列が包含するため冗長 — 削除 (本テーブルは最も
-- write が多い出欠トグル先なので index 維持コスト減の実益もある)。
DROP INDEX IF EXISTS public.native_schedule_attendances_session_idx;
-- ⚠ **FK 側の列にインデックスを張る** (2026-09-09、Supabase lint
-- `unindexed_foreign_keys`)。PK は (session_id, discord_user_id) なので
-- `discord_user_id` 単独の索引が無く、**メンバー行を削除するとき**に
-- 参照側の全走査が起きる (FK の CASCADE チェック)。出席サマリーの
-- 「メンバー別」読み取りにも効く。
CREATE INDEX IF NOT EXISTS native_schedule_attendances_user_idx
  ON public.native_schedule_attendances(discord_user_id);

-- 2.9 follow-up (2026-06-12): symbol の内容制約を DB 層にも追加。
-- #177 (2.8) の Server Action 側サニタイズ (制御文字除去 + 32 字制限) は
-- app 層のみで、member 本人は anon key + 自分のセッション JWT で PostgREST
-- を直接叩けば self-row policy (§7a) を通って迂回できた (2026-06-12 の
-- RLS 監査で検出)。symbol は cron Discord 通知本文 (buildMessage) への
-- 流入経路のため、複数行/長文の注入を DB 層でも遮断する。
-- NOT VALID: 既存行は検証しない (新規 INSERT/UPDATE のみ適用)。万一
-- 制約違反の legacy 行があっても schema 自動 deploy (本番/demo 一括) が
-- 失敗しないことを優先。DROP → ADD は replay-safe のため。
ALTER TABLE public.native_schedule_attendances
  DROP CONSTRAINT IF EXISTS native_schedule_attendances_symbol_sane;
ALTER TABLE public.native_schedule_attendances
  ADD CONSTRAINT native_schedule_attendances_symbol_sane
  CHECK (char_length(symbol) <= 32 AND symbol !~ '[[:cntrl:]]') NOT VALID;

-- 監査 P3-g (2026-06-19): comment も symbol と同じ脅威モデル (本人=非 admin が
-- PostgREST 直叩きで self-row policy を通して書ける) のため、app 層サニタイズ
-- (制御文字除去 + 200 字制限) を DB 層でも担保する。comment は nullable なので
-- NULL は許可。NOT VALID で既存行は検証せず新規 INSERT/UPDATE のみ適用。
ALTER TABLE public.native_schedule_attendances
  DROP CONSTRAINT IF EXISTS native_schedule_attendances_comment_sane;
ALTER TABLE public.native_schedule_attendances
  ADD CONSTRAINT native_schedule_attendances_comment_sane
  CHECK (comment IS NULL OR (char_length(comment) <= 200 AND comment !~ '[[:cntrl:]]')) NOT VALID;

-- 2026-09-06 (調査ノート第 4 回 W-13): 遅刻 / 早退の予定時刻。○×△ の記号は
-- そのまま (凡例マスターは admin が自由編集) で、本人が「到着予定 21:30」
-- 「早退 23:00」を HH:MM で添える。symbol と同じ脅威モデル (本人が PostgREST
-- 直叩きで書ける) なので DB 層でも HH:MM 形式に限定する。NOT VALID で既存行は
-- 検証しない。Discord 通知本文 (buildMessage) にも流れるが形式が固定なので
-- 注入面にはならない。
ALTER TABLE public.native_schedule_attendances
  ADD COLUMN IF NOT EXISTS arrive_at text;
ALTER TABLE public.native_schedule_attendances
  ADD COLUMN IF NOT EXISTS leave_at text;
ALTER TABLE public.native_schedule_attendances
  DROP CONSTRAINT IF EXISTS native_schedule_attendances_times_sane;
ALTER TABLE public.native_schedule_attendances
  ADD CONSTRAINT native_schedule_attendances_times_sane
  CHECK (
    (arrive_at IS NULL OR arrive_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND (leave_at IS NULL OR leave_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  ) NOT VALID;

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
-- 2026-07-12 監査 B-4: 単独 (native_session_id) index は
-- UNIQUE(native_session_id, url) の先頭列が包含するため冗長 — 削除。
DROP INDEX IF EXISTS public.native_schedule_session_logs_session_idx;

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

-- 2026-09-07 (B-1): 攻略リンクにフェーズ / ギミックのタグを付けられるように
-- target_type へ 'category_link' を追加する。CREATE TABLE 時のインライン
-- CHECK は postgres が自動命名するため、名前を指定して張り替える冪等パターン
-- (category_links_kind_check と同じ)。既存行の値は 5 種のみなので violate は
-- 起きない。
DO $$
DECLARE
  c text;
BEGIN
  -- CREATE TABLE 由来の自動命名 CHECK (tags_target_type_check1 等) も含めて
  -- target_type を参照する CHECK を全部落とす。
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class t ON t.oid = con.conrelid
     WHERE t.relname = 'tags'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.tags DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.tags
  ADD CONSTRAINT tags_target_type_check
  CHECK (target_type IN
    ('category','category_link','loot_item','loot_entry',
     'mitigation_entry','strategy_doc'));

-- ラベルの長さ / 空文字を DB 層でも止める (app 層は 24 文字制限)。
ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS tags_label_sane;
ALTER TABLE public.tags
  ADD CONSTRAINT tags_label_sane
  CHECK (char_length(btrim(label)) BETWEEN 1 AND 24) NOT VALID;

-- 同じ対象に同じラベルを二重登録しない (UI の付け外しが冪等になる)。
-- ⚠ UNIQUE は NOT VALID にできないため、既存重複があると作成に失敗する。
--   本テーブルはこれまでアプリから 1 行も書かれていない (2026-09-07 時点で
--   参照は admin の一括削除だけ) ので通常 0 行だが、手で入れた行がある
--   fork でも通るよう、category_links の UNIQUE と同じ形で先に圧縮する。
DELETE FROM public.tags a
  USING public.tags b
 WHERE a.target_type = b.target_type
   AND a.target_id   = b.target_id
   AND a.label       = b.label
   AND a.ctid        > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS tags_target_label_uidx
  ON public.tags(target_type, target_id, label);

-- ---- 6b-9. fflogs_notify_state (W-35: 練習ログのイベント通知) ----------
-- 「新レポート到着 / ベスト到達更新 / 初討伐」を Discord に流すために、
-- **前回通知した時点の到達度**をカテゴリごとに 1 行だけ持つ
-- (調査ノート第 4 回 W-35)。
--
-- fflogs_fights から毎回 SQL で最深到達を出し直すこともできるが、それだと
-- 「前回どこまで通知したか」が分からず、同期のたびに同じベスト更新を
-- 送り続けてしまう。通知は取り消せないので、送った事実を残す方を採る。
--
-- 行が無い (= 初回同期) カテゴリでは **ベスト更新を通知しない**。初めて
-- 取り込んだ全ログが「更新」として一斉に飛ぶのを避けるため
-- (src/lib/logs-notify.ts の detectLogsEvents が prev=null で判定する)。
CREATE TABLE IF NOT EXISTS public.fflogs_notify_state (
  category_id     uuid PRIMARY KEY
                  REFERENCES public.categories(id) ON DELETE CASCADE,
  -- 到達した最深フェーズ (層モデルでは最深 encounter の層番号)。
  best_phase      integer,
  -- その最深フェーズでの最小残 HP% (小さいほど深い)。
  best_percentage numeric(6,3),
  -- 初討伐を通知済みか。
  has_clear       boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_fflogs_notify_state
  ON public.fflogs_notify_state;
CREATE TRIGGER set_updated_at_fflogs_notify_state
  BEFORE UPDATE ON public.fflogs_notify_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fflogs_notify_state
  DROP CONSTRAINT IF EXISTS fflogs_notify_state_sane;
ALTER TABLE public.fflogs_notify_state
  ADD CONSTRAINT fflogs_notify_state_sane
  CHECK (
    (best_phase IS NULL OR best_phase BETWEEN 0 AND 99)
    AND (best_percentage IS NULL OR best_percentage BETWEEN 0 AND 100)
  ) NOT VALID;

-- ---- 6b-8. category_link_reads (W-27: 攻略リンクの既読) ----------------
-- 「共有した攻略情報が読まれない」(調査ノート第 4 回 5-3) への対応。
-- リンク × メンバーで「見た」を 1 行持つだけ。誰が読んだかの生データは
-- **クライアントへ出さない** — 監視感を避けるため、UI に出すのは
--   - 自分が既読かどうか
--   - 未読の人数 (「未読 3 人」)
--   - admin だけ: 未読メンバーの表示名
-- の 3 つに絞る (7 章 W-27 の「誰が未読かは幹部のみ」)。
--
-- メンバーの実体は native_schedule_members (discord_user_id が主キー) だが、
-- FK は張らない — メンバー行を消しても既読の履歴を壊さない方が安全で、
-- 未読人数の計算は is_active なメンバーとの突き合わせで行うため、孤児行は
-- 自然に無視される。
CREATE TABLE IF NOT EXISTS public.category_link_reads (
  link_id         uuid NOT NULL
                  REFERENCES public.category_links(id) ON DELETE CASCADE,
  discord_user_id text NOT NULL,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, discord_user_id)
);
-- 「このメンバーが読んだリンク」方向の引き (未読リンクの催促に使う)。
CREATE INDEX IF NOT EXISTS category_link_reads_user_idx
  ON public.category_link_reads(discord_user_id);

-- ============================================================================
-- 6b. 練習ログ / ウェイマーク / BiS / 週次消化 (TODO #94, 2026-08-28)
-- ============================================================================
-- FF14 外部ツール調査 (`docs/ff14-tools-research-2026-08.md`) の Tier A
-- 提案 A-1 〜 A-5 を実装するための追加テーブル群。既存の
-- 「表は Google Sheets に任せる」判断は覆さず、Sheets では解けない
--   - 配布物 (markercode) の置き場
--   - FFLogs に溜まった pull 単位のデータ
--   - 週制限のカウンタ
-- だけを portal 側に持つ。
--
-- ⚠ 追加テーブルは下記 3 箇所への登録が必要 (7 章 ENABLE RLS / 7 章
--   policy ループ / realtime 購読するなら 7b + 8 章)。本セクションは
--   7 章 (RLS) より前に置く必要がある — 7 章の ENABLE / policy ループが
--   ここで作るテーブルを名指しするため。登録は各章の配列に直接追記してある。

-- ---- 6b-1. category_waymarks (A-5: ウェイマーク markercode 配布) -------
-- category_macros と完全に同型。FF14 のフィールドマーカーはコンテンツ毎に
-- 5 枠しか保存できず、固定内では Discord のログを遡って markercode を
-- 探す運用になりがち。マクロと同じ「ラベル + 本文 + ワンタップコピー」で
-- 配れるようにする。body には EchoPlan / Waymark Preset 系ツールが
-- import/export する文字列 (JSON など) をそのまま入れる。
CREATE TABLE IF NOT EXISTS public.category_waymarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT '',
  body        text NOT NULL,
  note        text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS category_waymarks_category_idx
  ON public.category_waymarks(category_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_category_waymarks
  ON public.category_waymarks;
CREATE TRIGGER set_updated_at_category_waymarks
  BEFORE UPDATE ON public.category_waymarks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2026-08-30 (調査 第3回 C-6): ストラテジーボード共有コード (`[stgy:...]`)
-- を同じテーブルの「種別」として持つ。7.4 で実装されたゲーム内機能で、
-- ウェイマーク JSON と違い **プラグイン不要 = コンソール勢も取り込める**
-- 唯一の図面共有手段。保管 + ワンタップコピーの要件がウェイマークと
-- 完全同一なので、専用テーブルは作らず kind 列で分ける (調査の
-- 「マクロタブ内の 1 種別として最小実装」判断)。既存行は 'waymark'。
ALTER TABLE public.category_waymarks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'waymark';
ALTER TABLE public.category_waymarks
  DROP CONSTRAINT IF EXISTS category_waymarks_kind_check;
ALTER TABLE public.category_waymarks
  ADD CONSTRAINT category_waymarks_kind_check
  CHECK (kind IN ('waymark', 'board'));

-- markercode は 8 マーカー分の座標 JSON で実測 1KB 前後。macros と同じ
-- 8000 字上限で十分。制御文字は弾かない (整形済 JSON の改行を許容)。
ALTER TABLE public.category_waymarks
  DROP CONSTRAINT IF EXISTS category_waymarks_text_sane;
ALTER TABLE public.category_waymarks
  ADD CONSTRAINT category_waymarks_text_sane
  CHECK (
    char_length(body) <= 8000
    AND char_length(label) <= 200
    AND (note IS NULL OR char_length(note) <= 500)
  ) NOT VALID;

-- ---- 6b-2. category_bis_links (コンテンツごとの最適装備リンク) ---------
-- 装備シミュレータ (XivGear 等) は URL 1 本で構成を共有できるので、
-- portal 側はシミュレータを作らず **URL を預かるだけ** にする
-- (調査ノート §4「装備シミュレータの自作」= 非推奨)。
CREATE TABLE IF NOT EXISTS public.category_bis_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  label       text NOT NULL,
  url         text NOT NULL,
  job         text,
  owner_name  text,
  note        text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS category_bis_links_category_idx
  ON public.category_bis_links(category_id, sort_order);

-- ---- W-23 (2026-09-07): BiS の部位別「取得済」チェック ----------------
-- 「消化週の残り目標が一目で分かる」ようにするためのもの (調査ノート第 4 回
-- W-23)。持つのは **部位 × 取得済** だけ — 部位ごとのアイテム名やソースは
-- Google Sheets のロット表が正なので、二重管理にしない。
--
-- 誰が入力するか: **サインイン済みのメンバーなら誰でも**。
-- `category_bis_links.owner_name` は自由記述で Discord ID と紐づいていない
-- ため「本人だけ」を強制できない。加えて実運用では「今日ドロップした分を
-- その場で誰かが付ける」のが自然で、本人待ちにすると埋まらない
-- (ロット表 Sheets と同じ信頼モデル)。loot_weekly_checks の「本人だけ」
-- とは扱いが違う点に注意。
CREATE TABLE IF NOT EXISTS public.category_bis_slots (
  bis_link_id uuid NOT NULL
              REFERENCES public.category_bis_links(id) ON DELETE CASCADE,
  -- XIVGEAR_EQUIP_SLOTS (src/lib/xivgear-set.ts) の値。
  slot        text NOT NULL,
  obtained    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bis_link_id, slot)
);

DROP TRIGGER IF EXISTS set_updated_at_category_bis_slots
  ON public.category_bis_slots;
CREATE TRIGGER set_updated_at_category_bis_slots
  BEFORE UPDATE ON public.category_bis_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- slot 名は app 層の定数と一致させる (誤った値で「12 部位中 13 取得」に
-- ならないように)。値が増えたら CHECK を張り替える。
ALTER TABLE public.category_bis_slots
  DROP CONSTRAINT IF EXISTS category_bis_slots_slot_check;
ALTER TABLE public.category_bis_slots
  ADD CONSTRAINT category_bis_slots_slot_check
  CHECK (slot IN (
    'Weapon','OffHand','Head','Body','Hand','Legs','Feet',
    'Ears','Neck','Wrist','RingLeft','RingRight'
  )) NOT VALID;

DROP TRIGGER IF EXISTS set_updated_at_category_bis_links
  ON public.category_bis_links;
CREATE TRIGGER set_updated_at_category_bis_links
  BEFORE UPDATE ON public.category_bis_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- url は UI 側 `safeHref` / server action で http(s) 検証済みだが、
-- PostgREST 直叩き経路のために DB 層でも形を縛る (javascript: 等の遮断)。
ALTER TABLE public.category_bis_links
  DROP CONSTRAINT IF EXISTS category_bis_links_sane;
ALTER TABLE public.category_bis_links
  ADD CONSTRAINT category_bis_links_sane
  CHECK (
    char_length(label) <= 200
    AND char_length(url) <= 2000
    AND url ~* '^https?://'
    AND (job IS NULL OR char_length(job) <= 40)
    AND (owner_name IS NULL OR char_length(owner_name) <= 100)
    AND (note IS NULL OR char_length(note) <= 500)
  ) NOT VALID;

-- ---- 6b-3. loot_weekly_checks (A-4: 週制限の消化チェック) --------------
-- 零式のロット/断章は火曜 17:00 JST リセットの週制限。誰が今週分を消化
-- したかだけを持つ最小テーブルで、部位別のロット表そのものは従来どおり
-- Google Sheets が正 (調査ノート §2 の「過去判断を覆さない」方針)。
--
-- week_start は「その週のリセット時刻 (火 08:00 UTC) を含む JST 日付」=
-- 常に火曜日の date。アプリ側 `src/lib/week-jst.ts` が算出する。
--
-- RLS は 7 章ループの admin-only のまま。本人書き込みは Server Action
-- (`loot-weekly-actions.ts`) が service role で「自分の discord_id の行
-- だけ」を書く形で通す (native_schedule_members.comment と同じ設計)。
-- 新しい member-writable な RLS 面を増やさないための選択。
CREATE TABLE IF NOT EXISTS public.loot_weekly_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  discord_user_id text NOT NULL,
  display_name    text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT '未消化'
                  CHECK (status IN ('未消化','消化済','辞退')),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, week_start, discord_user_id)
);
CREATE INDEX IF NOT EXISTS loot_weekly_checks_week_idx
  ON public.loot_weekly_checks(category_id, week_start);

DROP TRIGGER IF EXISTS set_updated_at_loot_weekly_checks
  ON public.loot_weekly_checks;
CREATE TRIGGER set_updated_at_loot_weekly_checks
  BEFORE UPDATE ON public.loot_weekly_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.loot_weekly_checks
  DROP CONSTRAINT IF EXISTS loot_weekly_checks_text_sane;
ALTER TABLE public.loot_weekly_checks
  ADD CONSTRAINT loot_weekly_checks_text_sane
  CHECK (
    char_length(discord_user_id) <= 64
    AND char_length(display_name) <= 100
    AND (note IS NULL OR (char_length(note) <= 200 AND note !~ '[[:cntrl:]]'))
  ) NOT VALID;

-- ---- 6b-4. fflogs_fights (A-1 / A-2: pull 単位の練習ログ) --------------
-- FFLogs には pull 単位で全てが入っているのに、portal 側は report URL を
-- 動画に紐づけて終わっていた (調査ノート §2 空白 01)。v2 GraphQL の
-- `reportData.report.fights` を日次で materialize し、
--   - 到達フェーズ / 残 HP % / pull 数の推移 (A-1)
--   - 日付 → pull 一覧 → 該当 fight / 動画時刻へのジャンプ (A-2)
-- を portal 内で完結させる。
--
-- report_code ↔ カテゴリ / 日付の対応は **既存のリンク資産を再利用** する:
--   - category_links.logs_url (kind='video')      → category_id
--   - schedule_past_session_logs.url              → session_date (raw_date)
--   - native_schedule_session_logs.url + session  → session_date
-- 新しいマッチングロジックは足さない。
CREATE TABLE IF NOT EXISTS public.fflogs_fights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code      text NOT NULL,
  fight_id         integer NOT NULL,
  category_id      uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  session_date     text,
  name             text,
  kill             boolean NOT NULL DEFAULT false,
  -- FFLogs の fightPercentage は「終了時点のボス残 HP (%)」。小さいほど
  -- 到達点が深い。kill=true の pull では 0。
  fight_percentage numeric,
  last_phase       integer,
  difficulty       integer,
  encounter_id     integer,
  start_ms         bigint NOT NULL,
  end_ms           bigint NOT NULL,
  report_start_ms  bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_code, fight_id)
);
CREATE INDEX IF NOT EXISTS fflogs_fights_category_idx
  ON public.fflogs_fights(category_id, start_ms);
CREATE INDEX IF NOT EXISTS fflogs_fights_session_idx
  ON public.fflogs_fights(session_date);
-- 2026-09-03: pull ごとの PT 合計 DPS と死亡数 (セッション振り返りの
-- 残 HP% の横に出す)。FFLogs の Summary table から **PT の合計値だけ** を
-- 計算して保存する。個人ごとの値は保存も表示もしない (調査ノート §1-F:
-- 個人の火力を序列化して表示しない、という設計原則は維持する)。
-- 取得は fights 本体とは別クエリで best-effort — 取れなかった pull は
-- NULL のまま (UI は非表示)。
ALTER TABLE public.fflogs_fights
  ADD COLUMN IF NOT EXISTS party_dps integer;
ALTER TABLE public.fflogs_fights
  ADD COLUMN IF NOT EXISTS deaths integer;
-- 2026-09-06 (調査ノート第 4 回 W-1 / W-2): pull ごとの死亡イベントと
-- フェーズ遷移。
--   death_events      jsonb 配列 [{ "t": <pull開始からのms>, "job": "WhiteMage",
--                     "ability": "致命の一撃の技名" }, ...]。Summary table の
--                     deathEvents 由来。**プレイヤー名は保存しない** (誰が
--                     落ちたかではなく「どのジョブが何で落ちたか」だけ)。
--   phase_transitions jsonb 配列 [{ "id": <FFLogs フェーズ ID>, "t": <ms> }, ...]。
--                     fights.phaseTransitions 由来。フェーズ滞在時間の算出用。
-- どちらも best-effort で、取れなかった pull は NULL のまま (UI は非表示)。
ALTER TABLE public.fflogs_fights
  ADD COLUMN IF NOT EXISTS death_events jsonb;
ALTER TABLE public.fflogs_fights
  ADD COLUMN IF NOT EXISTS phase_transitions jsonb;
ALTER TABLE public.fflogs_fights
  DROP CONSTRAINT IF EXISTS fflogs_fights_detail_json_sane;
ALTER TABLE public.fflogs_fights
  ADD CONSTRAINT fflogs_fights_detail_json_sane
  CHECK (
    (death_events IS NULL OR jsonb_typeof(death_events) = 'array')
    AND (phase_transitions IS NULL OR jsonb_typeof(phase_transitions) = 'array')
  ) NOT VALID;

-- ---- 6b-5. fflogs_report_syncs (fights 同期の台帳) ---------------------
-- 同期済み report を記録し、再取得を「新規 code + 直近 N 日」に絞る。
-- 失敗も理由付きで残し、UI 側で「取得できていない report」を可視化する。
CREATE TABLE IF NOT EXISTS public.fflogs_report_syncs (
  report_code     text PRIMARY KEY,
  category_id     uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  session_date    text,
  title           text,
  zone_id         integer,
  report_start_ms bigint,
  fight_count     integer NOT NULL DEFAULT 0,
  ok              boolean NOT NULL DEFAULT true,
  reason          text,
  synced_at       timestamptz NOT NULL DEFAULT now()
);
-- ⚠ **FK 側の列にインデックスを張る** (2026-09-09、Supabase lint
-- `unindexed_foreign_keys`)。主キーは `report_code` なので `category_id` に
-- 索引が無く、**コンテンツを削除するとき** (ON DELETE SET NULL) にこの表の
-- 全走査が起きる。`fetchFailedReportSyncs(categoryId)` の読み取りにも効く。
CREATE INDEX IF NOT EXISTS fflogs_report_syncs_category_idx
  ON public.fflogs_report_syncs(category_id);
-- 2026-08-28: zone 名を保持する。カテゴリ紐づけを後から (FFLogs を叩かずに)
-- やり直せるようにするため — 動画リンクも zone ID も無い固定では初回同期時に
-- カテゴリが決まらず、ログが 1 件も表示されない状態になっていた。
ALTER TABLE public.fflogs_report_syncs
  ADD COLUMN IF NOT EXISTS zone_name text;

-- ---- 6b-5b. fflogs_report_blocklist (取り込み除外、2026-08-30) --------
-- 誤って取り込んだレポート (別コンテンツ / ノーマル等) を練習ログから
-- 消せるようにする。fights 行を消すだけだと、動画リンクや日付ログから
-- 参照されている限り次の同期で再取得されるため、除外リストで恒久的に
-- 弾く。解除したくなったら行を消せば次回同期で戻る。
CREATE TABLE IF NOT EXISTS public.fflogs_report_blocklist (
  report_code text PRIMARY KEY,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- 6b-6. fflogs_report_videos (A-2: 動画オフセット) ------------------
-- 「レポート開始時刻が動画の何秒地点か」を入力すれば、各 pull の動画内時刻は
--   offset_seconds + (fight.start_ms - report_start_ms) / 1000
-- で計算できる。sync はこのテーブルに触らない (人が入れた値を壊さない)。
--
-- 2026-09-07: **1 レポートに複数動画**を許す (実機要望「同日に複数動画が
-- 上げられた場合、練習ログに複数紐づけ出来るか」)。同じ練習日を前半/後半に
-- 分けて投稿したり、視点違いを 2 本上げたりするケースで、動画ごとに別の
-- オフセットが要る (投稿ごとに録画開始位置が違う) ため、主キーを
-- report_code → id へ張り替えて 1 レポート N 行にした。
CREATE TABLE IF NOT EXISTS public.fflogs_report_videos (
  report_code    text PRIMARY KEY,
  video_url      text,
  offset_seconds integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 既存 DB (report_code が主キー) の移行。新規作成時は ADD COLUMN が
-- 空振りするだけなので、どちらの状態からでも同じ形に収束する。
ALTER TABLE public.fflogs_report_videos
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
-- 同じレポート内の並び順 (UI のチップ順)。0 = 先頭。
ALTER TABLE public.fflogs_report_videos
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
-- 「前半」「ヒラ視点」等の表示名 (任意)。空なら UI が「動画 1」と振る。
ALTER TABLE public.fflogs_report_videos
  ADD COLUMN IF NOT EXISTS label text;

-- 主キーを id へ。旧主キー (report_code) は複数行を持てないため落とす。
-- FK の参照元は無い (admin-actions.ts の一括削除も FK 無しとして扱う)。
DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO pk_cols
    FROM pg_constraint c
    JOIN pg_class t       ON t.oid = c.conrelid
    JOIN pg_namespace n   ON n.oid = t.relnamespace
    JOIN pg_attribute a   ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
   WHERE n.nspname = 'public'
     AND t.relname = 'fflogs_report_videos'
     AND c.contype = 'p';
  IF pk_cols IS NOT NULL AND pk_cols <> 'id' THEN
    ALTER TABLE public.fflogs_report_videos DROP CONSTRAINT fflogs_report_videos_pkey;
    ALTER TABLE public.fflogs_report_videos
      ADD CONSTRAINT fflogs_report_videos_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 同じレポートに同じ URL を二重登録しない (自動 seed の ON CONFLICT 推論に
-- 使うので部分 index にはしない — 述語付き index は upsert から推論できない)。
CREATE UNIQUE INDEX IF NOT EXISTS fflogs_report_videos_report_url_uidx
  ON public.fflogs_report_videos (report_code, video_url);
-- レポート単位の読み出し (fetchReportVideoLinks は .in("report_code", ...))。
CREATE INDEX IF NOT EXISTS fflogs_report_videos_report_idx
  ON public.fflogs_report_videos (report_code, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_fflogs_report_videos
  ON public.fflogs_report_videos;
CREATE TRIGGER set_updated_at_fflogs_report_videos
  BEFORE UPDATE ON public.fflogs_report_videos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fflogs_report_videos
  DROP CONSTRAINT IF EXISTS fflogs_report_videos_sane;
ALTER TABLE public.fflogs_report_videos
  ADD CONSTRAINT fflogs_report_videos_sane
  CHECK (
    (video_url IS NULL OR (char_length(video_url) <= 2000 AND video_url ~* '^https?://'))
    -- ±24h。動画とレポートのずれがこれを超えるのは入力ミス。
    AND offset_seconds BETWEEN -86400 AND 86400
    AND (label IS NULL OR char_length(label) <= 40)
  ) NOT VALID;

-- ---- 6b-7. sort_order allocator RPCs (13c と同型) ----------------------
CREATE OR REPLACE FUNCTION public.next_category_waymark_sort_order(
  p_category_id uuid
)
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_waymarks
  WHERE category_id = p_category_id
$$;

CREATE OR REPLACE FUNCTION public.next_category_bis_link_sort_order(
  p_category_id uuid
)
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_bis_links
  WHERE category_id = p_category_id
$$;

REVOKE EXECUTE ON FUNCTION public.next_category_waymark_sort_order(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_category_bis_link_sort_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_category_waymark_sort_order(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_category_bis_link_sort_order(uuid)
  TO authenticated;

-- ---- 6b-11. 新規メンバーの学習パス (B-3、2026-09-08) ------------------
-- 「何から見ればいいか」の順番を示すチェックリストの進捗。1 行 = 
-- (コンテンツ, メンバー, 手順)。
--
-- ⚠ **自動判定はしない。** 「動画を見た」は portal から観測できず、
--   観測できないものを自動で済にすると**見ていないのに済**になる。
--   本人が手で付ける (`category_link_reads` の「見た」と同じ信頼モデル)。
--
-- 手順 id はアプリ側の固定リスト (`src/lib/onboarding-steps.ts`)。
-- ミス注釈のタグと同じ理由で DB では CHECK せず 32 文字の自由文字列に
-- する (語彙を増やすたびに schema を触るとデプロイ順で弾かれる)。
CREATE TABLE IF NOT EXISTS public.category_onboarding_steps (
  category_id     uuid NOT NULL
                  REFERENCES public.categories(id) ON DELETE CASCADE,
  -- native_schedule_members.discord_user_id。FK は張らない
  -- (category_link_reads と同じ方針)。
  discord_user_id text NOT NULL,
  step            text NOT NULL,
  done_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, discord_user_id, step)
);
-- 「このメンバーの進捗」方向の引き (B-5 の /me)。
CREATE INDEX IF NOT EXISTS category_onboarding_steps_user_idx
  ON public.category_onboarding_steps(discord_user_id);
ALTER TABLE public.category_onboarding_steps
  DROP CONSTRAINT IF EXISTS category_onboarding_steps_sane;
ALTER TABLE public.category_onboarding_steps
  ADD CONSTRAINT category_onboarding_steps_sane
  CHECK (
    char_length(discord_user_id) <= 64
    AND char_length(step) <= 32
    AND step !~ '[[:cntrl:]]'
  ) NOT VALID;

-- ---- 6b-10. ミス注釈 (W-7、2026-09-08) --------------------------------
-- pull ごとの「なぜ崩れたか」を人が付けるタグ。FFLogs は「何が起きたか」
-- (誰がいつ何で落ちたか) までしか持たないので、そこに人の判断を重ねる。
--
-- ⚠ **既定はチーム帰属** (`scope='team'`)。調査ノート第 4 回 7-A W-7 の
--   デメリット欄が「個人責任の可視化は雰囲気悪化の恐れ」で、そのための
--   運用設計がこの列。`scope='self'` は **本人が自分に付けるときだけ**
--   許す (Server Action が `discord_user_id = 本人` を強制する)。
--   他人に付ける個人タグは作れない。
--
-- タグの語彙はアプリ側の固定リスト (`src/lib/logs/pull-note-tags.ts`) で、
-- DB では CHECK せず 32 文字の自由文字列にしてある。理由は 2 つ:
--   - 語彙を増やすたびに schema を触ると、デプロイ順で新タグが弾かれる
--   - 集計はアプリ側の既知リストとの突き合わせで行い、知らないタグは
--     「その他」に落とす (attendance-summary の記号と同じ方針)
CREATE TABLE IF NOT EXISTS public.fflogs_pull_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code     text NOT NULL,
  fight_id        integer NOT NULL,
  -- 傾向の集計をコンテンツ単位で引くための非正規化 (fflogs_fights と同じ値)。
  category_id     uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  tag             text NOT NULL,
  scope           text NOT NULL DEFAULT 'team'
                  CHECK (scope IN ('team','self')),
  -- scope='self' のときだけ入る本人のメンバーキー。
  discord_user_id text,
  -- 任意の一言 (テンプレのタグで足りないときだけ)。
  note            text,
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- 同じ pull に同じタグを二重に付けない (チーム帰属は 1 本、個人タグは人ごと)。
-- NULL を含む複合 UNIQUE は Postgres では重複を許すため、`coalesce` の
-- 式インデックスにする。
CREATE UNIQUE INDEX IF NOT EXISTS fflogs_pull_notes_uniq
  ON public.fflogs_pull_notes (
    report_code, fight_id, tag, scope, coalesce(discord_user_id, '')
  );
-- 傾向の集計 (コンテンツ単位)。
CREATE INDEX IF NOT EXISTS fflogs_pull_notes_category_idx
  ON public.fflogs_pull_notes (category_id, created_at DESC);
-- pull 単位の読み出し (展開行)。
CREATE INDEX IF NOT EXISTS fflogs_pull_notes_pull_idx
  ON public.fflogs_pull_notes (report_code, fight_id);
ALTER TABLE public.fflogs_pull_notes
  DROP CONSTRAINT IF EXISTS fflogs_pull_notes_sane;
ALTER TABLE public.fflogs_pull_notes
  ADD CONSTRAINT fflogs_pull_notes_sane
  CHECK (
    char_length(report_code) <= 64
    AND char_length(tag) <= 32
    AND tag !~ '[[:cntrl:]]'
    AND (discord_user_id IS NULL OR char_length(discord_user_id) <= 64)
    AND (note IS NULL OR (char_length(note) <= 200 AND note !~ '[[:cntrl:]]'))
    -- 個人タグは本人のキーが必須 / チーム帰属はキーを持たない。
    AND (
      (scope = 'self' AND discord_user_id IS NOT NULL)
      OR (scope = 'team' AND discord_user_id IS NULL)
    )
  ) NOT VALID;

-- ---- 6b-9. 出席の自動突合 (W-6、2026-09-08) ---------------------------
-- FFLogs のログに映っていた人と、○×△ の回答を突き合わせるための 2 表。
--
-- ⚠ **キャラクター名は保存しない** (ユーザー判断 2026-09-08「突合結果だけ
--   持たせる」)。ログから拾った名前は同期処理のメモリ内で対応表に解決し、
--   保存するのは `(レポートコード, メンバーキー, 映った pull 数)` だけ。
--   名前を pull 行の隣に置くと `fflogs_fights.death_events` (ジョブ名のみで
--   意図的に名前を持たない) と結合できてしまい、「誰が落ちたか」を復元
--   できる状態になる。突合結果だけならその経路が存在しない。
--
-- 対応表は `native_schedule_members.fflogs_character_name` (下記)。表示名
-- での一致も試すので、表示名がキャラ名と同じ固定では入力不要。
--
-- データ初期化 (`admin-actions.ts`) の対象には**入れない** — native
-- スケジュールの表 (sessions / members / attendances) がどれも対象外で、
-- 出席の突合結果はその一族だからである (メンバーが残るのに出席履歴だけ
-- 消えると、W-19 の履歴が黙って欠ける)。
CREATE TABLE IF NOT EXISTS public.fflogs_attendance_actuals (
  -- レポート単位で持つ (JST 暦日ではなく) 理由: 同期は時間予算で途中打ち切り
  -- になることがあり、日単位で「今回拾えた pull 数」を上書きすると、
  -- **一部のレポートしか取れなかった回に pull 数が減って「○ なのに不在」を
  -- 捏造する**。レポート単位なら 1 レポート = 1 回の書き込みで冪等になり、
  -- 日の値は読み出し時に合計すればよい。
  report_code     text NOT NULL,
  -- native_schedule_members.discord_user_id。FK は張らない
  -- (category_link_reads と同じ方針 — メンバー行を消しても履歴を壊さない。
  --  孤児行は is_active なメンバーとの突き合わせで自然に無視される)。
  discord_user_id text NOT NULL,
  -- JST 暦日 ("YYYY-MM-DD")。fflogs_fights.session_date と同じ値を非正規化
  -- して持つ (日単位の読み出しを 1 クエリで済ませるため)。
  session_date    text,
  -- そのレポートで「この人が映っていた」pull 数。0 の行は作らない。
  -- 「○ なのに 1 pull だけ」= 実質不参加を見分けるために持つ。個人の
  -- パフォーマンス値ではないので序列化にはならない。
  pulls           integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_code, discord_user_id)
);
-- 日単位の読み出し (W-19 の突合表)。
CREATE INDEX IF NOT EXISTS fflogs_attendance_actuals_date_idx
  ON public.fflogs_attendance_actuals(session_date);
-- 「このメンバーの出席履歴」方向の引き (W-19 の本人向け履歴)。
CREATE INDEX IF NOT EXISTS fflogs_attendance_actuals_user_idx
  ON public.fflogs_attendance_actuals(discord_user_id);
ALTER TABLE public.fflogs_attendance_actuals
  DROP CONSTRAINT IF EXISTS fflogs_attendance_actuals_sane;
ALTER TABLE public.fflogs_attendance_actuals
  ADD CONSTRAINT fflogs_attendance_actuals_sane
  CHECK (
    char_length(report_code) <= 64
    AND char_length(discord_user_id) <= 64
    AND (session_date IS NULL OR char_length(session_date) <= 20)
    AND pulls >= 0
  ) NOT VALID;

DROP TRIGGER IF EXISTS set_updated_at_fflogs_attendance_actuals
  ON public.fflogs_attendance_actuals;
CREATE TRIGGER set_updated_at_fflogs_attendance_actuals
  BEFORE UPDATE ON public.fflogs_attendance_actuals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 対応表で解決できなかった名前の控え。**これは名前を持つ**が、
--   - メンバーに紐づいていない名前だけ (紐づいたら DELETE する)
--   - pull 単位の情報を持たない (日付は「最後に見た日」1 つだけ)
-- なので、死亡イベント (pull 単位・ジョブのみ) と結合しても個人を復元
-- できない。admin が「この名前は誰か」を対応表に入れるためだけの一覧。
CREATE TABLE IF NOT EXISTS public.fflogs_attendance_unresolved (
  character_name    text PRIMARY KEY,
  pulls             integer NOT NULL DEFAULT 0,
  last_session_date text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fflogs_attendance_unresolved
  DROP CONSTRAINT IF EXISTS fflogs_attendance_unresolved_sane;
ALTER TABLE public.fflogs_attendance_unresolved
  ADD CONSTRAINT fflogs_attendance_unresolved_sane
  CHECK (
    char_length(character_name) <= 64
    AND character_name !~ '[[:cntrl:]]'
    AND pulls >= 0
    AND (last_session_date IS NULL OR char_length(last_session_date) <= 20)
  ) NOT VALID;

DROP TRIGGER IF EXISTS set_updated_at_fflogs_attendance_unresolved
  ON public.fflogs_attendance_unresolved;
CREATE TRIGGER set_updated_at_fflogs_attendance_unresolved
  BEFORE UPDATE ON public.fflogs_attendance_unresolved
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
--   - 環境変数未設定時は `userIsAdmin()` が `false` を返す (fail-closed、
--     2.x で fail-open から変更)。env 設定を忘れた fork で全 guild メンバーが
--     RLS write を通過するリスクを断つため、未設定 = 全員 非admin = write deny。
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
-- TODO #94 (2026-08-28): 6b 章の追加テーブル。
ALTER TABLE public.category_waymarks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_bis_links            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_bis_slots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loot_weekly_checks            ENABLE ROW LEVEL SECURITY;
-- 2026-09-07 (マージ前レビューで検出): この表は **30 テーブル中ただ 1 つ
-- RLS が有効になっていなかった**。schema.sql には (関数以外の) 明示 GRANT が
-- 無く Supabase の default privileges で anon / authenticated が DML 権限を
-- 持つため、RLS 無しでは
--   - INSERT … 任意のレポートを恒久的に取り込み不可にできる (機能の否認)
--   - DELETE … admin が除外した誤取り込みレポートを復活させられる
-- が誰にでもできる状態だった。W-5 (レポート自動発見) はこの表を「発見しても
-- 取り込まない」ゲートとして参照するので、ゲート自体を閉じておく。
--
-- ⚠ policy を張らない形 (category_link_reads と同じ) には **できない**。
-- 同期処理 (`collectReportRefs` / 発見ブロック) と admin の「ログ削除」は
-- どちらも service role ではなく **ユーザースコープのクライアント**で
-- この表を読み書きしているため、policy 0 本にすると除外リストが黙って
-- 空になり (SELECT が 0 行)、除外したレポートが毎回復活する。
-- 下の 7 章の汎用ループに載せて「SELECT 開放 / 書き込みは admin」にする。
ALTER TABLE public.fflogs_report_blocklist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fflogs_fights                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fflogs_report_syncs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fflogs_report_videos          ENABLE ROW LEVEL SECURITY;
-- W-27 (2026-09-07): category_link_reads は **policy を 1 つも張らない**。
-- RLS 有効 + policy なし = anon / authenticated からは読み書き不可で、
-- service role だけが通る。誰が何を読んだかの生データを公開 anon key で
-- 列挙されないようにするための意図的な設計 (7-0 の policy ループにも
-- 入れていない)。読み取りは src/lib/supabase/category-link-reads.ts が
-- 集計してから返し、書き込みは Server Action が本人 row だけを触る
-- (loot_weekly_checks / native_schedule_members.comment と同じ経路)。
ALTER TABLE public.category_link_reads           ENABLE ROW LEVEL SECURITY;
-- W-6 (2026-09-08): 出席の突合結果も **policy を張らない**。
-- 「誰がどの日に来ていたか」の生データを公開 anon key で列挙されないように
-- するための意図的な設計 (category_link_reads と同じ形)。読み取りは
-- src/lib/server/attendance-actuals.ts が可視範囲 (本人 or admin) を
-- 適用してから返し、書き込みは同期処理が service role で行う。
ALTER TABLE public.fflogs_attendance_actuals    ENABLE ROW LEVEL SECURITY;
-- W-7 (2026-09-08): ミス注釈も **policy を張らない**。誰がどの pull に何の
-- タグを付けたかは、公開 anon key で列挙されると「個人責任の可視化」その
-- ものになる。読み出しは Server Action / server モジュールが行い、
-- 書き込みは本人 or チーム帰属のみを Server Action が強制する。
ALTER TABLE public.fflogs_pull_notes            ENABLE ROW LEVEL SECURITY;
-- B-3 (2026-09-08): 学習パスの進捗も **policy を張らない**。誰がどこまで
-- 見たかを公開 anon key で列挙されると「進んでいない人」の可視化になる。
-- 読み書きは Server Action が本人 (と集計) だけを通す。
ALTER TABLE public.category_onboarding_steps    ENABLE ROW LEVEL SECURITY;
-- L-10 (2026-09-09): ジョブの割り当ても **policy を張らない**。
-- 読み書きは Server Action が本人 (と admin) だけを通す service role 経路
-- だけで、クライアントから直接引く用途が無い。7-0 の汎用ループにも
-- 入れていないので、SELECT を開けたい場合はここを変えること。
ALTER TABLE public.native_schedule_member_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fflogs_attendance_unresolved ENABLE ROW LEVEL SECURITY;
-- W-35 (2026-09-07): fflogs_notify_state も **policy を張らない**。
-- 同期 (cron / admin の手動同期) だけが service role で読み書きする内部
-- 状態で、クライアントから読む用途が無い。
ALTER TABLE public.fflogs_notify_state           ENABLE ROW LEVEL SECURITY;

-- ---- 7-0. 公開デモ用トグル (2026-08-05 監査 H-2) --------------------------
--
-- 既定では SELECT を `TO authenticated` に閉じる。以前は全 19 テーブルに
-- `FOR SELECT TO anon, authenticated USING (true)` を張っていたが、
-- `/login` が未認証公開で、そこのログインボタンが `@/lib/supabase/client` を
-- dynamic import するため `NEXT_PUBLIC_SUPABASE_ANON_KEY` はビルド時
-- インラインされたチャンクとして誰でも取得できる。anon key の公開自体は
-- 設計どおり (NEXT_PUBLIC_ は公開前提) だが、RLS 側が anon に全開放して
-- いたことと噛み合い、guild 外の第三者が Supabase REST を直叩きして
--   - native_schedule_members  → 全メンバーの Discord snowflake / 表示名
--   - categories + category_links → required_role_ids で制限したカテゴリの中身
--   - app_settings             → schedule_url (URL-as-capability)、通知先 ID
--   - schedule_session_memos / native_schedule_attendances → 全メモ・全出欠
-- を読める状態だった。Supabase REST は Vercel proxy の外側にあるので、
-- proxy のメンバーゲートは読み取りに一切効かない。
--
-- ただし PUBLIC_DEMO_MODE=true のデプロイ (TODO #8 のモックサイト) は
-- 匿名ゲストが anon key で読む前提なので、そこだけ anon SELECT を残す。
--
-- このフラグは **この DO ブロックが適用時に 1 度読むだけ** で、アプリの
-- ランタイムは参照しない (生成された policy が永続する)。したがって永続設定は
-- 不要で、schema.sql と同一セッションで SET すれば足りる:
--
--     psql "$URL" --single-transaction \
--       -c "SET app.public_demo = 'true';" -f supabase/schema.sql
--
-- `deploy-database-demo.yml` がこの形で自動適用するので手動作業は不要。
--
-- ⚠ `ALTER DATABASE ... SET app.public_demo` は使えない。Supabase の postgres
-- ロールは superuser ではなく `permission denied to set parameter` で落ちる
-- (2026-08-05 の初回デプロイで実際に踏んだ)。
--
-- 本番プロジェクトでは SET せずに適用する (= authenticated 限定)。
-- `current_setting(..., true)` は missing_ok なので未設定でもエラーにならない。
--
-- なお `app_settings` はアプリ側の読み取りを service role に寄せた
-- (`src/lib/supabase/app-settings.ts`)。cron 4 本と demo の匿名描画は
-- そちら経由なので、このトグルとは独立に動く。
DO $$
BEGIN
  IF coalesce(current_setting('app.public_demo', true), '') = 'true' THEN
    RAISE NOTICE '[RLS] app.public_demo=true — SELECT を anon にも開放します (公開デモ用)';
  ELSE
    RAISE NOTICE '[RLS] SELECT は authenticated 限定です (本番既定)';
  END IF;
END $$;

-- Replay-safe policy creation: drop then create per (table, action).
DO $$
DECLARE
  t text;
  ops text[] := ARRAY['select','insert','update','delete'];
  op text;
  policy_name text;
  -- SELECT を許可するロール。公開デモのみ anon を含める (7-0 参照)。
  select_roles text := CASE
    WHEN coalesce(current_setting('app.public_demo', true), '') = 'true'
      THEN 'anon, authenticated'
    ELSE 'authenticated'
  END;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','category_gphoto_albums',
    'app_settings','schedule_past_sessions',
    'schedule_past_session_logs',
    'recruitment_templates','category_macros',
    -- ⚠ schedule_session_memos は **このループに載せない** (2026-09-09、
    -- TODO #92)。所有者ベースの明示ポリシー (7a-2) に移した。ループの
    -- admin-only policy と OR 評価にすると 1 アクションに 2 本並び、
    -- Supabase lint `multiple_permissive_policies` にも当たる。
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    -- ⚠ native_schedule_attendances は **このループに載せない**
    -- (2026-09-09)。admin と本人の 2 本が OR 評価で並び、Supabase lint
    -- `multiple_permissive_policies` に当たっていた。7a で 1 アクション
    -- 1 ポリシー (admin OR 本人) にまとめた。
    'native_schedule_session_logs',
    -- TODO #94 (2026-08-28): 6b 章の追加テーブル。いずれも既定の
    -- 「SELECT 開放 / 書き込みは admin」で足りる。loot_weekly_checks の
    -- 本人書き込みは Server Action の service role 経路で通す (6b-3 参照)。
    'category_waymarks','category_bis_links','loot_weekly_checks',
    -- W-23 (2026-09-07): BiS の部位別チェック。SELECT は開放、書き込みは
    -- admin ポリシー + 非 admin は Server Action の service role 経路
    -- (loot_weekly_checks と同じ扱い)。
    'category_bis_slots',
    'fflogs_fights','fflogs_report_syncs','fflogs_report_videos',
    -- 2026-09-07: 取り込み除外リスト。SELECT は同期処理 (ユーザースコープの
    -- クライアント) が読むので開放し、書き込みは admin に限る。
    'fflogs_report_blocklist'
  ]) LOOP
    FOREACH op IN ARRAY ops LOOP
      policy_name := t || '_anon_' || op;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);
      IF op = 'select' THEN
        -- SELECT は既定で authenticated 限定 (2026-08-05 監査 H-2)。
        -- 公開デモ (app.public_demo=true) のみ anon を含める。Realtime
        -- subscribe はブラウザがユーザーの JWT で張るので authenticated
        -- で足りる。server-side の設定読み取りは service role へ移行済み。
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (true)',
          policy_name, t, select_roles
        );
      ELSIF op = 'insert' THEN
        -- 書き込みは authenticated + is_admin claim (TODO #36 phase 2)。
        -- `auth.jwt() -> 'app_metadata' ->> 'is_admin'` は text なので
        -- 文字列 'true' と比較。NULL の場合 (claim 無し) は deny。
        -- 2026-07-12 監査 B-3: `(SELECT auth.jwt() ...)` に包んで per-row →
        -- per-statement 評価 (initPlan キャッシュ)。単一行 write では差が
        -- 無いが、discord-import / snapshot のバルク upsert が行数分
        -- auth.jwt() を評価していた。意味は等価 (Supabase lint
        -- auth_rls_initplan と同型)。
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
          policy_name, t
        );
      ELSIF op = 'update' THEN
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true') WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
          policy_name, t
        );
      ELSIF op = 'delete' THEN
        EXECUTE format(
          $sql$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true')$sql$,
          policy_name, t
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---- 7a. native_schedule_attendances は admin または本人 (TODO #2 phase 2-A) --
-- 出欠入力は**本人が自分の行を編集する**設計。以前は 7 章ループの admin-only
-- policy と self-row policy の 2 本を OR 評価させていたが、Supabase lint
-- `multiple_permissive_policies` に当たる (1 クエリで 2 本走る) ため、
-- **1 アクション 1 ポリシー (admin OR 本人)** にまとめてループから外した。
--
-- 2.9 follow-up (2026-06-12): 本人 delete が必要。
-- `upsertNativeScheduleAttendanceAction` は「未回答に戻す」を空 symbol →
-- 本人 row DELETE で表現しており、delete が admin-only のままだと非 admin の
-- 操作が 0 行 DELETE + ok:true + 成功 toast の silent fail になっていた
-- (#176 と同クラス、2026-06-12 の RLS 監査で検出)。
--
-- ⚠ SELECT の対象ロールは 7-0 と同じ分岐 (公開デモのみ anon を含める)。
-- 固定値にすると demo のゲストが予定表を読めなくなる。
DO $$
DECLARE
  select_roles text := CASE
    WHEN coalesce(current_setting('app.public_demo', true), '') = 'true'
      THEN 'anon, authenticated'
    ELSE 'authenticated'
  END;
  -- admin または本人。`(SELECT auth.jwt())` の形は lint auth_rls_initplan の
  -- 案内どおり (per-statement 1 回評価)。
  admin_or_self text :=
    $expr$(
      ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
      OR ((SELECT auth.jwt()) -> 'app_metadata' ->> 'discord_id') = discord_user_id
    )$expr$;
BEGIN
  DROP POLICY IF EXISTS native_schedule_attendances_anon_select ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_anon_insert ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_anon_update ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_anon_delete ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_self_insert ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_self_update ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_self_delete ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_read ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_write_insert ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_write_update ON public.native_schedule_attendances;
  DROP POLICY IF EXISTS native_schedule_attendances_write_delete ON public.native_schedule_attendances;

  EXECUTE format(
    'CREATE POLICY native_schedule_attendances_read ON public.native_schedule_attendances FOR SELECT TO %s USING (true)',
    select_roles
  );
  EXECUTE format(
    'CREATE POLICY native_schedule_attendances_write_insert ON public.native_schedule_attendances FOR INSERT TO authenticated WITH CHECK %s',
    admin_or_self
  );
  EXECUTE format(
    'CREATE POLICY native_schedule_attendances_write_update ON public.native_schedule_attendances FOR UPDATE TO authenticated USING %s WITH CHECK %s',
    admin_or_self, admin_or_self
  );
  EXECUTE format(
    'CREATE POLICY native_schedule_attendances_write_delete ON public.native_schedule_attendances FOR DELETE TO authenticated USING %s',
    admin_or_self
  );
END $$;

-- ---- 7a-2. schedule_session_memos は所有者ベース (TODO #92、2026-09-09) -----
-- 以前は「ログイン済みメンバーなら誰でも共有メモを編集可」で、書き込みは
-- `USING (true)` だった。2026-09-09 のユーザー決定で **所有者概念を入れる**
-- ことにしたので、insert / update / delete を **所有者 または admin** に限る。
--
-- ⚠ **1 アクション 1 ポリシーにする。** 汎用ループ (7 章) の admin-only policy と
-- 併存させると OR 評価で 2 本走り、Supabase lint
-- `multiple_permissive_policies` にも当たる。そのためこの表はループから外し、
-- SELECT も含めて 4 本ここで作る。
--
-- ⚠ SELECT の対象ロールは 7-0 と同じ分岐 (公開デモのみ anon を含める)。
-- ここを固定値にすると demo のゲストがメモを読めなくなる。
--
-- ⚠ **既存行は `author_user_id IS NULL`** なので、移行期は admin だけが
-- 触れる。これは意図した状態 (誰の物か分からない行を他人に消させない)。
DO $$
DECLARE
  select_roles text := CASE
    WHEN coalesce(current_setting('app.public_demo', true), '') = 'true'
      THEN 'anon, authenticated'
    ELSE 'authenticated'
  END;
  -- 所有者 または admin。`(SELECT auth.jwt())` の形は lint
  -- auth_rls_initplan の案内どおり (per-statement 1 回評価)。
  owner_or_admin text :=
    $expr$(
      ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
      OR (
        author_user_id IS NOT NULL
        AND author_user_id = ((SELECT auth.jwt()) -> 'app_metadata' ->> 'discord_id')
      )
    )$expr$;
BEGIN
  DROP POLICY IF EXISTS schedule_session_memos_anon_select ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_anon_insert ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_anon_update ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_anon_delete ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_member_insert ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_member_update ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_member_delete ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_read ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_owner_insert ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_owner_update ON public.schedule_session_memos;
  DROP POLICY IF EXISTS schedule_session_memos_owner_delete ON public.schedule_session_memos;

  EXECUTE format(
    'CREATE POLICY schedule_session_memos_read ON public.schedule_session_memos FOR SELECT TO %s USING (true)',
    select_roles
  );
  -- INSERT: 自分の ID でしか作れない (列を送らなければ DEFAULT で入る)。
  -- admin は代理で作れる (運用でメモを整える経路を残す)。
  EXECUTE format(
    'CREATE POLICY schedule_session_memos_owner_insert ON public.schedule_session_memos FOR INSERT TO authenticated WITH CHECK %s',
    owner_or_admin
  );
  EXECUTE format(
    'CREATE POLICY schedule_session_memos_owner_update ON public.schedule_session_memos FOR UPDATE TO authenticated USING %s WITH CHECK %s',
    owner_or_admin, owner_or_admin
  );
  EXECUTE format(
    'CREATE POLICY schedule_session_memos_owner_delete ON public.schedule_session_memos FOR DELETE TO authenticated USING %s',
    owner_or_admin
  );
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
--
-- 2026-07-12 監査 B-2: FULL は **client 購読があるテーブルのみ** に絞る。
-- 従来は全 19 テーブルに FULL を張っていたが、購読が存在するのは下の
-- 6 テーブルだけで、残り 13 (特に write が最多の native_schedule_attendances
-- と daily insert の schedule_past_sessions 系) は UPDATE/DELETE のたびに
-- 旧行全体を WAL に書く恒常コストだけを払っていた。非購読テーブルは
-- Postgres 既定の DEFAULT (PK のみ) に戻す (冪等)。
-- ⚠ 新しく Realtime 購読 (use-realtime-table / useRealtimeChannel) を追加
--   するときは、ここへの FULL 追加と下 8 章 publication への追加を忘れずに。

ALTER TABLE public.categories                    REPLICA IDENTITY FULL;
ALTER TABLE public.category_links                REPLICA IDENTITY FULL;
ALTER TABLE public.category_gphoto_albums        REPLICA IDENTITY FULL;
ALTER TABLE public.recruitment_templates         REPLICA IDENTITY FULL;
ALTER TABLE public.category_macros               REPLICA IDENTITY FULL;
ALTER TABLE public.category_waymarks             REPLICA IDENTITY FULL;
ALTER TABLE public.schedule_session_memos        REPLICA IDENTITY FULL;

-- 非購読 13 テーブル: DEFAULT (PK) に戻す。過去デプロイで FULL が付いた
-- 既存 DB の掃除を兼ねる (再適用は no-op)。
ALTER TABLE public.app_settings                  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.schedule_past_sessions        REPLICA IDENTITY DEFAULT;
ALTER TABLE public.schedule_past_session_logs    REPLICA IDENTITY DEFAULT;
ALTER TABLE public.loot_items                    REPLICA IDENTITY DEFAULT;
ALTER TABLE public.loot_entries                  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.mitigation_phases             REPLICA IDENTITY DEFAULT;
ALTER TABLE public.mitigation_entries            REPLICA IDENTITY DEFAULT;
ALTER TABLE public.strategy_docs                 REPLICA IDENTITY DEFAULT;
ALTER TABLE public.tags                          REPLICA IDENTITY DEFAULT;
ALTER TABLE public.native_schedule_sessions      REPLICA IDENTITY DEFAULT;
ALTER TABLE public.native_schedule_members       REPLICA IDENTITY DEFAULT;
ALTER TABLE public.native_schedule_attendances   REPLICA IDENTITY DEFAULT;
ALTER TABLE public.native_schedule_session_logs  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.category_bis_links            REPLICA IDENTITY DEFAULT;
ALTER TABLE public.loot_weekly_checks            REPLICA IDENTITY DEFAULT;
ALTER TABLE public.fflogs_fights                 REPLICA IDENTITY DEFAULT;
ALTER TABLE public.fflogs_report_syncs           REPLICA IDENTITY DEFAULT;
ALTER TABLE public.fflogs_report_videos          REPLICA IDENTITY DEFAULT;

-- ---- 8. Realtime publication ------------------------------------------
-- 2026-07-12 監査 B-2: publication も client 購読がある 6 テーブルに絞る。
-- 購読ゼロのテーブルが publication に載っていると、write のたびに Realtime
-- サーバーが WAL デコード + ブロードキャスト変換を行う無駄が恒常発生する。
-- 現在の購読 (grep -r useRealtimeTable / channel().on("postgres_changes")):
--   categories            (categories-client.ts / CategorySwitcher)
--   category_links        (category-links-client.ts / videos・strategy)
--   category_gphoto_albums (category-links-client.ts / strategy)
--   category_macros       (category-macros-client.ts / macros)
--   recruitment_templates (recruitment-templates-client.ts / TOP header)
--   schedule_session_memos (schedule-memos-client.ts / TOP schedule-list)
-- ⚠ 新しい購読を追加したら、この ADD 配列 + 上 7b の FULL に必ず追加すること。

DO $$
DECLARE
  t text;
BEGIN
  -- client 購読があるテーブルのみ publication へ。
  FOR t IN SELECT unnest(ARRAY[
    'categories','category_links','category_gphoto_albums',
    'recruitment_templates','category_macros','schedule_session_memos',
    -- TODO #94: ウェイマークはマクロタブ内で macros と同じ live 一覧。
    'category_waymarks'
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

  -- 購読の無い 13 テーブルを publication から外す (過去デプロイで載った分の
  -- 掃除。未登録 / テーブル不存在は no-op 扱いで冪等)。
  FOR t IN SELECT unnest(ARRAY[
    'app_settings','schedule_past_sessions','schedule_past_session_logs',
    'loot_items','loot_entries',
    'mitigation_phases','mitigation_entries',
    'strategy_docs','tags',
    'native_schedule_sessions','native_schedule_members',
    'native_schedule_attendances','native_schedule_session_logs',
    'category_bis_links','loot_weekly_checks',
    'fflogs_fights','fflogs_report_syncs','fflogs_report_videos'
  ]) LOOP
    BEGIN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',
        t
      );
    EXCEPTION
      WHEN undefined_object THEN
        -- not in publication, ignore
        NULL;
      WHEN undefined_table THEN
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

-- 2026-08-05 監査 L-4: テーブル権限そのものを落とす。
--
-- schema.sql には (関数以外の) 明示 GRANT/REVOKE が 1 つも無く、Supabase の
-- default privileges で anon / authenticated は `secrets` に対しても DML 権限を
-- 保持していた。上の `USING (false)` ポリシー **1 本だけ** が FFLogs OAuth
-- トークンの暗号文を守っている状態で、ポリシーの消し忘れ / 書き換えが即座に
-- 露出につながる。このテーブルに触るのは service role
-- (`src/lib/server/secret-store.ts`) だけなので、権限自体を剥がして
-- 「ポリシー + 権限」の二重で閉じる。service role は RLS も GRANT も
-- バイパスするため影響しない。
REVOKE ALL ON TABLE public.secrets FROM anon, authenticated;

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
DROP POLICY IF EXISTS "category-backgrounds authenticated delete" ON storage.objects;

-- ⚠ **`category-backgrounds public read` (SELECT) は作らない** (2026-09-09、
-- Supabase lint `public_bucket_allows_listing`)。
--
-- 公開バケットの**表示**は `/storage/v1/object/public/<bucket>/<path>` で
-- 行われ、この経路は `storage.objects` の RLS を見ない (`getPublicUrl` が
-- 作る URL)。つまり SELECT ポリシーが効くのは **一覧列挙 (`list()`)** と
-- 署名 URL 発行だけで、アプリはどちらも使っていない
-- (`grep '\.storage\.from('` の全件が `upload` / `remove` のみ)。
-- 張ったままだと**アップロード済みファイルを誰でも列挙できる**ので外す。
--
-- ⚠ 戻すときは下の DROP の直後にこの SELECT ポリシーを再作成する:
--   CREATE POLICY "category-backgrounds public read" ON storage.objects
--     FOR SELECT USING (bucket_id = 'category-backgrounds');

-- TODO #36 phase 1 (2.1, 2026-04-29): INSERT は authenticated のみ。
-- TODO #36 phase 2 (2.1, 2026-04-29): さらに is_admin claim も要求。
-- Discord OAuth callback で `is_admin` が true で書かれたユーザー
-- (= DISCORD_ADMIN_ROLE_IDS のロール持ち) のみアップロード可能。
-- 2026-07-12 監査 B-3: is_admin 抽出を `(SELECT ...)` に (initPlan、10b と同型)。
CREATE POLICY "category-backgrounds authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'category-backgrounds'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
  );

-- 2026-07-12 監査 B-6: INSERT と対称の is_admin DELETE policy を追加
-- (strategy-images の P3-n と同型)。
-- 注意: deleteCategoryAction の Storage 掃除は service role client で行う
-- ため storage RLS はバイパスされ、本 policy には依存しない。本 policy が
-- 効くのは「ブラウザ (authenticated client) からの孤児掃除」経路で、現状
-- category-backgrounds には image-form-dialog 相当のブラウザ側掃除が未実装。
-- strategy-images との対称性維持 + 将来のブラウザ側掃除への備えとして張る
-- (張っても既存挙動は不変、anon/非 admin は 0 行)。
CREATE POLICY "category-backgrounds authenticated delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'category-backgrounds'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
  );

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
DROP POLICY IF EXISTS "category-strategy-images authenticated delete" ON storage.objects;

-- ⚠ **`category-strategy-images public read` (SELECT) は作らない** (2026-09-09、
-- Supabase lint `public_bucket_allows_listing`)。
--
-- 公開バケットの**表示**は `/storage/v1/object/public/<bucket>/<path>` で
-- 行われ、この経路は `storage.objects` の RLS を見ない (`getPublicUrl` が
-- 作る URL)。つまり SELECT ポリシーが効くのは **一覧列挙 (`list()`)** と
-- 署名 URL 発行だけで、アプリはどちらも使っていない
-- (`grep '\.storage\.from('` の全件が `upload` / `remove` のみ)。
-- 張ったままだと**アップロード済みファイルを誰でも列挙できる**ので外す。
--
-- ⚠ 戻すときは下の DROP の直後にこの SELECT ポリシーを再作成する:
--   CREATE POLICY "category-strategy-images public read" ON storage.objects
--     FOR SELECT USING (bucket_id = 'category-strategy-images');

CREATE POLICY "category-strategy-images authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'category-strategy-images'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
  );

-- 監査 P3-n (2026-06-19): admin が画像をアップロード→ダイアログをキャンセル /
-- 別 URL で保存 / 重複アップロードすると、参照されない Storage オブジェクトが
-- 孤児として残留する (DELETE policy が無いため client から消せなかった)。
-- INSERT と対称の is_admin DELETE policy を追加し、image-form-dialog が自分の
-- アップロード残骸を後始末できるようにする。
CREATE POLICY "category-strategy-images authenticated delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'category-strategy-images'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin') = 'true'
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

-- ---- 13a-2. Hourly cron for attendance reminder (2026-08-30) -----------
-- 出欠未入力者への催促メンション。13 と同じ pg_cron + pg_net + vault の
-- 構成で、叩く route と vault secret 名だけが違う。route 側で
--   * `attendance_reminder_enabled` が 'true' か (既定 OFF)
--   * `attendance_reminder_hour` (JST) 以降か
--   * その開催日に送信済みでないか (dedup)
-- を判定するため、毎時叩いても実送信は 1 開催日につき 1 回。
--
-- 運用前提: 13 と同じ CRON_SECRET を使うので vault secret は使い回す
-- (`cron_notify_native_schedule_bearer`)。別 secret に分けたい場合は
-- 下の name を変更して `vault.create_secret` を追加登録する。
DO $$
DECLARE
  existing_jobid bigint;
  c_schedule constant text := '0 * * * *';
  c_command constant text := $cmd$
    SELECT net.http_get(
      url := 'https://yurutto-raid-repository.vercel.app/api/cron/attendance-reminder',
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
  WHERE jobname = 'attendance-reminder-hourly';

  IF existing_jobid IS NULL THEN
    PERFORM cron.schedule(
      'attendance-reminder-hourly',
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
-- ⚠ **SECURITY INVOKER** (2026-09-09 に DEFINER から変更、Supabase lint
-- `authenticated_security_definer_function_executable`)。呼ぶのは admin の
-- 書き込み経路 (ユーザースコープのクライアント) で、対象表の SELECT は
-- 7 章で `TO authenticated USING (true)` なので INVOKER でも同じ値が返る。
-- DEFINER は「RLS を bypass する権限」を signed-in 全員に配ることになるので、
-- 必要が無いなら持たせない。
CREATE OR REPLACE FUNCTION public.next_category_sort_order()
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.categories
$$;

CREATE OR REPLACE FUNCTION public.next_category_link_sort_order(
  p_category_id uuid,
  p_kind text
)
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_links
  WHERE category_id = p_category_id AND kind = p_kind
$$;

-- 13d 節の mutating RPC と同じく PUBLIC から明示剥奪してから付与先を絞る。
-- read-only allocator なので実害は無いが、ACL 上で意図 (anon/authenticated のみ)
-- を明示し、security advisor の PUBLIC EXECUTE 指摘も消す。
REVOKE EXECUTE ON FUNCTION public.next_category_sort_order() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_category_link_sort_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_category_sort_order() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_category_link_sort_order(uuid, text)
  TO authenticated;

-- ---- 13c. sort_order allocator RPCs (TODO #83, 2.4) -------------------
-- TODO #83 (2026-06-09): `recruitment_templates` / `category_macros` の
-- INSERT パス (`recruitment-templates-client.ts` / `category-macros-client.ts`)
-- では `SELECT sort_order ORDER BY ... LIMIT 1 → +1 → INSERT` の JS 側
-- TOCTOU が残っていた。実害は表示順の不安定化のみで cron 並列書き込みは
-- 無いが、admin が複数 tab で同時に「テンプレ追加」を押す経路で衝突
-- しうるため、PR #135 と同パターンの RPC を追加して 1 round-trip 化する。
-- ⚠ 2026-09-09: DEFINER から **INVOKER** に変更 (上の 13c と同じ理由)。
--
-- スコープ外: `loot_items` / `mitigation_phases` / `mitigation_entries` /
-- `strategy_docs` は現行 portal に対応する insert UI が存在しない
-- (schema.sql にテーブル定義のみ残る legacy) ため、JS 側 sort_order
-- race の経路自体が無い。将来これらに UI が戻る際は同パターンで
-- RPC を追加する想定。

CREATE OR REPLACE FUNCTION public.next_recruitment_template_sort_order()
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.recruitment_templates
$$;

CREATE OR REPLACE FUNCTION public.next_category_macro_sort_order(
  p_category_id uuid
)
RETURNS integer LANGUAGE sql SET search_path = public AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1
  FROM public.category_macros
  WHERE category_id = p_category_id
$$;

REVOKE EXECUTE ON FUNCTION public.next_recruitment_template_sort_order() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_category_macro_sort_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_recruitment_template_sort_order()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_category_macro_sort_order(uuid)
  TO authenticated;

-- ---- 13c-2. practice seconds aggregate RPC (2026-07-12 監査 B-7) -------
-- /category 一覧の「累計練習時間」バッジ用の集計。従来は
-- `fetchPracticeSecondsByCategory` が全カテゴリ横断で video 行の
-- (category_id, duration_seconds) を **全件転送**して JS 側で合計しており、
-- 動画の累積 (日次 Discord 取込) に比例して /category 表示が線形劣化して
-- いた。DB 側 GROUP BY でカテゴリ数行に縮約する。
--
-- STABLE read-only。⚠ **SECURITY INVOKER** (2026-09-09 に DEFINER から変更)。
-- 旧コメントは「anon SELECT が全開なので DEFINER でも露出は増えない」と
-- 書いていたが、その前提は 2026-08-05 監査 H-2 で SELECT を
-- `TO authenticated` に締めた時点で偽になっていた (15 章の経緯も参照)。
-- INVOKER なら呼び出し元の RLS がそのまま効くので、露出の判断が
-- 1 箇所 (7 章のポリシー) に集まる。
-- `duration_seconds > 0` は JS 実装の `sec <= 0 continue` と同じ除外。
CREATE OR REPLACE FUNCTION public.practice_seconds_by_category()
RETURNS TABLE (category_id uuid, total_seconds bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT category_id, SUM(duration_seconds)::bigint AS total_seconds
    FROM public.category_links
   WHERE kind = 'video'
     AND duration_seconds IS NOT NULL
     AND duration_seconds > 0
   GROUP BY category_id
$$;

REVOKE EXECUTE ON FUNCTION public.practice_seconds_by_category() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_seconds_by_category()
  TO authenticated;

-- ---- 13c-3. per-day progress aggregate RPC (UI-2、2026-09-08) ---------
-- /category 一覧のカードに「日別の到達度スパークライン」を出すための集計
-- (調査ノート第 4 回 8-3 UI-2「今どこまで来たか がタブを開かずカードで
-- 分かる」)。
--
-- ## なぜ DB 側でやるか
--
-- 到達度の計算 (`progressValue` / `progressTimeline`) は「突破済み区間数 +
-- 現在区間の削り」なので **ティア全体の区間数**が要る。区間数は全期間の
-- encounter を見ないと決まらないのに、カードに出したいのは直近数週間だけ。
-- JS 側で出そうとすると全 pull を /category に転送することになる
-- (13c-2 と同じ問題)。ここで「日 × カテゴリ」の数十行に縮約する。
--
-- ## 区間の決め方
--
-- 1. カテゴリの distinct encounter_id が 2 つ以上 → **層モデル**。
--    区間 index は encounter_id の dense_rank、区間数はその総数。
--    ⚠ 同じレポートに混ざった別コンテンツ (エキスパート等) を除くため、
--      **pull 数が最大の encounter から ±7 の範囲**だけをティアとみなす。
--      TS 側 `buildFloorMap` の「幅 8 の窓で pull 数最大のクラスタ」の
--      近似で、FFLogs のティア encounter が連番であることに依存している。
--      厳密な判定は従来どおり練習ログ画面が行う (カードは要約)。
-- 2. encounter が 1 つだけ (絶 / 討滅) → **フェーズモデル**。
--    区間 index は last_phase、区間数はカテゴリ全期間の max(last_phase)。
-- 3. どちらも決まらなければ segment_count = NULL を返し、呼び出し側は
--    「100 − 残 HP%」に倒す (`progressValue` と同じ分岐)。
--
-- 残 HP% は **その日の最深区間の中**で最小を採る。層を跨いで最小を採ると
-- 消化で下層を倒した日が必ず「残 0%」になる (2026-08-28 実機報告と同じ罠)。
--
-- STABLE read-only。fflogs_fights の SELECT は RLS `USING (true)` で anon に
-- 全開なので DEFINER でも露出は増えない (13c-2 と同方針)。
--
-- 検証 (2026-09-08): ローカルの Postgres 16 に本関数だけを載せ、合成データで
-- 実行して TS 側と突き合わせた。
--   - 別コンテンツの混入 (錨から離れた encounter) が集計から外れること
--   - 残 HP% がその日の最深区間の中の最小になること (消化で下層を倒した日が
--     「残 0%」にならない)
--   - 最終 encounter の討伐だけが has_clear になること
--   - session_date が NULL の行が start_ms の JST 暦日にまとまること
--   - p_days が 1..365 に clamp されること (NULL は既定 56)
--   - **未挑戦の層があるティアで segment_count が幅と一致すること**
--     — 最初の実装は出現した encounter の個数で数えていて、1 層と 4 層しか
--     回していない期間に 2 区間となり、同じ 4 層の到達度がカードと練習ログ
--     画面で食い違っていた (encounter 100 / 103 / 104 のデータで TS の
--     `buildFloorMap` が 5、SQL が 3 を返していた)。
CREATE OR REPLACE FUNCTION public.category_progress_by_day(p_days integer DEFAULT 56)
RETURNS TABLE (
  category_id      uuid,
  day              text,
  pulls            integer,
  segment          integer,
  segment_count    integer,
  best_percentage  numeric,
  has_clear        boolean
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH bounds AS (
    SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
             - (LEAST(GREATEST(COALESCE(p_days, 56), 1), 365)::bigint * 86400000)
           AS from_ms
  ),
  -- カテゴリごとの encounter 別 pull 数 (全期間)。区間数の母数になる。
  enc AS (
    SELECT f.category_id, f.encounter_id, COUNT(*)::bigint AS pulls
      FROM public.fflogs_fights f
     WHERE f.category_id IS NOT NULL AND f.encounter_id IS NOT NULL
     GROUP BY f.category_id, f.encounter_id
  ),
  -- pull 数が最大の encounter (= ティアの錨)。
  anchor AS (
    SELECT DISTINCT ON (e.category_id) e.category_id, e.encounter_id
      FROM enc e
     ORDER BY e.category_id, e.pulls DESC, e.encounter_id
  ),
  -- 錨から ±7 に収まる encounter だけをティアとみなす (docstring 参照)。
  cluster AS (
    SELECT e.category_id, e.encounter_id
      FROM enc e
      JOIN anchor a ON a.category_id = e.category_id
     WHERE e.encounter_id BETWEEN a.encounter_id - 7 AND a.encounter_id + 7
  ),
  -- ⚠ 区間数は **encounter ID の幅** (max − min + 1) で数える。出現した
  -- encounter の個数ではない。TS 側 `buildFloorMap` が同じ式で、
  -- 「1 層と 4 層しか回していない期間」でも 4 区間のティアとして扱う
  -- ため — 個数で数えると同じティアが 2 区間になり、4 層の到達度が
  -- カードと練習ログ画面で食い違う。
  cluster_meta AS (
    SELECT c.category_id,
           MIN(c.encounter_id)::integer AS min_encounter_id,
           MAX(c.encounter_id)::integer AS final_encounter_id,
           (MAX(c.encounter_id) - MIN(c.encounter_id) + 1)::integer AS floor_count
      FROM cluster c
     GROUP BY c.category_id
  ),
  tier AS (
    SELECT c.category_id,
           c.encounter_id,
           (c.encounter_id - cm.min_encounter_id + 1)::integer AS segment_index
      FROM cluster c
      JOIN cluster_meta cm ON cm.category_id = c.category_id
  ),
  tier_meta AS (
    SELECT cm.category_id, cm.floor_count, cm.final_encounter_id
      FROM cluster_meta cm
  ),
  -- 絶 / 討滅 (encounter 1 つ) 用のフェーズ数。
  phase_meta AS (
    SELECT f.category_id, MAX(f.last_phase)::integer AS phase_count
      FROM public.fflogs_fights f
     WHERE f.category_id IS NOT NULL AND f.last_phase IS NOT NULL
     GROUP BY f.category_id
  ),
  -- 直近ぶんの pull に、区間 index と区間数を付ける。
  recent AS (
    SELECT f.category_id,
           COALESCE(
             f.session_date,
             to_char(
               to_timestamp(f.start_ms / 1000.0) AT TIME ZONE 'Asia/Tokyo',
               'YYYY-MM-DD'
             )
           ) AS day,
           f.kill,
           f.fight_percentage,
           f.encounter_id,
           CASE
             WHEN COALESCE(tm.floor_count, 0) > 1 THEN t.segment_index
             ELSE f.last_phase
           END AS segment_index,
           CASE
             WHEN COALESCE(tm.floor_count, 0) > 1 THEN tm.floor_count
             ELSE pm.phase_count
           END AS segment_count,
           tm.final_encounter_id
      FROM public.fflogs_fights f
      CROSS JOIN bounds b
      LEFT JOIN tier_meta  tm ON tm.category_id = f.category_id
      LEFT JOIN phase_meta pm ON pm.category_id = f.category_id
      LEFT JOIN tier t
             ON t.category_id = f.category_id
            AND t.encounter_id = f.encounter_id
     WHERE f.category_id IS NOT NULL
       AND f.start_ms >= b.from_ms
       -- 層モデルのカテゴリでは、ティア外 (別コンテンツの混入) を集計から
       -- 除く。TS 側 `filterToFloorCluster` と同じ扱い。
       AND (COALESCE(tm.floor_count, 0) <= 1 OR t.encounter_id IS NOT NULL)
  ),
  per_day AS (
    SELECT r.category_id,
           r.day,
           COUNT(*)::integer AS pulls,
           MAX(r.segment_index)::integer AS segment,
           MAX(r.segment_count)::integer AS segment_count,
           -- クリア = 最終区間の討伐。層モデルでは最終 encounter の kill、
           -- 単一 encounter では素の kill (TS の `isClearFight` と同じ)。
           BOOL_OR(
             r.kill AND (
               r.final_encounter_id IS NULL
               OR r.encounter_id = r.final_encounter_id
             )
           ) AS has_clear
      FROM recent r
     GROUP BY r.category_id, r.day
  )
  SELECT d.category_id,
         d.day,
         d.pulls,
         d.segment,
         d.segment_count,
         -- 残 HP% はその日の最深区間の中でだけ最小を採る (docstring)。
         (SELECT MIN(CASE WHEN r2.kill THEN 0 ELSE r2.fight_percentage END)
            FROM recent r2
           WHERE r2.category_id = d.category_id
             AND r2.day = d.day
             AND (d.segment IS NULL OR r2.segment_index = d.segment)
         ) AS best_percentage,
         d.has_clear
    FROM per_day d
   ORDER BY d.category_id, d.day
$$;

REVOKE EXECUTE ON FUNCTION public.category_progress_by_day(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.category_progress_by_day(integer)
  TO authenticated;

-- ---- 13c-4. fflogs_report_days (出席サマリーの日付突合、2026-09-09) -------
-- W-19 の出席サマリーは「report_code -> JST 暦日」と「暦日ごとの pull 数」の
-- 2 つだけが欲しいのに、`fflogs_fights` の生行を期間で読んでいた。
--
-- ⚠ **PostgREST は既定で 1000 行が上限** (6b-4 の PAGE_SIZE コメントに実測が
-- ある)。90 日ぶんは週 3 日 × 40 pull で約 1,540 行に達するので、
-- **上限で黙って切れて出席の突合が静かに間違う**状態だった (`order` も
-- 付いていなかったのでどの 1000 行が返るかも不定)。#328 で直した
-- 「明細が 1000 件で頭打ち」と同じクラスの穴が別経路に残っていたもの。
--
-- レポート単位に畳めば返るのは 90 日で数十行なので、上限に当たらない。
--
-- ⚠ **SECURITY DEFINER にしない。** 呼ぶのは service role だけで、RLS を
-- bypass する必要が無い。DEFINER にすると 15 章で塞いだ「anon から
-- DEFINER 関数経由で RLS を迂回する」経路をまた作ることになる。
--
-- ⚠ **JST 暦日はここで計算しない。** 日付の正規化は `lib/jst-date.ts` に
-- 集約する方針なので、返すのはレポート内の最小 start_ms (epoch ミリ秒) で、
-- 暦日への変換は TS 側の `jstYmdString` が行う。
CREATE OR REPLACE FUNCTION public.fflogs_report_days(p_from_ms bigint)
RETURNS TABLE (report_code text, first_start_ms bigint, pulls integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT f.report_code,
         min(f.start_ms)::bigint AS first_start_ms,
         count(*)::integer       AS pulls
    FROM public.fflogs_fights f
   WHERE f.start_ms >= p_from_ms
     AND f.report_code IS NOT NULL
   GROUP BY f.report_code
$$;

REVOKE EXECUTE ON FUNCTION public.fflogs_report_days(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fflogs_report_days(bigint)
  TO authenticated, service_role;

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
--    (anon は除外)。⚠ admin 限定は GRANT ではなく関数本体の is_admin claim
--    検査で担保する (2.9 follow-up, 2026-06-13)。authenticated GRANT だけでは
--    非 admin のログイン済みメンバーも実行できてしまい、app 層 assertAdminResult
--    を迂回した REST 直叩きが通る穴になっていたため、本体冒頭にゲートを追加。
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
  -- ⚠ admin ゲート (2.9 follow-up, 2026-06-13): この関数は SECURITY DEFINER で
  -- RLS をバイパスするため、`GRANT TO authenticated` だけだと「ログイン済みなら
  -- 誰でも実行可能」になり、非 admin の guild メンバーが自身の JWT で PostgREST
  -- RPC (/rest/v1/rpc/...) を直叩きすると、app 層の assertAdminResult
  -- (categories-actions.ts) を迂回して未来 placeholder の raw_date 書き換え /
  -- 衝突行 DELETE / memo 追従書き換えができてしまう (表示改竄ベクタ)。RLS と同じ
  -- is_admin claim を関数本体でも検査し、authenticated かつ非 admin の呼び出しを
  -- 拒否する。service_role / SQL Editor 等 JWT を持たない経路は role claim が
  -- 'authenticated' にならないため従来どおり実行可 (運用 / メンテナンス用)。
  IF coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     AND coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', '') <> 'true' THEN
    RAISE EXCEPTION 'update_native_placeholder_raid_times: admin only'
      USING ERRCODE = '42501';
  END IF;

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
--     デプロイ完了 (deployment_status success) をトリガーに数回 ping する
--     GitHub Actions (.github/workflows/warmup-after-deploy.yml, 2026-07-22)
--     が埋める。Cache Components (PPR) の静的シェル化は白画面そのものの
--     構造的対策として引き続き別途調査
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

-- ---- 15. RPC の anon EXECUTE を公開デモだけに限定する -------------------
-- 2026-09-09 監査: 13c 章の集計 RPC が `SECURITY DEFINER` かつ anon に
-- EXECUTE 付与されており、**7 章で閉じたはずの anon 読み取りを迂回できた**。
--
-- 経緯: これらの GRANT は「どうせ anon SELECT が全テーブル全開なので
-- DEFINER でも露出は増えない」という前提で書かれた (関数定義の直上コメント)。
-- その前提は 2026-08-05 監査 H-2 で **SELECT を `TO authenticated` に締めた
-- 時点で偽になった**が、GRANT 側は追随していなかった。`/login` は未認証で
-- 開けて anon key がバンドルから取れるため、guild 外の第三者が
-- `POST /rest/v1/rpc/category_progress_by_day` でカテゴリ別の日次 pull 数・
-- 到達区間・最良残 HP%・討伐フラグを最大 365 日ぶん読めた。
-- (`practice_seconds_by_category` は動画の累計秒数。`next_*_sort_order` は
-- 整数 1 個で実害はほぼ無いが、同じ理由で anon に配る必要が無いので揃える)
--
-- ⚠ **デモの挙動は変えない。** スパークラインと累計練習時間はデモの匿名
-- ゲスト (= anon) が `createClient()` 経由で読むので、`app.public_demo` が
-- 立っているときだけ anon に戻す。7 章の SELECT ポリシーと同じ分岐。
--
-- ⚠ **`REVOKE ... FROM PUBLIC` では消えない。** 既存の本番 DB には anon への
-- **直接の** GRANT が入っているので、anon を名指しで REVOKE してから配り直す
-- (この節は再実行しても同じ状態になる)。
DO $$
DECLARE
  fn text;
  exec_roles text := CASE
    WHEN coalesce(current_setting('app.public_demo', true), '') = 'true'
      THEN 'anon, authenticated'
    ELSE 'authenticated'
  END;
BEGIN
  IF exec_roles = 'authenticated' THEN
    RAISE NOTICE '[GRANT] 集計 RPC の EXECUTE を authenticated 限定にします';
  ELSE
    RAISE NOTICE '[GRANT] app.public_demo=true — 集計 RPC を anon にも開放します (公開デモ用)';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.next_category_waymark_sort_order(uuid)',
    'public.next_category_bis_link_sort_order(uuid)',
    'public.next_category_sort_order()',
    'public.next_category_link_sort_order(uuid, text)',
    'public.next_recruitment_template_sort_order()',
    'public.next_category_macro_sort_order(uuid)',
    'public.practice_seconds_by_category()',
    'public.category_progress_by_day(integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', fn, exec_roles);
  END LOOP;
END $$;

-- ---- 16. pg_net の応答テーブルを溜めない ---------------------------------
-- 2026-09-09: Supabase の advisor が `net._http_response` の
-- `table_bloat` を上げてきた。13 章の毎時 cron が `net.http_get` で Vercel の
-- route を叩くたび、pg_net は**応答を `net._http_response` に積む**。
-- 誰も `net.http_collect_response()` で回収しないので、pg_net の TTL 掃除に
-- 任せきりになっていた。
--
-- ⚠ **放置すると容量を食い続ける**。毎時 1 行でも年 8,760 行、しかも
-- 応答本文つき。ここで**日次の掃除ジョブ**を登録して上限を切る。
--
-- ⚠ **VACUUM はここでは実行できない。** 既に膨らんだ物理サイズを縮めるには
-- `VACUUM FULL net._http_response` が要るが、VACUUM はトランザクション内で
-- 走らせられず (この schema は `--single-transaction` で適用する)、排他ロックも
-- 取る。**1 回だけ手動で**実行してもらう:
--   SQL Editor で `VACUUM (FULL, ANALYZE) net._http_response;`
-- 以後はこのジョブが行数を抑えるので再発しない。
--
-- ⚠ 消すのは**応答だけ**。`net.http_request_queue` は pg_net 自身が処理後に
-- 削除するので触らない。
DO $$
DECLARE
  existing_jobid bigint;
  c_schedule constant text := '17 4 * * *';  -- 毎日 04:17 UTC (JST 13:17)
  c_command constant text :=
    $cmd$DELETE FROM net._http_response WHERE created < now() - interval '2 days'$cmd$;
BEGIN
  SELECT jobid INTO existing_jobid
    FROM cron.job WHERE jobname = 'purge-pg-net-responses';
  IF existing_jobid IS NULL THEN
    PERFORM cron.schedule('purge-pg-net-responses', c_schedule, c_command);
    RAISE NOTICE '[cron] purge-pg-net-responses を登録しました';
  ELSE
    PERFORM cron.alter_job(
      job_id := existing_jobid,
      schedule := c_schedule,
      command := c_command
    );
    RAISE NOTICE '[cron] purge-pg-net-responses を更新しました (jobid=%)', existing_jobid;
  END IF;
END $$;
