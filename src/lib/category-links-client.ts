"use client";

import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/use-realtime-table";
import { isClearTitleForCategory } from "@/lib/clear-detection";
import { maybeSetFirstClearAt } from "@/lib/categories-client";
import {
  addCategoryDiscordBlocklistAction,
  createCategoryLinkAction,
  createGphotoEntryAction,
  deleteCategoryLinkAction,
  deleteGphotoAlbumAction,
  enrichVideoLinkDuration,
  listCategoryDiscordBlocklistAction,
  removeCategoryDiscordBlocklistAction,
  setCategoryLinkFavoriteAction,
  setCategoryLinkOrderAction,
  syncGphotoAlbumAction,
  updateCategoryLinkAction,
  type CategoryDiscordBlocklistRow,
} from "@/lib/server/categories-actions";
import { parseYouTubeId } from "@/lib/youtube";
import {
  rowToCategoryGphotoAlbum,
  rowToCategoryLink,
  type CategoryGphotoAlbum,
  type CategoryGphotoAlbumRow,
  type CategoryLink,
  type CategoryLinkKind,
  type CategoryLinkRow,
} from "@/lib/supabase/types";

/**
 * Client wrappers + Realtime hook for `category_links`.
 *
 * 2.1 (2026-04-29) 以降: 書き込みは ADMIN gate 付きの server action
 * (`*Action`) を経由する。旧 anon key 直書きは RLS 未締めで誰でも書き
 * 込めていたため、設定書き込みと同様に server 側で `assertAdminResult()`
 * で gate するようにした。realtime subscription / refetch は読み取りのみ
 * なので supabase client のまま。
 */

// Phase 16: gphoto は専用 action (`createGphotoEntry`) 経由でのみ作成する
// ため、ここの汎用 createCategoryLink から `gphoto` は除外する。
export async function createCategoryLink(input: {
  categoryId: string;
  kind: Exclude<CategoryLinkKind, "gphoto">;
  title: string;
  url: string;
  description?: string;
  logsUrl?: string | null;
}): Promise<{ ok: true; link: CategoryLink } | { ok: false; reason: string }> {
  const created = await createCategoryLinkAction(input);
  if (!created.ok) return created;
  // server action returns id only; refetch the row so callers get the
  // full CategoryLink shape (CategoryLinkRow → CategoryLink mapping).
  const supabase = createClient();
  const { data, error } = await supabase
    .from("category_links")
    .select("*")
    .eq("id", created.linkId)
    .single();
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "row fetch failed" };
  }
  const link = rowToCategoryLink(data as CategoryLinkRow);

  // Auto-detect first clear: if this is a video and the title is a
  // category-appropriate clear, fill `first_clear_at` (only if NULL).
  // Best-effort — don't fail the insert if this side-effect errors.
  if (link.kind === "video") {
    try {
      const { data: catRow } = await supabase
        .from("categories")
        .select("name")
        .eq("id", link.categoryId)
        .maybeSingle();
      const categoryName = (catRow as { name?: string | null } | null)?.name;
      if (isClearTitleForCategory(link.title, categoryName)) {
        await maybeSetFirstClearAt(
          link.categoryId,
          link.postedAt ?? link.createdAt,
        );
      }
    } catch (e) {
      console.warn("[category-links-client] first-clear auto-set failed:", e);
    }
  }

  // Auto-fetch YouTube duration for video links. Server-side via a
  // Server Action so credentials/User-Agent stay off the browser.
  if (link.kind === "video" && parseYouTubeId(link.url)) {
    try {
      await enrichVideoLinkDuration(link.id, link.url);
    } catch (e) {
      console.warn("[category-links-client] duration enrich failed:", e);
    }
  }
  return { ok: true, link };
}

export async function updateCategoryLink(
  id: string,
  patch: Partial<{
    title: string;
    url: string;
    description: string | null;
    logs_url: string | null;
  }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return updateCategoryLinkAction(id, patch);
}

export async function deleteCategoryLink(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteCategoryLinkAction(id);
}

// =========================================================
// Discord 取り込み除外リスト (2026-06-15)
// =========================================================
export type { CategoryDiscordBlocklistRow };

/** この URL を「今後取り込まない」= 除外登録 + 既存 Discord リンク削除。 */
export async function addDiscordLinkBlocklist(
  categoryId: string,
  url: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return addCategoryDiscordBlocklistAction(categoryId, url);
}

/** 除外リストの 1 行を解除。 */
export async function removeDiscordLinkBlocklist(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return removeCategoryDiscordBlocklistAction(id);
}

/** カテゴリの除外リストを取得 (管理 UI 用)。 */
export async function fetchDiscordLinkBlocklist(
  categoryId: string,
): Promise<
  | { ok: true; items: CategoryDiscordBlocklistRow[] }
  | { ok: false; reason: string }
> {
  return listCategoryDiscordBlocklistAction(categoryId);
}

export async function setCategoryLinkFavorite(
  id: string,
  isFavorite: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryLinkFavoriteAction(id, isFavorite);
}

/**
 * Bulk reorder — assigns sort_order = index for each given id.
 * Mirrors `setCategoryOrder` for categories. Updates run in parallel.
 */
export async function setCategoryLinkOrder(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return setCategoryLinkOrderAction(orderedIds);
}

/**
 * Live link list for a category + kind. Mirrors `useRealtimeCategories`.
 *
 * 2.1 (2026-04-30) TODO #11: Realtime payload を直接 state に適用する
 * incremental update 方式に変更。旧実装は 1 イベントごとに `category_links`
 * を全件 SELECT し直していたため、動画 50 件のリストで 1 行追加/編集する
 * たびに 50 行の SELECT が走っていた。並び替え (Bulk reorder) では行数
 * 分の UPDATE 連鎖で SELECT が連射されるためさらに重い。
 *
 * INSERT / UPDATE は payload.new から `rowToCategoryLink` で変換、DELETE
 * は payload.old.id (PK は REPLICA IDENTITY FULL 不要で常に取得可能) で
 * 削除。subscription 失敗時のみ fallback refetch。
 */
function sortLinks(links: CategoryLink[]): CategoryLink[] {
  return [...links].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function useRealtimeCategoryLinks(
  categoryId: string,
  kind: CategoryLinkKind,
  initial: CategoryLink[],
): CategoryLink[] {
  return useRealtimeTable<CategoryLinkRow, CategoryLink>({
    channelPrefix: "category-links",
    table: "category_links",
    // postgres-side filter は category_id 単一しか指定できない (`and(...)`
    // 構文は v2 で未サポート)。kind の絞り込みは `accept` で実施。
    filter: `category_id=eq.${categoryId}`,
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("category_links")
        .select("*")
        .eq("category_id", categoryId)
        .eq("kind", kind)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CategoryLinkRow[]).map(rowToCategoryLink);
    },
    incremental: {
      map: rowToCategoryLink,
      sort: sortLinks,
      accept: (row) => row.kind === kind,
    },
    refetchIfEmpty: true,
    refetchOnSubscribeError: true,
  });
}

// =============================================================
// Phase 16 (2026-05-13): Google フォトアルバム client wrappers
// =============================================================

export async function createGphotoEntry(input: {
  categoryId: string;
  rawUrl: string;
}): Promise<
  | {
      ok: true;
      kind: "album";
      albumId: string;
      imageCount: number;
      title: string | null;
    }
  | { ok: true; kind: "single"; linkId: string }
  | { ok: false; reason: string }
> {
  return createGphotoEntryAction(input);
}

export async function syncGphotoAlbum(albumId: string): Promise<
  | { ok: true; added: number; removed: number; total: number }
  | { ok: false; reason: string }
> {
  return syncGphotoAlbumAction(albumId);
}

export async function deleteGphotoAlbum(
  albumId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deleteGphotoAlbumAction(albumId);
}

function sortAlbums(albums: CategoryGphotoAlbum[]): CategoryGphotoAlbum[] {
  return [...albums].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * `useRealtimeCategoryLinks` の album 版。`category_gphoto_albums` を
 * subscribe して INSERT / UPDATE / DELETE を incremental に反映する。
 */
export function useRealtimeGphotoAlbums(
  categoryId: string,
  initial: CategoryGphotoAlbum[],
): CategoryGphotoAlbum[] {
  return useRealtimeTable<CategoryGphotoAlbumRow, CategoryGphotoAlbum>({
    channelPrefix: "category-gphoto-albums",
    table: "category_gphoto_albums",
    filter: `category_id=eq.${categoryId}`,
    initial,
    load: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("category_gphoto_albums")
        .select("*")
        .eq("category_id", categoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CategoryGphotoAlbumRow[]).map(
        rowToCategoryGphotoAlbum,
      );
    },
    incremental: {
      map: rowToCategoryGphotoAlbum,
      sort: sortAlbums,
    },
    refetchIfEmpty: true,
    refetchOnSubscribeError: true,
  });
}
