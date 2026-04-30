"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isClearTitleForCategory } from "@/lib/clear-detection";
import { maybeSetFirstClearAt } from "@/lib/categories-client";
import {
  createCategoryLinkAction,
  deleteCategoryLinkAction,
  enrichVideoLinkDuration,
  setCategoryLinkFavoriteAction,
  setCategoryLinkOrderAction,
  updateCategoryLinkAction,
} from "@/lib/server/categories-actions";
import { parseYouTubeId } from "@/lib/youtube";
import {
  rowToCategoryLink,
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

export async function createCategoryLink(input: {
  categoryId: string;
  kind: CategoryLinkKind;
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
  const [links, setLinks] = useState<CategoryLink[]>(initial);
  const id = useId();

  const initialRef = useRef(initial);
  useEffect(() => {
    if (initial !== initialRef.current) {
      initialRef.current = initial;
      setLinks(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refetch = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase
          .from("category_links")
          .select("*")
          .eq("category_id", categoryId)
          .eq("kind", kind)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn("[category-links-client] refetch error:", error.message);
          return;
        }
        setLinks(((data ?? []) as CategoryLinkRow[]).map(rowToCategoryLink));
      } catch (e) {
        console.warn("[category-links-client] refetch exception:", e);
      }
    };

    const channel = supabase
      .channel(`category-links-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "category_links",
          // postgres-side filter は category_id 単一しか指定できない
          // (`and(...)` 構文は v2 で未サポート)。kind の絞り込みは下記
          // payload handler 内で実施。
          filter: `category_id=eq.${categoryId}`,
        },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as CategoryLinkRow | null;
            if (!row || row.kind !== kind) return;
            const next = rowToCategoryLink(row);
            setLinks((prev) =>
              prev.some((l) => l.id === next.id)
                ? prev
                : sortLinks([...prev, next]),
            );
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as CategoryLinkRow | null;
            if (!row || row.kind !== kind) return;
            const updated = rowToCategoryLink(row);
            setLinks((prev) => {
              const exists = prev.some((l) => l.id === updated.id);
              return exists
                ? sortLinks(prev.map((l) => (l.id === updated.id ? updated : l)))
                : sortLinks([...prev, updated]);
            });
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id?: string } | null;
            if (!oldRow?.id) return;
            setLinks((prev) => prev.filter((l) => l.id !== oldRow.id));
          }
        },
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn(
            "[category-links-client] subscribe error:",
            status,
            err,
          );
          // subscribe 失敗時は payload を取れないので保険で再 fetch。
          void refetch();
        }
      });

    // initial が空 = server prefetch が無かった経路 (旧パス / DEV bypass
    // 等) の保険として 1 度だけ実 fetch。通常経路では server-side で
    // initial が満たされているため SELECT は走らない。
    if (initial.length === 0) {
      void refetch();
    }

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[category-links-client] removeChannel error:", e);
      }
    };
    // initial.length は mount 時の判定だけに使う。length 変動で
    // subscription を作り直すと既存 channel が無駄に剥がれるので依存配列
    // に入れない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, categoryId, kind]);

  return links;
}
