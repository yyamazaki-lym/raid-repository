/**
 * Hand-rolled types matching `supabase/schema.sql`.
 *
 * Keeping these manually (instead of `supabase gen types`) avoids having to
 * wire the Supabase CLI into the local dev workflow. They are small enough
 * that drift can be caught by code review when the schema changes.
 */

export type CategoryStatus = "未着手" | "練習中" | "クリア済" | "休止中";

export const ALL_STATUSES: readonly CategoryStatus[] = [
  "未着手",
  "練習中",
  "クリア済",
  "休止中",
] as const;

export function isCategoryStatus(value: unknown): value is CategoryStatus {
  return (
    value === "未着手" ||
    value === "練習中" ||
    value === "クリア済" ||
    value === "休止中"
  );
}

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  sort_order: number;
  loot_sheet_url: string | null;
  mitigation_sheet_url: string | null;
  mitigation_sheet_tabs?: string | null;
  discord_strategy_channel_id: string | null;
  discord_video_channel_id: string | null;
  discord_import_enabled: boolean;
  /** ISO timestamp of the group's first clear of this content. Nullable. */
  first_clear_at: string | null;
  /** FFLogs zone IDs that this content corresponds to. When set, the
   * auto-link feature filters reports by these zone IDs to prevent
   * cross-content mismatches. Empty/null = fall back to fuzzy matching. */
  expected_fflogs_zone_ids: number[] | null;
  /** Optional background image URL shown behind each card on /category. */
  background_image_url: string | null;
  /**
   * Discord role IDs allowed to view this category. NULL or empty array =
   * visible to every guild member. Non-empty = only users whose
   * `app_metadata.discord_roles` intersects this list can see it.
   */
  required_role_ids: string[] | null;
  /** TODO #26 (2.1, 2026-04-29): 自由記述の説明文。空欄可。 */
  description: string | null;
  /**
   * TODO #25 (2.1, 2026-04-29): 手動上書きの「クリアまでの累計時間 (秒)」。
   * NULL のときは動画 duration の自動集計値が使われる。
   */
  manual_time_to_clear_seconds: number | null;
  /**
   * TODO #45 (2.1, 2026-04-29): FFLogs auto-link 用カスタムマッチワード。
   * 配列内のいずれかが report.title / zoneName に部分一致すれば、
   * cross-group reject を override して確信マッチ扱いする。NULL/空 で
   * 従来挙動。
   */
  fflogs_match_keywords: string[] | null;
  /**
   * Phase 13 (2.1, 2026-05-13): Discord 動画ch 取り込みフィルタ。配列内の
   * いずれかがメッセージ本文または抽出 URL に (大小無視・部分一致) ヒット
   * したものだけ取り込む OR マッチ。NULL/空 = フィルタ無効 (従来通り全件)。
   */
  discord_video_filter_keywords: string[] | null;
  /** Phase 13 (2.1, 2026-05-13): Discord 攻略ch 取り込みフィルタ。挙動は video 版と同形。 */
  discord_strategy_filter_keywords: string[] | null;
  /**
   * Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル表示 ON/OFF。
   * false (default) で従来通り、true で thumbnail_url の入っている攻略
   * リンクに og:image / YouTube サムネイルを表示。カテゴリ単位の共有設定。
   */
  show_strategy_thumbnails: boolean;
  /**
   * Phase 17 (2026-05-13): カテゴリカードから category 詳細に飛んだ時の
   * 既定タブ。'mitigation' | 'loot' | 'strategy' | 'videos' | 'macros'。
   * default は従来挙動の 'mitigation'。
   */
  default_tab: string;
  /**
   * Phase 17 (2026-05-13): SubTabs の表示 ON/OFF と任意ラベル上書き。
   * `{<tabId>: {enabled?: boolean, label?: string|null}}`。未指定 key は
   * 「enabled=true, label はデフォルト」とみなす (後方互換)。
   */
  tab_config: Record<string, { enabled?: boolean; label?: string | null }>;
  created_at: string;
  updated_at: string;
};

/** App-facing shape (camelCase, only fields used by the UI). */
export type Category = {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  sortOrder: number;
  lootSheetUrl: string | null;
  mitigationSheetUrl: string | null;
  /** 軽減表の層タブ (手動登録)。JSON 文字列 `[{"label":"1層","gid":"0"}]`。 */
  mitigationSheetTabs: string | null;
  discordStrategyChannelId: string | null;
  discordVideoChannelId: string | null;
  discordImportEnabled: boolean;
  /** ISO timestamp (or null). Manually-set or auto-detected on first clear video. */
  firstClearAt: string | null;
  /** FFLogs zone IDs (e.g. [65, 66]) that this content is. Empty array = unset. */
  expectedFflogsZoneIds: number[];
  /** Optional background image URL shown behind the card on /category. */
  backgroundImageUrl: string | null;
  /**
   * Discord role IDs allowed to view this category. Empty array = visible
   * to every guild member (default). Non-empty = role-gated.
   */
  requiredRoleIds: string[];
  /** 自由記述の説明文 (TODO #26)。空欄なら null。 */
  description: string | null;
  /**
   * 手動上書きのクリアまでの累計時間 (秒)。NULL のときは動画 duration の
   * 自動集計値が使われる (TODO #25)。
   */
  manualTimeToClearSeconds: number | null;
  /**
   * FFLogs auto-link 用カスタムマッチワード (TODO #45)。空配列なら従来挙動。
   * 設定すると、配列内のいずれかが report タイトル / zoneName に部分一致した
   * とき (大小文字無視) cross-group reject を override してマッチ扱い。
   */
  fflogsMatchKeywords: string[];
  /**
   * Discord 動画ch 取り込みフィルタ (Phase 13)。空配列ならフィルタ無効 (従来通り
   * 全件取り込み)。非空ならメッセージ本文または抽出 URL のどちらかに、配列内
   * のいずれかが (大小無視・部分一致) 含まれている投稿だけが対象になる OR マッチ。
   */
  discordVideoFilterKeywords: string[];
  /** Discord 攻略ch 取り込みフィルタ (Phase 13)。挙動は video 版と同形。 */
  discordStrategyFilterKeywords: string[];
  /**
   * Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル表示 ON/OFF。
   * false (default) でカードに og:image を出さない。true で
   * thumbnail_url が入っているリンクのみカード上部にサムネイル表示。
   */
  showStrategyThumbnails: boolean;
  /**
   * Phase 17 (2026-05-13): カテゴリカードから category 詳細を開いた時に
   * 最初に着地する SubTab id。
   */
  defaultTab: CategoryTabId;
  /**
   * Phase 17 (2026-05-13): SubTabs の表示 ON/OFF とラベル上書き。
   * key 未指定なら「enabled=true, label はデフォルト」を意味する。
   */
  tabConfig: Record<string, { enabled?: boolean; label?: string | null }>;
};

// Phase 17 (2026-05-13): SubTabs の固定 id 一覧。CHECK 制約と一致させる。
export const CATEGORY_TAB_IDS = [
  "mitigation",
  "loot",
  "strategy",
  "videos",
  "macros",
  // TODO #94 (2026-08-28): FFLogs の pull 単位ログを読む「練習ログ」タブ。
  // schema.sql の categories_default_tab_check も同時に広げてある。
  "logs",
] as const;
export type CategoryTabId = (typeof CATEGORY_TAB_IDS)[number];

export function isCategoryTabId(v: unknown): v is CategoryTabId {
  return (
    typeof v === "string" &&
    (CATEGORY_TAB_IDS as readonly string[]).includes(v)
  );
}

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    lootSheetUrl: row.loot_sheet_url ?? null,
    mitigationSheetUrl: row.mitigation_sheet_url ?? null,
    mitigationSheetTabs: row.mitigation_sheet_tabs ?? null,
    discordStrategyChannelId: row.discord_strategy_channel_id ?? null,
    discordVideoChannelId: row.discord_video_channel_id ?? null,
    discordImportEnabled: row.discord_import_enabled ?? true,
    firstClearAt: row.first_clear_at ?? null,
    expectedFflogsZoneIds: row.expected_fflogs_zone_ids ?? [],
    backgroundImageUrl: row.background_image_url ?? null,
    requiredRoleIds: row.required_role_ids ?? [],
    description: row.description ?? null,
    manualTimeToClearSeconds: row.manual_time_to_clear_seconds ?? null,
    fflogsMatchKeywords: row.fflogs_match_keywords ?? [],
    discordVideoFilterKeywords: row.discord_video_filter_keywords ?? [],
    discordStrategyFilterKeywords: row.discord_strategy_filter_keywords ?? [],
    showStrategyThumbnails: row.show_strategy_thumbnails ?? false,
    defaultTab: isCategoryTabId(row.default_tab)
      ? row.default_tab
      : "mitigation",
    tabConfig:
      row.tab_config && typeof row.tab_config === "object"
        ? (row.tab_config as Category["tabConfig"])
        : {},
  };
}

// =============================================================
// category_links
// =============================================================

// Phase 15 (2.x, 2026-05-13): `image` を追加。攻略タブで画像 (Storage
// アップロード or 外部 URL) を直接貼れる新エントリ。表示は strategy と
// 別セクション。Discord cron 取り込みは生成しない (manual のみ)。
// Phase 16 (2026-05-13): `gphoto` を追加。Google フォト共有アルバム URL を
// scrape して個別画像を `lh3.googleusercontent.com` 直リンクとして展開した
// 行、もしくは直リンクを直接貼った単独行。アルバム所属の場合は
// gphoto_album_id で category_gphoto_albums を参照する。
export type CategoryLinkKind = "strategy" | "video" | "image" | "gphoto";
export type CategoryLinkSource = "manual" | "discord";

export type CategoryLinkRow = {
  id: string;
  category_id: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description: string | null;
  sort_order: number;
  source: CategoryLinkSource;
  /** Optional secondary URL — videos use this for FFLogs reports. */
  logs_url: string | null;
  /** Video length in seconds. NULL until fetched from YouTube or set manually. */
  duration_seconds: number | null;
  /**
   * Original post timestamp (Discord message time, or YouTube upload date
   * when fetched from a YouTube URL). NULL for pre-migration rows until
   * the duration backfill has run. Falls back to `created_at` in queries.
   */
  posted_at: string | null;
  /** TODO #47 (2.1, 2026-04-30): user-toggled favorite flag (videos only UI). */
  is_favorite: boolean;
  /**
   * Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル URL (og:image)。
   * 新規追加時に server-side で fetchPageMeta から取得。失敗・既存行は NULL。
   * 表示は categories.show_strategy_thumbnails が true のときだけ走る。
   */
  thumbnail_url: string | null;
  /**
   * Phase 16 (2026-05-13): kind='gphoto' の行が属する Google フォト
   * アルバムへの参照。NULL = 単独行 (直リンク 1 枚貼り)。
   */
  gphoto_album_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryLink = {
  id: string;
  categoryId: string;
  kind: CategoryLinkKind;
  title: string;
  url: string;
  description: string | null;
  sortOrder: number;
  source: CategoryLinkSource;
  logsUrl: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
  isFavorite: boolean;
  /** og:image URL (新規追加時に fetchPageMeta で取得した値、Phase 14)。 */
  thumbnailUrl: string | null;
  /** Phase 16: Google フォトアルバム所属時のアルバム id (それ以外は NULL)。 */
  gphotoAlbumId: string | null;
  createdAt: string;
};

export function rowToCategoryLink(row: CategoryLinkRow): CategoryLink {
  return {
    id: row.id,
    categoryId: row.category_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    description: row.description,
    sortOrder: row.sort_order,
    source: row.source ?? "manual",
    logsUrl: row.logs_url ?? null,
    durationSeconds: row.duration_seconds ?? null,
    postedAt: row.posted_at ?? null,
    isFavorite: row.is_favorite ?? false,
    thumbnailUrl: row.thumbnail_url ?? null,
    gphotoAlbumId: row.gphoto_album_id ?? null,
    createdAt: row.created_at,
  };
}

// =============================================================
// category_gphoto_albums (Phase 16, 2026-05-13)
// =============================================================
// Google フォト共有アルバムを 1 行として保持し、子の category_links
// (kind='gphoto') を gphoto_album_id で紐付ける構造。
export type CategoryGphotoAlbumRow = {
  id: string;
  category_id: string;
  share_url: string;
  title: string | null;
  image_count: number;
  last_synced_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CategoryGphotoAlbum = {
  id: string;
  categoryId: string;
  shareUrl: string;
  title: string | null;
  imageCount: number;
  lastSyncedAt: string | null;
  sortOrder: number;
  createdAt: string;
};

export function rowToCategoryGphotoAlbum(
  row: CategoryGphotoAlbumRow,
): CategoryGphotoAlbum {
  return {
    id: row.id,
    categoryId: row.category_id,
    shareUrl: row.share_url,
    title: row.title,
    imageCount: row.image_count ?? 0,
    lastSyncedAt: row.last_synced_at,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  };
}
