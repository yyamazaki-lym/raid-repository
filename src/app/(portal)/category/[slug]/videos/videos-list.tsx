"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ExternalLink,
  Film,
  Play,
  GripVertical,
  MessageCircle,
  Calendar,
  ListOrdered,
  BarChart3,
  Timer,
  Trophy,
  Trash2,
  CheckSquare,
  Square,
  Hourglass,
  Star,
  X,
  Microscope,
} from "lucide-react";
import { LinkSiteIcon } from "@/components/portal/link-site-icon";
import { LINK_SITE_LABEL, detectLinkSite } from "@/lib/link-site";
import { toast } from "sonner";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
// 1.9 (2026-04-28) TODO #11: lazy 化で初期 client bundle から外す
import { LinkFormDialog } from "@/components/portal/link-form-dialog-lazy";
import { LinkCardMenu } from "@/components/portal/link-card-menu-lazy";
import { ActionSlot } from "@/components/portal/action-slot";
import {
  deleteCategoryLink,
  setCategoryLinkFavorite,
  setCategoryLinkOrder,
  useRealtimeCategoryLinks,
} from "@/lib/category-links-client";
import { updateCategory } from "@/lib/categories-client";
import {
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import {
  formatDurationLong,
  formatDurationShort,
  formatFirstClear,
} from "@/lib/duration-format";
import { safeHref } from "@/lib/url-safe";
import { toXivAnalysisUrl } from "@/lib/fflogs-url";
import { extractDateFromTitle } from "@/lib/title-date";
import { jstYmd, jstYmdString } from "@/lib/jst-date";
import {
  applyOptimisticOrder,
  useSortableReorder,
} from "@/lib/use-sortable-reorder";
import { useConfirm } from "@/components/portal/confirm-dialog";
import type { CategoryLink, CategoryStatus } from "@/lib/supabase/types";

type Props = {
  categoryId: string;
  initial: CategoryLink[];
  /**
   * Category's first-clear timestamp (auto-detected from a "クリア"-titled
   * video, or manually set). Used in the header to show a クリア badge
   * + the time-to-clear stat alongside the running total.
   */
  firstClearAt?: string | null;
  /**
   * Category status. クリア済 のときだけ「クリアまでの累計時間」表示、
   * それ以外は「コンテンツ挑戦時間」(全動画 duration 合計) として表示。
   */
  status: CategoryStatus;
  /**
   * 手動入力のクリアまでの累計時間 (秒、TODO #25)。NULL なら自動計算優先。
   * セットされていれば status に関係なくこの値を表示する。
   */
  manualTimeToClearSeconds?: number | null;
};

type SortMode = "date" | "custom";
const SORT_STORAGE_KEY = "raid-repo:videos-sort-mode";
// TODO #47 (2.1, 2026-04-30): お気に入りフィルタの ON/OFF も localStorage に
// 残し、リロードしても直前の閲覧モードを維持する。SORT と同じ命名規則。
const FAVORITES_FILTER_STORAGE_KEY = "raid-repo:videos-favorites-only";

export function VideosList({
  categoryId,
  initial,
  firstClearAt,
  status,
  manualTimeToClearSeconds = null,
}: Props) {
  const live = useRealtimeCategoryLinks(categoryId, "video", initial);
  const [editTarget, setEditTarget] = useState<CategoryLink | null>(null);
  // DnD 並び替えの共通フック (C-1/C-4)。動画は表示が sort_order DESC なので
  // 永続化時に reverse する (toPersistIds)。
  const { optimisticOrder, sensors, handleDragEnd, syncOnSettle } =
    useSortableReorder({ persist: setCategoryLinkOrder });
  const confirm = useConfirm();
  // ページ全体で「いま再生中の動画」を 1 つだけ保持する。別の動画カードで
  // 再生を開くと前のは自動で閉じる (= iframe unmount = 再生停止)。
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  // Multi-select state (1.9.15): toggling on switches each card into a
  // selectable mode. Card body click stops opening YouTube; instead it
  // toggles the row's selection. Header gains a delete button when
  // selection is non-empty.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [savingClearTime, setSavingClearTime] = useState(false);
  const [bulkFavoriting, setBulkFavoriting] = useState(false);
  // TODO #47 follow-up (2.1, 2026-04-30): ★ トグル click → server action
  // 完了 → realtime payload 反映までのラグ (体感 200-500ms) を消すための
  // optimistic state。`Map<id, optimisticIsFavorite>` で持ち、live の値より
  // 優先表示する。realtime UPDATE が同じ値で届いた時点でエントリを破棄。
  const [optimisticFavorites, setOptimisticFavorites] = useState<
    Map<string, boolean>
  >(new Map());
  // VideoCard を memo 化するため、参照が毎回変わらないよう useCallback で固定。
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // 再生中カードを閉じる安定コールバック (同上、memo の props を安定させる)。
  const handleCloseActive = useCallback(() => setActiveVideoId(null), []);
  // ?focus=<videoId> — set when navigating from the schedule page's
  // past date cell. Used to scroll the matching card into view and
  // briefly highlight it.
  // ?focusDate=YYYY-MM-DD — set when navigating from the category
  // list's クリア日 (Trophy) badge. The first video whose
  // title-extracted date OR posted_at / created_at starts with the
  // given YYYY-MM-DD becomes the focus target. (1.9.18)
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const focusDate = searchParams.get("focusDate");
  const focusedRef = useRef<HTMLLIElement | null>(null);

  // Resolve a YYYY-MM-DD date string to the matching video id by
  // scanning the live list. Title-extracted date (the actual raid day)
  // takes priority over posted_at / created_at, matching the same
  // convention as the backfill logic.
  const findVideoIdByDate = useCallback(
    (dateIso: string): string | null => {
      for (const v of live) {
        const fallbackYear = v.postedAt
          ? jstYmd(new Date(v.postedAt)).y
          : jstYmd(new Date(v.createdAt)).y;
        const titleD = extractDateFromTitle(v.title, fallbackYear);
        if (titleD) {
          const iso = `${titleD.y}-${String(titleD.m).padStart(2, "0")}-${String(titleD.d).padStart(2, "0")}`;
          if (iso === dateIso) return v.id;
        } else if (v.postedAt && v.postedAt.startsWith(dateIso)) {
          return v.id;
        } else if (v.createdAt.startsWith(dateIso)) {
          return v.id;
        }
      }
      return null;
    },
    [live],
  );

  // 1.9 (2026-04-28) TODO #10: クリア日時バッジをクリックで該当動画へ
  // anchor jump できるようにするため、URL ?focusDate= とは独立にローカル
  // state で focus 対象を保持 (URL を書き換えると "戻る" 履歴が汚れるため)。
  // `focusKey` は同一 id に再 focus したときも useEffect を再発火させる
  // ためのカウンター — Trophy 連打や戻る後再アクセス時の dismiss 解除に使う。
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  // ring の表示制御。focusedVideoId が解決しても、ユーザーの次の操作
  // (枠外クリック / スクロール) で off にする。URL ?focus= / ?focusDate=
  // 経由で来た場合も同じ扱い (ユーザー指示)。
  const [focusActive, setFocusActive] = useState(true);

  const focusedVideoId = useMemo(() => {
    if (manualFocusId) return manualFocusId;
    if (focusId) return focusId;
    if (!focusDate) return null;
    return findVideoIdByDate(focusDate);
  }, [manualFocusId, focusId, focusDate, findVideoIdByDate]);
  // Sort mode lives in localStorage so the user's choice survives reloads.
  // Default to date (newest-first) — matches the request to view videos
  // chronologically; switching to custom enables DnD reordering.
  const [sortMode, setSortMode] = useState<SortMode>("date");
  // TODO #47: お気に入りのみ表示するフィルタ。sortMode と独立で動き、
  // ON のときは `videos` を `isFavorite === true` で絞った結果のみ描画。
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "custom" || stored === "date") setSortMode(stored);
    const fav = window.localStorage.getItem(FAVORITES_FILTER_STORAGE_KEY);
    if (fav === "1") setFavoritesOnly(true);
  }, []);

  // focusedVideoId が解決した瞬間に focusActive を再 arm。これにより
  // (a) Trophy 連打、(b) URL `?focus=` / `?focusDate=` で再アクセス、
  // (c) 戻る後の navigation 復帰、いずれの経路でも ring が再表示される。
  useEffect(() => {
    if (!focusedVideoId) return;
    setFocusActive(true);
  }, [focusedVideoId, focusKey]);

  // 2.1 (2026-04-29) v2: URL の focus 系パラメータが乗った遷移時は
  // focusKey を毎回更新してスクロール useEffect を再発火させる。これ
  // により、同じ ?focusDate=ISO で戻る → 再訪問のケース (focusedVideoId
  // が変わらず、live.length も同じ) でも scrollIntoView が走る。
  useEffect(() => {
    if (!focusId && !focusDate) return;
    setFocusKey((k) => k + 1);
  }, [focusId, focusDate]);

  // Scroll the focused card into view once it mounts. Re-runs when
  // the focusedVideoId changes or when the live list arrives (since
  // the ref is set during render of the matching card).
  // `focusKey` is included so連打 of the same クリア badge re-triggers
  // scroll even when the resolved id doesn't change.
  //
  // 2.1 (2026-04-30) v3: 旧 v2 の固定タイマー 4 段階 (100/400/800/1500ms)
  // では production の遅い回線 / lazy mount で 1500ms 越えになるケースを
  // カバーできず再びスクロール抜けが発生していた。改善:
  //   - rAF で ref 出現を polling し、現れたら ResizeObserver で
  //     「高さ > 0」になった瞬間に scrollIntoView。
  //   - 念のためタイマーも 50/200/500/900/1500/2500/4000ms と長めに張り、
  //     Observer が動かない環境のフォールバックを残す。
  //   - `done` フラグで二重発火を抑止。
  //
  // 呼び出し元 (category-list.tsx) は引き続き `router.push(..., {scroll:false})`
  // 前提 (Next.js 16 の遷移時 top auto-scroll を抑止)。
  useEffect(() => {
    if (!focusedVideoId) return;
    let done = false;
    let cancelled = false;
    const tryScroll = (): boolean => {
      if (cancelled || done) return false;
      const el = focusedRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      done = true;
      return true;
    };
    const delays = [50, 200, 500, 900, 1500, 2500, 4000];
    const timeouts = delays.map((d) => window.setTimeout(tryScroll, d));
    const obs = new ResizeObserver(() => {
      if (tryScroll()) obs.disconnect();
    });
    let rafId: number | null = null;
    const pollRef = () => {
      if (cancelled || done) return;
      const el = focusedRef.current;
      if (el) {
        obs.observe(el);
        tryScroll();
        return;
      }
      rafId = requestAnimationFrame(pollRef);
    };
    rafId = requestAnimationFrame(pollRef);
    return () => {
      cancelled = true;
      for (const id of timeouts) window.clearTimeout(id);
      if (rafId !== null) cancelAnimationFrame(rafId);
      obs.disconnect();
    };
    // live.length は依存に含めない: effect 本体は live を参照せず、rAF polling +
    // ResizeObserver がマウント待ちを吸収するため、realtime の INSERT/DELETE で
    // 長さが変わるたびに 7 個の setTimeout + rAF + Observer を張り直すのは冗長。
    // URL 再訪時の再スクロールは focusKey 更新で別途カバーされる。
  }, [focusedVideoId, focusKey]);

  // フォーカス強調 (ring) は「ユーザーが次の操作 (枠外クリック /
  // スクロール) をした時点」で off にする。Trophy 経由 / URL 経由
  // (?focus= / ?focusDate=) いずれも同じ挙動 (ユーザー指示)。
  // smooth scroll が settle するまで (~1.5s) はガードして dismiss させない。
  useEffect(() => {
    if (!focusedVideoId || !focusActive) return;
    let armed = false;
    const clear = () => {
      setFocusActive(false);
    };
    const onScroll = () => {
      if (armed) clear();
    };
    const onClick = (e: MouseEvent) => {
      if (!armed) return;
      const focusedEl = focusedRef.current;
      if (focusedEl && focusedEl.contains(e.target as Node)) return;
      clear();
    };
    const armId = window.setTimeout(() => {
      armed = true;
    }, 1500);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(armId);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick);
    };
  }, [focusedVideoId, focusActive, focusKey]);

  // クリア日時バッジ (Trophy) クリック時のスクロールハンドラ。
  // firstClearAt はカテゴリ初クリアの ISO timestamp (UTC 保存)。
  // extractDateFromTitle が拾うのは JST の暦日なので、閲覧者の壁時計
  // ではなく JST 暦日に正規化して `findVideoIdByDate` に渡す
  // (非 JST 環境でも 1 日ずれない)。該当動画が無ければ toast で通知。
  const onJumpToFirstClear = useCallback(() => {
    if (!firstClearAt) return;
    const iso = jstYmdString(new Date(firstClearAt));
    const matched = findVideoIdByDate(iso);
    if (!matched) {
      toast.error(`${iso} のクリア動画が見つかりませんでした`);
      return;
    }
    setManualFocusId(matched);
    setFocusKey((k) => k + 1);
  }, [firstClearAt, findVideoIdByDate]);
  const persistSort = (mode: SortMode) => {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  // TODO #47 follow-up: optimistic ★ 状態を live にマージした派生配列。
  // 以降の derived (videos / favoriteCount / 削除可否判定) は全部この
  // `liveWithFav` を起点にすることで、realtime ラグ中も UI が即座に
  // 反映される。realtime UPDATE で live の isFavorite が optimistic と
  // 一致すれば下記 useEffect でエントリを破棄。
  const liveWithFav = useMemo(() => {
    if (optimisticFavorites.size === 0) return live;
    return live.map((v) => {
      const opt = optimisticFavorites.get(v.id);
      return opt === undefined || opt === v.isFavorite
        ? v
        : { ...v, isFavorite: opt };
    });
  }, [live, optimisticFavorites]);

  // realtime payload が届いて live.isFavorite が optimistic と揃ったら
  // エントリを破棄。これでメモリリーク (古い id がずっと残る) を防ぐ。
  useEffect(() => {
    setOptimisticFavorites((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const v of live) {
        const opt = next.get(v.id);
        if (opt !== undefined && opt === v.isFavorite) {
          next.delete(v.id);
          changed = true;
        }
      }
      // live にもう存在しない id (= 削除済) も sweep
      const liveIds = new Set(live.map((v) => v.id));
      for (const id of next.keys()) {
        if (!liveIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [live]);

  const videos = useMemo(() => {
    // TODO #47: favorites filter は sort より前段。空表示時の empty
    // state はカード件数 0 で既存 videos.length === 0 分岐に乗せる。
    const base = favoritesOnly
      ? liveWithFav.filter((v) => v.isFavorite)
      : liveWithFav;
    if (sortMode === "date") {
      // Newest first by created_at; ties (within the same insert batch from
      // the cron) fall back to sort_order ascending.
      return [...base].sort((a, b) => {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        return cmp !== 0 ? cmp : a.sortOrder - b.sortOrder;
      });
    }
    // Custom mode — DB stores `sort_order` ascending so insertion order is
    // 0, 1, 2, ... (oldest first). Date 並び順 (default) is newest-first
    // by createdAt, so just returning DB order would visually flip the
    // list when the user toggles date → custom. Reverse here so custom mode
    // shares the same top-of-list direction as date mode (newest at top)
    // while still respecting whatever DnD reorder the user has applied.
    // `optimistic` is stored in display order (= sort_order DESC) so it can
    // be applied as-is.
    if (optimisticOrder) {
      return applyOptimisticOrder(base, optimisticOrder);
    }
    return [...base].reverse();
  }, [liveWithFav, optimisticOrder, sortMode, favoritesOnly]);

  // お気に入りフィルタ ON 中の一括お気に入り解除 (や favoritesOnly トグル) で
  // 表示集合から外れたカードを選択集合からも掃除する。これをしないと、消えた
  // カードが選択されたままフローティングバーに件数が残り、後続の bulk 操作が
  // 不可視カードに作用しうる (総合監査 P3-o)。フィルタが効いていない通常時は
  // 全カードが visible なので何も削らない (= 選択は維持)。
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(videos.map((v) => v.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [videos]);

  // custom 並び替えの DB 確定表示順 (sort_order ASC を表示 DESC に反転) が
  // 楽観順に追いついたら畳む (値マッチ、C-1)。
  useEffect(() => {
    syncOnSettle([...liveWithFav].reverse().map((v) => v.id));
  }, [liveWithFav, syncOnSettle]);

  const favoriteCount = useMemo(
    () => liveWithFav.reduce((n, v) => (v.isFavorite ? n + 1 : n), 0),
    [liveWithFav],
  );

  const persistFavoritesOnly = (next: boolean) => {
    setFavoritesOnly(next);
    try {
      window.localStorage.setItem(
        FAVORITES_FILTER_STORAGE_KEY,
        next ? "1" : "0",
      );
    } catch {
      // ignore
    }
  };

  const onToggleFavorite = useCallback(
    async (video: CategoryLink) => {
      const next = !video.isFavorite;
      // 1. UI を先に更新 (optimistic) — クリック反応の体感を即時化。
      setOptimisticFavorites((prev) => {
        const m = new Map(prev);
        m.set(video.id, next);
        return m;
      });
      // 2. Server へ反映。realtime UPDATE で live が更新されたら、
      //    上の useEffect が optimistic エントリを破棄する。
      const result = await setCategoryLinkFavorite(video.id, next);
      if (!result.ok) {
        // 失敗時は optimistic を取り下げて元の状態に戻す。
        setOptimisticFavorites((prev) => {
          const m = new Map(prev);
          m.delete(video.id);
          return m;
        });
        toast.error("お気に入り更新失敗: " + result.reason);
      }
    },
    [],
  );

  // `videos` は表示順 (newest-at-top)。arrayMove 後も表示順なので、永続化時は
  // reverse して DB `sort_order` の ASC 慣例 (最小 = リスト下端) を保つ。
  const ids = useMemo(() => videos.map((v) => v.id), [videos]);

  // ============================================================
  // 選択モード bulk action handlers (画面下部 floating bar から使う)
  // ============================================================

  const onBulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = await confirm({
      title: `選択した ${count} 件の動画を削除します`,
      description: "元に戻せません。よろしいですか？",
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    const results = await Promise.all(
      ids.map((id) => deleteCategoryLink(id)),
    );
    const failed = results
      .map((r, i) => ({ r, id: ids[i]! }))
      .filter((x) => !x.r.ok);
    setBulkDeleting(false);
    if (failed.length === 0) {
      toast.success(`${count} 件削除しました`);
      setSelectedIds(new Set());
      setSelectMode(false);
    } else {
      const okCount = count - failed.length;
      toast.error(
        `${okCount} 件削除、${failed.length} 件失敗: ${failed[0]?.r.ok === false ? failed[0].r.reason : ""}`,
      );
      setSelectedIds(new Set(failed.map((x) => x.id)));
    }
  }, [selectedIds, confirm]);

  const onBulkSaveClearTime = useCallback(async () => {
    let total = 0;
    let missing = 0;
    for (const v of liveWithFav) {
      if (!selectedIds.has(v.id)) continue;
      if (v.durationSeconds === null) missing += 1;
      else total += v.durationSeconds;
    }
    if (total <= 0) {
      toast.error(
        "選択中の動画はすべて再生時間未取得です。先に YouTube duration を取得してください",
      );
      return;
    }
    const summary = formatDurationLong(total);
    const missingNote =
      missing > 0
        ? `\n(${missing} 件は再生時間未取得 — 0 として扱います)`
        : "";
    const ok = await confirm({
      title: "クリアまでの累計時間として保存しますか？",
      description:
        `選択した ${selectedIds.size} 件の合計再生時間 ${summary} を` +
        `「クリアまでの累計時間」として保存します。${missingNote}\n` +
        `既存の手動入力は上書きされます。`,
      confirmText: "保存",
    });
    if (!ok) return;
    setSavingClearTime(true);
    const result = await updateCategory(categoryId, {
      manual_time_to_clear_seconds: total,
    });
    setSavingClearTime(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success(`クリア時間 ${summary} を保存しました`);
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [categoryId, liveWithFav, selectedIds, confirm]);

  // 選択中の全動画が既にお気に入りなら「外す」、そうでなければ「追加」。
  // ユーザーが手元の選択集合を 1 ボタンで揃えられる方が UX がシンプル。
  const bulkFavoriteAction: "add" | "remove" = useMemo(() => {
    if (selectedIds.size === 0) return "add";
    for (const v of liveWithFav) {
      if (!selectedIds.has(v.id)) continue;
      if (!v.isFavorite) return "add";
    }
    return "remove";
  }, [liveWithFav, selectedIds]);

  const onBulkToggleFavorite = useCallback(async () => {
    const target = bulkFavoriteAction === "add";
    const targets = liveWithFav.filter(
      (v) => selectedIds.has(v.id) && v.isFavorite !== target,
    );
    if (targets.length === 0) return;
    // optimistic を先に積み、続いて並列に server action 発火。
    setOptimisticFavorites((prev) => {
      const m = new Map(prev);
      for (const v of targets) m.set(v.id, target);
      return m;
    });
    setBulkFavoriting(true);
    const results = await Promise.all(
      targets.map((v) => setCategoryLinkFavorite(v.id, target)),
    );
    setBulkFavoriting(false);
    const failed = results
      .map((r, i) => ({ r, id: targets[i]!.id }))
      .filter((x) => !x.r.ok);
    if (failed.length === 0) {
      toast.success(
        target
          ? `${targets.length} 件をお気に入りに追加しました`
          : `${targets.length} 件をお気に入りから外しました`,
      );
    } else {
      // 失敗した分の optimistic を取り下げ。realtime で来る成功分は
      // useEffect が自動 sweep してくれる。
      setOptimisticFavorites((prev) => {
        const m = new Map(prev);
        for (const f of failed) m.delete(f.id);
        return m;
      });
      const okCount = targets.length - failed.length;
      toast.error(
        `${okCount} 件成功、${failed.length} 件失敗: ${failed[0]?.r.ok === false ? failed[0].r.reason : ""}`,
      );
    }
  }, [bulkFavoriteAction, liveWithFav, selectedIds]);

  // Cumulative duration across all videos in this category. NULL durations
  // (not yet backfilled) are treated as 0. timeToClear sums only videos
  // posted on/before the first-clear timestamp — same definition as the
  // category list page badge.
  const { totalSeconds, timeToClearSeconds, missingDurationCount } =
    useMemo(() => {
      let total = 0;
      let toClear = 0;
      let missing = 0;
      const clearMs = firstClearAt
        ? new Date(firstClearAt).getTime()
        : null;
      for (const v of live) {
        if (v.durationSeconds === null) {
          missing += 1;
          continue;
        }
        total += v.durationSeconds;
        if (clearMs !== null) {
          const ref = v.postedAt ?? v.createdAt;
          const t = new Date(ref).getTime();
          if (Number.isFinite(t) && t <= clearMs) toClear += v.durationSeconds;
        }
      }
      return {
        totalSeconds: total,
        timeToClearSeconds: toClear,
        missingDurationCount: missing,
      };
    }, [live, firstClearAt]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          <span>
            {videos.length} video{videos.length === 1 ? "" : "s"}
          </span>
          {/* 2.1 (2026-04-30) TODO 追加: status 依存で表示切り替え。
              - クリア済: violet「累計練習時間 (= 全動画合計)」
                + emerald「クリアまでの累計時間 (= firstClearAt 以前の合計)」
                両方表示。post-clear 動画があると 2 値が分かれる。
              - それ以外 (練習中 / 休止中 / 未着手): 1 つの emerald バッジで
                「コンテンツ挑戦時間」を表示。値は manual ?? totalSeconds。
                violet の累計練習時間とは値が同じになるので 1 つに集約。 */}
          {(() => {
            const isCleared = status === "クリア済";
            const showTotalBadge = isCleared && totalSeconds > 0;
            const challengeValue = isCleared
              ? (manualTimeToClearSeconds ?? timeToClearSeconds)
              : (manualTimeToClearSeconds ?? totalSeconds);
            const challengeLabel = isCleared
              ? "クリアまでの累計時間"
              : "コンテンツ挑戦時間";
            const showChallengeBadge =
              challengeValue > 0 && (isCleared ? !!firstClearAt : true);
            return (
              <>
                {showTotalBadge && (
                  <span
                    className="inline-flex items-center gap-1 rounded-sm border border-violet-400/40 bg-violet-400/10 px-1.5 py-px text-[9px] text-violet-200 normal-case"
                    title={`累計練習時間: ${formatDurationLong(totalSeconds)}${
                      missingDurationCount > 0
                        ? ` (${missingDurationCount} 件は再生時間未取得)`
                        : ""
                    }`}
                  >
                    <Timer className="h-2.5 w-2.5" aria-hidden />
                    {formatDurationShort(totalSeconds)}
                  </span>
                )}
                {showChallengeBadge && (
                  // 2.1 (2026-04-30) 追補: クリア状況を色で一目化。
                  //   - クリア済 = emerald (達成感、現状維持)
                  //   - 未クリア = violet (進行中・練習感)
                  // 紫は元々 cleared 表示の violet「累計練習時間」と
                  // 同色だが、未クリア時は emerald 側を消して 1 つに
                  // 集約しているので同一画面で同じ意味の violet が
                  // 重複することはない。
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[9px] normal-case " +
                      (isCleared
                        ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
                        : "border-violet-400/45 bg-violet-400/10 text-violet-200")
                    }
                    title={`${challengeLabel}: ${formatDurationLong(challengeValue)}${manualTimeToClearSeconds !== null ? " (手動入力)" : missingDurationCount > 0 && !isCleared ? ` (${missingDurationCount} 件は再生時間未取得)` : ""}`}
                  >
                    {isCleared ? (
                      <>→{formatDurationShort(challengeValue)}</>
                    ) : (
                      <>
                        <Hourglass className="h-2.5 w-2.5" aria-hidden />
                        {formatDurationShort(challengeValue)}
                      </>
                    )}
                  </span>
                )}
              </>
            );
          })()}
          {firstClearAt && (
            <button
              type="button"
              onClick={onJumpToFirstClear}
              className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-px text-[9px] text-amber-200 normal-case transition-colors hover:border-amber-400/70 hover:bg-amber-400/20 hover:text-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:outline-none"
              title={`初クリア: ${formatFirstClear(firstClearAt, "long")} (クリックで動画へジャンプ)`}
              aria-label={`${formatFirstClear(firstClearAt, "long")} のクリア動画へスクロール`}
            >
              <Trophy className="h-2.5 w-2.5" aria-hidden />
              {formatFirstClear(firstClearAt, "short")}
            </button>
          )}
          {videos.length > 1 && sortMode === "custom" && (
            // 2.1 (2026-04-29): "·" 文字はフォント依存で baseline が
            // 微妙にズレるので円形 div の bullet に置換し、隣接する
            // バッジ群と垂直中央が確実に揃うようにする。
            <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
              <span
                aria-hidden
                className="inline-block h-1 w-1 rounded-full bg-current"
              />
              ドラッグで並び替え
            </span>
          )}
        </div>
        {/* TODO #58: stuck 時のみ SubTabs 右端 portal、それ以外は元位置 in-flow。
            actions 群 (5要素: 選択 / ★ / 日付順 / カスタム / 動画追加) は state を
            videos-list 側で持つので、createPortal で DOM 位置だけ移しても state は
            維持される。flex-wrap は in-flow mobile 多段折返し用、portal 時も同じ
            class なので slot 内で折返しが起きうる (slot max-w-[60vw] + nav 縦に伸び)。 */}
        <ActionSlot>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 複数選択モード切替 (1.9.15) — オフ時はカード本体クリックが
              YouTube 再生 / 編集など通常動作。オン時はカード上に
              チェックボックスが現れ、クリックで選択切替。複数選択時は
              ヘッダー右端に「N 件削除」ボタンが追加表示される */}
          <button
            type="button"
            onClick={() => {
              setSelectMode((m) => {
                if (m) setSelectedIds(new Set());
                return !m;
              });
            }}
            className={
              "inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border px-2 text-[10px] tracking-normal transition-colors " +
              (selectMode
                ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground")
            }
            title={
              selectMode
                ? "選択モードを解除 (選択もリセット)"
                : "複数選択モードに入る"
            }
            aria-pressed={selectMode}
          >
            {selectMode ? (
              <CheckSquare className="h-3 w-3" aria-hidden />
            ) : (
              <Square className="h-3 w-3" aria-hidden />
            )}
            選択
          </button>
          {/* TODO #47 follow-up (2.1, 2026-04-30): bulk 系操作 (削除 / クリア
              時間 / お気に入り一括) は画面下部の floating bar に集約。
              ツールバーは選択モード中もレイアウト不変。 */}
          {/* TODO #47 (2.1, 2026-04-30): お気に入りのみ表示するフィルタ。
              ON のとき isFavorite=true の動画だけ描画。sort モードと独立。
              live に 1 件もお気に入りがない時はボタンを描画するが「(0)」を
              添えて、押しても空表示になることをヒントにする。 */}
          <button
            type="button"
            onClick={() => persistFavoritesOnly(!favoritesOnly)}
            className={
              "inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border px-2 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors " +
              (favoritesOnly
                ? "border-amber-400/60 bg-amber-400/12 text-amber-200"
                : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground")
            }
            aria-pressed={favoritesOnly}
            title={
              favoritesOnly
                ? "お気に入りフィルタを解除"
                : "お気に入りのみ表示"
            }
          >
            <Star
              className={
                "h-3 w-3 " + (favoritesOnly ? "fill-amber-300" : "")
              }
              aria-hidden
            />
            ★({favoriteCount})
          </button>
          {/* Sort mode toggle: 日付順 (newest first) or カスタム順 (DnD). */}
          <div
            className="inline-flex items-center rounded-md border border-border/40 bg-background/30 p-0.5 text-[10px] tracking-normal"
            role="radiogroup"
            aria-label="並び順"
          >
            <button
              type="button"
              onClick={() => persistSort("date")}
              role="radio"
              aria-checked={sortMode === "date"}
              className={
                "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors " +
                (sortMode === "date"
                  ? "bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Calendar className="h-3 w-3" aria-hidden />
              日付順
            </button>
            <button
              type="button"
              onClick={() => persistSort("custom")}
              role="radio"
              aria-checked={sortMode === "custom"}
              className={
                "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors " +
                (sortMode === "custom"
                  ? "bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <ListOrdered className="h-3 w-3" aria-hidden />
              カスタム
            </button>
          </div>
          <LinkFormDialog categoryId={categoryId} kind="video" />
        </div>
        </ActionSlot>
      </div>

      {videos.length === 0 ? (
        <Card className="glass flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)]">
            {favoritesOnly && live.length > 0 ? (
              <Star className="h-4 w-4" aria-hidden />
            ) : (
              <Film className="h-4 w-4" aria-hidden />
            )}
          </span>
          {favoritesOnly && live.length > 0 ? (
            <>
              <p className="font-display text-foreground text-sm">
                お気に入りに登録された動画はまだありません
              </p>
              <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                各カードの星アイコンをクリックすると、お気に入りに追加されます。
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-foreground text-sm">動画未登録</p>
              <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                YouTube の URL を登録するとサムネイル付きで表示されます。
                <br />
                その他の動画サイト URL もリンク表示できます。
              </p>
            </>
          )}
        </Card>
      ) : sortMode === "custom" ? (
        // Custom (DnD-enabled) layout. Each card carries a drag handle.
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleDragEnd(e, videos, (ids) => [...ids].reverse())}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <ul className="grid gap-4 sm:grid-cols-2">
              {videos.map((v) => (
                <SortableVideoCard
                  key={v.id}
                  video={v}
                  onEdit={setEditTarget}
                  onToggleFavorite={onToggleFavorite}
                  focused={focusActive && v.id === focusedVideoId}
                  refIfFocused={
                    v.id === focusedVideoId ? focusedRef : null
                  }
                  selectMode={selectMode}
                  selected={selectedIds.has(v.id)}
                  onToggleSelect={toggleSelected}
                  isActive={activeVideoId === v.id}
                  onActivate={setActiveVideoId}
                  onClose={handleCloseActive}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        // Date-sorted layout — DnD makes no sense here so render plain cards.
        <ul className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <li
              key={v.id}
              ref={v.id === focusedVideoId ? focusedRef : undefined}
              className={
                focusActive && v.id === focusedVideoId
                  ? "rounded-lg ring-2 ring-[var(--neon-cyan)]/60 ring-offset-2 ring-offset-background transition-shadow"
                  : ""
              }
            >
              <VideoCard
                video={v}
                onEdit={setEditTarget}
                onToggleFavorite={onToggleFavorite}
                selectMode={selectMode}
                selected={selectedIds.has(v.id)}
                onToggleSelect={toggleSelected}
                isActive={activeVideoId === v.id}
                onActivate={setActiveVideoId}
                onClose={handleCloseActive}
              />
            </li>
          ))}
        </ul>
      )}

      <LinkFormDialog
        categoryId={categoryId}
        kind="video"
        link={editTarget ?? undefined}
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      />

      {/* TODO #47 follow-up (2.1, 2026-04-30): 選択中の bulk 操作を集約する
          画面下部固定 action bar。スクロール位置に関係なく常時押せる。
          ツールバーから bulk 系を移したのでカード一覧の右上はレイアウト
          不変になる。selectMode 解除 / 0 件選択時は非表示。 */}
      {selectMode && selectedIds.size > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3"
          aria-live="polite"
        >
          <div className="glass pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-1.5 rounded-xl border border-border/50 bg-background/85 px-2.5 py-2 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.8)] backdrop-blur-md">
            <span className="px-1 text-[10px] tracking-normal text-[var(--neon-cyan)]">
              {selectedIds.size} 件選択中
            </span>
            <span
              aria-hidden
              className="hidden h-4 w-px bg-border/40 sm:inline-block"
            />
            <button
              type="button"
              disabled={bulkFavoriting}
              onClick={onBulkToggleFavorite}
              className="inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border border-amber-400/55 bg-amber-400/10 px-2 text-[10px] tracking-normal text-amber-200 transition-colors hover:border-amber-400/80 hover:bg-amber-400/20 disabled:opacity-50"
              title={
                bulkFavoriteAction === "add"
                  ? "選択した動画をすべてお気に入りに追加"
                  : "選択した動画をすべてお気に入りから外す"
              }
            >
              <Star
                className={
                  "h-3 w-3 " +
                  (bulkFavoriteAction === "remove" ? "fill-amber-300" : "")
                }
                aria-hidden
              />
              {bulkFavoriting
                ? "更新中…"
                : bulkFavoriteAction === "add"
                  ? `${selectedIds.size} 件 ★`
                  : `${selectedIds.size} 件 ★ 解除`}
            </button>
            <button
              type="button"
              disabled={savingClearTime}
              onClick={onBulkSaveClearTime}
              className="inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border border-emerald-400/55 bg-emerald-400/10 px-2 text-[10px] tracking-normal text-emerald-200 transition-colors hover:border-emerald-400/80 hover:bg-emerald-400/20 disabled:opacity-50"
              title="選択した動画の合計再生時間をクリアまでの累計時間として保存"
            >
              <Hourglass className="h-3 w-3" aria-hidden />
              {savingClearTime
                ? "保存中…"
                : `${selectedIds.size} 件をクリア時間に`}
            </button>
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={onBulkDelete}
              className="inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border border-rose-400/60 bg-rose-400/10 px-2 text-[10px] tracking-normal text-rose-200 transition-colors hover:border-rose-400/80 hover:bg-rose-400/20 disabled:opacity-50"
              title="選択した動画を削除"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {bulkDeleting ? "削除中…" : `${selectedIds.size} 件削除`}
            </button>
            <span
              aria-hidden
              className="hidden h-4 w-px bg-border/40 sm:inline-block"
            />
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setSelectMode(false);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-colors hover:text-foreground"
              title="選択モードを解除"
              aria-label="選択モードを解除"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SortableVideoCard = memo(function SortableVideoCard({
  video,
  onEdit,
  onToggleFavorite,
  focused = false,
  refIfFocused = null,
  selectMode = false,
  selected = false,
  onToggleSelect,
  isActive = false,
  onActivate,
  onClose,
}: {
  video: CategoryLink;
  onEdit: (video: CategoryLink) => void;
  onToggleFavorite?: (video: CategoryLink) => void;
  focused?: boolean;
  refIfFocused?: React.RefObject<HTMLLIElement | null> | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  isActive?: boolean;
  onActivate?: (id: string) => void;
  onClose?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  // Compose dnd-kit's setNodeRef with the optional focus ref so a
  // single <li> can satisfy both. Both functions/objects are called
  // with the DOM node when it mounts.
  const composedRef = (node: HTMLLIElement | null) => {
    setNodeRef(node);
    if (refIfFocused) {
      refIfFocused.current = node;
    }
  };

  return (
    <li
      ref={composedRef}
      style={style}
      {...attributes}
      className={
        focused
          ? "rounded-lg ring-2 ring-[var(--neon-cyan)]/60 ring-offset-2 ring-offset-background transition-shadow"
          : ""
      }
    >
      <VideoCard
        video={video}
        onEdit={onEdit}
        onToggleFavorite={onToggleFavorite}
        dragListeners={listeners}
        selectMode={selectMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        isActive={isActive}
        onActivate={onActivate}
        onClose={onClose}
      />
    </li>
  );
});

const VideoCard = memo(function VideoCard({
  video,
  onEdit,
  onToggleFavorite,
  dragListeners,
  selectMode = false,
  selected = false,
  onToggleSelect,
  isActive = false,
  onActivate,
  onClose,
}: {
  video: CategoryLink;
  onEdit: (video: CategoryLink) => void;
  onToggleFavorite?: (video: CategoryLink) => void;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  isActive?: boolean;
  onActivate?: (id: string) => void;
  onClose?: () => void;
}) {
  const ytId = parseYouTubeId(video.url);
  // memo の props を安定させるため、親から受けた引数付きコールバックを
  // このカードの video/id に束ねた安定関数へ変換して子孫へ渡す。
  const handleEdit = useCallback(() => onEdit(video), [onEdit, video]);
  const handleToggleFavorite = useCallback(
    () => onToggleFavorite?.(video),
    [onToggleFavorite, video],
  );
  const handleToggleSelect = useCallback(
    () => onToggleSelect?.(video.id),
    [onToggleSelect, video.id],
  );
  const handleActivate = useCallback(
    () => onActivate?.(video.id),
    [onActivate, video.id],
  );
  // safeHref returns undefined for non-http(s) values, which renders the
  // anchor as inert (no clickable XSS surface) — defense in depth alongside
  // the form-level + server-action validators.
  const videoHref = safeHref(video.url);
  const logsHref = safeHref(video.logsUrl);
  // TODO #94: FFLogs のレポート URL から XIVAnalysis の解析ページを組み立てる。
  // スキル回し / バフ整合 / CD 落ちをジョブ別に自動指摘してくれるツールで、
  // 「FFLogs までは飛べるがその先が手作業」だった導線を 1 クリックにする。
  const analysisHref = safeHref(toXivAnalysisUrl(video.logsUrl) ?? undefined);
  // 1.9 (2026-04-28): カード余白 (タイトル / 説明 / バッジ周辺の隙間など、
  // 既存の interactive 要素以外) をクリックで動画 URL を新規タブで開く。
  // インタラクティブな要素 (a / button / [data-card-no-nav]) 上のクリックは
  // closest() で検知して bail out するので既存挙動を破壊しない。
  // selectMode 中はカード全体が選択トグルなので無効化。
  // dragListeners が付いている (= カスタム並び替えモード) でも、card 余白の
  // ナビは敢えて止めない: ドラッグハンドルは別途 stopPropagation 済み。
  const onCardBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (selectMode) return;
    if (!videoHref) return;
    const interactive = (e.target as HTMLElement).closest(
      "a, button, [data-card-no-nav]",
    );
    if (interactive) return;
    window.open(videoHref, "_blank", "noopener,noreferrer");
  };
  return (
    <Card
      onClick={onCardBackgroundClick}
      className={
        "glass neon-edge group flex flex-col gap-1 overflow-hidden p-0 transition-all hover:-translate-y-0.5 " +
        (videoHref && !selectMode ? "cursor-pointer " : "") +
        (selected
          ? "ring-2 ring-rose-400/70 ring-offset-2 ring-offset-background"
          : "")
      }
    >
      <div className="relative">
        {ytId ? (
          <YouTubePreview
            id={ytId}
            url={video.url}
            title={video.title}
            isActive={isActive}
            onActivate={handleActivate}
            onClose={onClose}
          />
        ) : (
          <a
            href={videoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="grid aspect-video place-items-center bg-secondary/30 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <div className="flex flex-col items-center gap-2">
              <LinkSiteIcon
                url={video.url}
                variant="fine"
                className="h-8 w-8"
              />
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase">
                {LINK_SITE_LABEL[detectLinkSite(video.url)]}
              </span>
            </div>
          </a>
        )}

        {/* 選択モード中はサムネイル左上に大きめのチェックボックスを
            表示。サムネイル全体をクリックすると選択トグルになる。 */}
        {selectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleToggleSelect();
            }}
            aria-pressed={selected}
            aria-label={
              selected
                ? `${video.title} の選択を解除`
                : `${video.title} を選択`
            }
            className={
              "absolute inset-0 z-20 flex items-start justify-end p-3 transition-colors " +
              (selected
                ? "bg-rose-400/15"
                : "bg-black/0 hover:bg-black/20")
            }
          >
            <span
              className={
                "inline-flex h-7 w-7 items-center justify-center rounded-md border-2 backdrop-blur-sm transition-colors " +
                (selected
                  ? "border-rose-400 bg-rose-400/80 text-white"
                  : "border-white/70 bg-black/50 text-white/0")
              }
            >
              {selected ? (
                <CheckSquare className="h-4 w-4" aria-hidden />
              ) : (
                <Square className="h-4 w-4 opacity-90" aria-hidden />
              )}
            </span>
          </button>
        )}

        {/* Drag handle floats over the top-left corner of the thumbnail. */}
        {dragListeners && !selectMode && (
          <button
            type="button"
            {...dragListeners}
            aria-label={`${video.title} の並び替えハンドル`}
            className="absolute top-2 left-2 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex min-h-[2.625rem] items-start gap-2 px-3 pb-1">
        <a
          href={videoHref}
          target="_blank"
          rel="noopener noreferrer"
          title={video.title}
          className="line-clamp-2 min-w-0 flex-1 break-words font-display text-sm text-foreground transition-colors hover:text-[var(--neon-cyan)]"
        >
          {video.title}
        </a>
        {video.source === "discord" && (
          <span
            title="Discord から自動取り込み"
            aria-label="Discord 由来"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-indigo-400/40 bg-indigo-400/10 text-indigo-300"
          >
            <MessageCircle className="h-2.5 w-2.5" aria-hidden />
          </span>
        )}
        {/* TODO #47 (2.1, 2026-04-30): お気に入りトグル。アイコンのみ表示で
            on/off は色 + fill で表現。data-card-no-nav で背景クリック時の
            動画ナビを抑止。stopPropagation で iframe クリックも妨げない。 */}
        <button
          type="button"
          data-card-no-nav
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleToggleFavorite();
          }}
          aria-pressed={video.isFavorite}
          aria-label={
            video.isFavorite
              ? `${video.title} のお気に入りを解除`
              : `${video.title} をお気に入りに追加`
          }
          title={
            video.isFavorite
              ? "お気に入りから外す"
              : "お気に入りに追加"
          }
          className={
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors " +
            (video.isFavorite
              ? "text-amber-300 hover:text-amber-200"
              : "text-muted-foreground/60 hover:text-amber-300")
          }
        >
          <Star
            className={
              "h-3.5 w-3.5 " +
              (video.isFavorite ? "fill-amber-300" : "")
            }
            aria-hidden
          />
        </button>
        <LinkCardMenu link={video} onEdit={handleEdit} />
      </div>
      {/* Description は無くても 1 行分を確保してカード高さを揃える
          (text-xs 0.75rem × leading-relaxed 1.625 = 1.21875rem/line)。
          中身が 2 行に達した場合のみ 2 行分まで伸びる (`line-clamp-2`)。
          1.9 (2026-04-28) の Discord 取り込み〜FFLogs 間の余白圧縮要望に
          合わせ、reservation を 2 行 → 1 行に縮小。 */}
      <p
        title={video.description || undefined}
        className="line-clamp-2 min-h-[1.21875rem] px-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap"
      >
        {video.description || ""}
      </p>
      {/* Badges 行は内容が無くてもカード高さを揃えるため常に配置 (min-h で 1
          行分を確保)。FFLogs と durationSeconds は両方無い動画もある */}
      <div className="flex min-h-[1.75rem] flex-wrap items-center gap-1.5 px-3">
        {logsHref && (
          <a
            href={logsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm border border-amber-400/45 bg-amber-400/10 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-amber-200 uppercase transition-colors hover:bg-amber-400/15 hover:text-amber-100"
            title="FFLogs レポートを開く"
          >
            <BarChart3 className="h-3 w-3" aria-hidden />
            FFLogs
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        )}
        {analysisHref && (
          <a
            href={analysisHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm border border-sky-400/45 bg-sky-400/10 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-sky-200 uppercase transition-colors hover:bg-sky-400/15 hover:text-sky-100"
            title="XIVAnalysis で解析する（スキル回し / バフ整合 / CD 落ち）"
          >
            <Microscope className="h-3 w-3" aria-hidden />
            Analysis
            <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden />
          </a>
        )}
        {video.durationSeconds !== null && (
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-violet-400/40 bg-violet-400/10 px-1.5 py-1 font-mono text-[10px] tracking-[0.18em] text-violet-200"
            title={`再生時間: ${formatDurationLong(video.durationSeconds)}`}
          >
            <Timer className="h-2.5 w-2.5" aria-hidden />
            {formatDurationShort(video.durationSeconds)}
          </span>
        )}
      </div>
      <a
        href={videoHref}
        target="_blank"
        rel="noopener noreferrer"
        title={video.url}
        className="flex items-center gap-1 px-3 pb-3 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground/80"
      >
        <LinkSiteIcon
          url={video.url}
          variant="fine"
          className="h-3 w-3 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{video.url}</span>
      </a>
    </Card>
  );
});

/**
 * Click-to-load YouTube preview. Avoids embedding N iframes upfront so the
 * page stays fast — only the cards the user clicks become full <iframe>s.
 *
 * 1.9 (2026-04-28): viewport 近接前はサムネイル <Image> も描画しない
 * (= 通信を発生させない)。`IntersectionObserver` で「画面外 200px まで
 * 近づいたら」フラグを立て、初描画。狭幅の縦長スクロールでもページに
 * 入ってくる動画分だけ通信が発生する形に。1 度 true になったら以後は
 * 維持 (再 fetch は browser cache に任せる)。
 */
function YouTubePreview({
  id,
  url,
  title,
  isActive,
  onActivate,
  onClose,
}: {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
  onActivate?: () => void;
  onClose?: () => void;
}) {
  // 「再生中」状態は親 (VideosList) で 1 つだけ保持する設計。別カードで
  // 再生開始 → 親が activeVideoId を更新 → 旧カードの isActive が false に
  // なって iframe が unmount → 旧動画停止。
  const active = isActive;
  const setActive = (next: boolean) => {
    if (next) onActivate?.();
    else onClose?.();
  };
  const [thumbVisible, setThumbVisible] = useState(false);
  const containerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (thumbVisible) return;
    const el = containerRef.current;
    if (!el) return;
    // Older browsers / SSR fallback: draw thumbnail immediately so the
    // user never sees a blank box. Modern browsers proceed via IO.
    if (typeof IntersectionObserver === "undefined") {
      setThumbVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setThumbVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [thumbVisible]);

  if (active) {
    // シンプルなカード内 inline 再生に戻す (1.9 (2026-04-28))。
    // theater mode (fixed overlay でポップアップ拡大) は再生中の YouTube
    // プレーヤー UI と相互作用してマウスホバー時に再生不能になる挙動が
    // ユーザー環境で再現したため撤去。autoplay=1 でクリック 1 回で再生開始。
    const src = youtubeEmbedUrl(id) + "&autoplay=1";
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          frameBorder="0"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 h-full w-full"
        />
        {/* uploader が embed を完全無効化している動画用フォールバック。
           cross-origin で iframe 内のエラー 153 は portal 側からは検知
           できないため、「YouTube で開く」を常に表示してユーザーが
           即座に外部タブへ逃げられるようにしておく。 */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 font-mono text-[9px] tracking-[0.18em] text-white/85 uppercase backdrop-blur-sm transition-colors hover:bg-black/90 hover:text-white"
          aria-label="YouTube で開く"
          title="埋め込み再生できない場合はこちらから外部タブで再生"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          YouTube
        </a>
      </div>
    );
  }

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={() => setActive(true)}
      className="group/play relative aspect-video w-full overflow-hidden bg-black"
      aria-label={`${title} を再生`}
    >
      {thumbVisible ? (
        <Image
          src={youtubeThumbnailUrl(id)}
          alt={title}
          fill
          sizes="(min-width: 640px) 50vw, 100vw"
          className="object-cover opacity-90 transition-opacity group-hover/play:opacity-100"
          loading="lazy"
          unoptimized
        />
      ) : (
        // viewport 近接前のプレースホルダ — 同じ aspect ratio で枠だけ確保
        // し画像は読み込まない。subtle gradient で「動画カード」と分かる
        // だけの最小限の描画。
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-black via-zinc-900/60 to-zinc-800/50"
        />
      )}
      <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/60 via-transparent to-transparent">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70 text-white shadow-[0_0_24px_-4px_rgba(255,255,255,0.6)] transition-transform group-hover/play:scale-110">
          <Play className="h-5 w-5 fill-white" aria-hidden />
        </span>
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 font-mono text-[9px] tracking-[0.18em] text-white/80 uppercase transition-colors hover:text-white"
        aria-label="YouTube で開く"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        YouTube
      </a>
    </button>
  );
}
