"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Settings2,
  Trophy,
  X,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useDismissablePopup } from "@/lib/use-dismissable-popup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  backfillFirstClearFromExistingVideos,
  backfillPostedAtFromDiscordChannels,
  backfillStrategyThumbnailsChunk,
  backfillVideoDurationsChunk,
  importDiscordNow,
  type BackfillResult,
  type DurationBackfillResult,
  type ImportNowItem,
  type StrategyThumbnailBackfillResult,
} from "@/lib/server/categories-actions";
import { DiscordPanel } from "@/components/portal/maintenance/discord-panel";
import { VideoMetaPanel } from "@/components/portal/maintenance/video-meta-panel";
import { FirstClearPanel } from "@/components/portal/maintenance/first-clear-panel";
import { StrategyThumbPanel } from "@/components/portal/maintenance/strategy-thumb-panel";
import { type PostedAtBackfillResult } from "@/components/portal/maintenance/types";
import { useMessages } from "@/lib/i18n/client";

/**
 * Maintenance dropdown — gives the user one-click access to the
 * less-frequent operations:
 *   - Discord 取り込み (latest links from each channel)
 *   - 動画メタデータ取得 (YouTube duration + posted_at via YouTube
 *     and Discord, run as a single combined action)
 *   - クリア日時を強制再計算 (rebuilds from current videos, overwrites)
 *
 * 1.9.16: removed snapshot trigger (auto-runs daily; manual was a
 * mistake), the NULL-only firstClear action (always overwrite now —
 * simpler), and the per-URL diagnose tester (rarely useful).
 */
// 2.1 (2026-04-29) v6: Vercel Hobby plan の Edge function 上限 (25s) に
// 対応するため「全部実行」を撤廃し、3 個別ボタンに分割。各 phase が単独で
// 走るので 1 ボタンあたりの実行時間は十分短い (Discord 取り込みは並列化
// 後数秒、メタデータは chunked、firstClear は数秒)。
type ActionKind =
  | "discord"
  | "videoMeta"
  | "videoMetaForceRefresh"
  | "firstClearForce"
  | "strategyThumb"
  | "strategyThumbForceRefresh";

type Result =
  | { kind: "discord"; data: { items: ImportNowItem[] } }
  | {
      kind: "videoMeta";
      data: {
        durations: DurationBackfillResult;
        postedAt: PostedAtBackfillResult;
      };
    }
  | { kind: "firstClear"; data: BackfillResult; force: boolean }
  | {
      kind: "strategyThumb";
      data: {
        filled: number;
        failed: number;
        skippedNoImage: number;
        scanned: number;
      };
      force: boolean;
    };

/**
 * 1.9.21: live progress shown next to the dropdown trigger while
 * `videoMeta` is running. Each chunk updates these counters so the
 * user sees "X / Y 件" instead of an indefinite spinner.
 */
type VideoMetaProgress = {
  phase: "duration" | "postedAt";
  processed: number;
  total: number;
};

/**
 * Phase 14 (2.x, 2026-05-13): 攻略リンクのサムネイル backfill 進捗。
 * チャンク毎に processed/total を更新し、トリガーボタンに live 表示。
 */
type StrategyThumbProgress = {
  processed: number;
  total: number;
};

export function MaintenanceMenu() {
  const router = useRouter();
  const confirm = useConfirm();
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [pendingKind, setPendingKind] = useState<ActionKind | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // 1.9.21: live progress for videoMeta. null while idle.
  const [videoMetaProgress, setVideoMetaProgress] =
    useState<VideoMetaProgress | null>(null);
  // Phase 14: 攻略リンクサムネイル backfill のチャンク進捗。実行中だけ非 null。
  const [strategyThumbProgress, setStrategyThumbProgress] =
    useState<StrategyThumbProgress | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // 結果パネルの「外側クリック」判定でトリガーを内側扱いするための ref。
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // 結果ポップアップの開閉 (2026-08-30 Tier3-10: 共通フックへ集約)。
  // 旧実装には 2 つの問題があった:
  //   - トリガー (メニュー) を「外側」と扱っていたため、メニューを開き直す
  //     操作が結果パネルを閉じてしまう
  //   - cleanup で `prevActive?.focus?.()` を無条件に呼んでおり、result が
  //     変わるたびユーザーの現在フォーカスを奪い得た
  // フックは「フォーカスが body に落ちたときだけ戻す」ので後者は解消する。
  useDismissablePopup({
    open: result !== null,
    onClose: () => setResult(null),
    popupRef,
    triggerRef: menuTriggerRef,
  });

  // 出現時に結果領域へフォーカスを移して SR に知らせる (role="region")。
  useEffect(() => {
    if (result === null) return;
    popupRef.current?.focus();
  }, [result]);

  // ---- Phase helpers (called by individual + "all" handlers) ----

  /**
   * Run the chunked YouTube backfill loop, updating
   * `videoMetaProgress` as each chunk completes. Returns the
   * accumulated `DurationBackfillResult`.
   */
  const runVideoMetaPhase = async (
    force: boolean,
  ): Promise<{
    durations: DurationBackfillResult;
    postedAt: PostedAtBackfillResult;
  }> => {
    let totalScanned = 0;
    let totFilled = 0;
    let totFailed = 0;
    let totSkipped = 0;
    let total = 0;
    let lastId: string | null = null;
    let durFatal: string | undefined;
    for (let iter = 0; iter < 500; iter++) {
      const r = await backfillVideoDurationsChunk({
        afterId: lastId,
        forceRefresh: force,
      });
      if (!r.ok) {
        durFatal = r.reason ?? m.maintenance.unknownReason;
        break;
      }
      if (iter === 0 && typeof r.totalPending === "number") {
        total = r.totalPending;
        setVideoMetaProgress({
          phase: "duration",
          processed: 0,
          total,
        });
      }
      const inc = r.filled + r.failed + r.skippedNonYoutube;
      totalScanned += inc;
      totFilled += r.filled;
      totFailed += r.failed;
      totSkipped += r.skippedNonYoutube;
      setVideoMetaProgress({
        phase: "duration",
        processed: totalScanned,
        total: Math.max(total, totalScanned),
      });
      if (r.done) break;
      if (r.lastProcessedId === null) break;
      lastId = r.lastProcessedId;
    }
    const dur: DurationBackfillResult = durFatal
      ? {
          ok: false,
          reason: durFatal,
          scanned: totalScanned,
          filled: totFilled,
          failed: totFailed,
          skippedNonYoutube: totSkipped,
        }
      : {
          ok: true,
          scanned: totalScanned,
          filled: totFilled,
          failed: totFailed,
          skippedNonYoutube: totSkipped,
        };

    let posted: PostedAtBackfillResult;
    if (force || !dur.ok) {
      // Force refresh: YouTube uploadDate を真とするので Discord
      // 時刻フォールバックは呼ばない。dur 失敗時もスキップ。
      posted = {
        ok: true,
        scannedMessages: 0,
        scannedUrls: 0,
        matched: 0,
        updated: 0,
        channels: [],
      };
    } else {
      setVideoMetaProgress({ phase: "postedAt", processed: 0, total: 0 });
      posted = await backfillPostedAtFromDiscordChannels();
    }
    setVideoMetaProgress(null);
    return { durations: dur, postedAt: posted };
  };

  /**
   * Phase 14: 攻略リンクの thumbnail_url backfill をチャンクループで実行。
   * 各 chunk の集計値を accumulate し、UI に live 進捗を反映する。
   */
  const runStrategyThumbPhase = async (
    force: boolean,
  ): Promise<StrategyThumbnailBackfillResult> => {
    let totFilled = 0;
    let totFailed = 0;
    let totSkipped = 0;
    let total = 0;
    let processed = 0;
    let lastId: string | null = null;
    let fatal: string | undefined;
    for (let iter = 0; iter < 500; iter++) {
      const r = await backfillStrategyThumbnailsChunk({
        afterId: lastId,
        forceRefresh: force,
      });
      if (!r.ok) {
        fatal = r.reason ?? m.maintenance.unknownReason;
        break;
      }
      if (iter === 0 && typeof r.totalPending === "number") {
        total = r.totalPending;
        setStrategyThumbProgress({ processed: 0, total });
      }
      const inc = r.filled + r.failed + r.skippedNoImage;
      processed += inc;
      totFilled += r.filled;
      totFailed += r.failed;
      totSkipped += r.skippedNoImage;
      setStrategyThumbProgress({
        processed,
        total: Math.max(total, processed),
      });
      if (r.done) break;
      if (r.lastProcessedId === null) break;
      lastId = r.lastProcessedId;
    }
    setStrategyThumbProgress(null);
    if (fatal) {
      return {
        ok: false,
        reason: fatal,
        filled: totFilled,
        failed: totFailed,
        skippedNoImage: totSkipped,
        lastProcessedId: lastId,
        done: false,
      };
    }
    return {
      ok: true,
      filled: totFilled,
      failed: totFailed,
      skippedNoImage: totSkipped,
      lastProcessedId: lastId,
      done: true,
    };
  };

  const run = async (kind: ActionKind) => {
    // 強制再取得系は確認を transition の外で取る (ダイアログ表示中に
    // pending スピナーが先行点灯しないように)。
    if (kind === "videoMetaForceRefresh") {
      const ok = await confirm({
        title: m.maintenance.confirmPostedAtTitle,
        description: m.maintenance.confirmPostedAtDescription,
        confirmText: m.maintenance.run,
      });
      if (!ok) return;
    }
    if (kind === "strategyThumbForceRefresh") {
      const ok = await confirm({
        title: m.maintenance.confirmThumbTitle,
        description: m.maintenance.confirmThumbDescription,
        confirmText: m.maintenance.run,
      });
      if (!ok) return;
    }
    setResult(null);
    setPendingKind(kind);
    startTransition(async () => {
      try {
        if (kind === "discord") {
          const r = await importDiscordNow();
          if (!r.ok) {
            toast.error(
              m.maintenance.toastDiscordFailed(
                r.reason ?? m.maintenance.unknownReason,
              ),
            );
            return;
          }
          const summary =
            r.totalInserted > 0
              ? m.maintenance.discordInserted(r.totalInserted)
              : r.totalFailed > 0
                ? m.maintenance.discordFailedCount(r.totalFailed)
                : r.totalScanned > 0
                  ? m.maintenance.discordDuplicates
                  : m.maintenance.discordNoUrls;
          toast.success(summary);
          setResult({ kind: "discord", data: { items: r.items } });
          router.refresh();
          return;
        }
        if (kind === "videoMeta" || kind === "videoMetaForceRefresh") {
          const force = kind === "videoMetaForceRefresh";
          const { durations: dur, postedAt: posted } =
            await runVideoMetaPhase(force);
          if (!dur.ok) {
            toast.error(
              m.maintenance.toastDurationFailed(
                dur.reason ?? m.maintenance.unknownReason,
              ),
            );
            return;
          }
          if (!posted.ok) {
            toast.error(
              m.maintenance.toastPostedAtFailed(
                posted.reason ?? m.maintenance.unknownReason,
              ),
            );
            setResult({
              kind: "videoMeta",
              data: { durations: dur, postedAt: posted },
            });
            return;
          }
          const summaryParts: string[] = [];
          if (dur.filled > 0)
            summaryParts.push(m.maintenance.durationCount(dur.filled));
          if (posted.updated > 0)
            summaryParts.push(m.maintenance.postedAtCount(posted.updated));
          toast.success(
            summaryParts.length > 0
              ? summaryParts.join(" / ") + m.maintenance.fetchedSuffix
              : m.maintenance.noUpdates,
          );
          setResult({
            kind: "videoMeta",
            data: { durations: dur, postedAt: posted },
          });
          router.refresh();
          return;
        }
        if (kind === "firstClearForce") {
          const r = await backfillFirstClearFromExistingVideos({
            overwrite: true,
          });
          if (!r.ok) {
            toast.error(
              m.maintenance.toastScanFailed(
                r.reason ?? m.maintenance.unknownReason,
              ),
            );
            return;
          }
          toast.success(
            r.filled > 0
              ? m.maintenance.firstClearRecomputed(r.filled)
              : m.maintenance.firstClearNoUpdate(r.noMatch, r.alreadySet),
          );
          setResult({ kind: "firstClear", data: r, force: true });
          router.refresh();
          return;
        }
        if (
          kind === "strategyThumb" ||
          kind === "strategyThumbForceRefresh"
        ) {
          const force = kind === "strategyThumbForceRefresh";
          const r = await runStrategyThumbPhase(force);
          if (!r.ok) {
            toast.error(
              m.maintenance.toastThumbFailed(
                r.reason ?? m.maintenance.unknownReason,
              ),
            );
            return;
          }
          const scanned = r.filled + r.failed + r.skippedNoImage;
          const summary =
            r.filled > 0
              ? m.maintenance.thumbFetched(r.filled)
              : scanned > 0
                ? m.maintenance.thumbNoUpdate(r.skippedNoImage, r.failed)
                : m.maintenance.thumbNoTargets;
          toast.success(summary);
          setResult({
            kind: "strategyThumb",
            data: {
              filled: r.filled,
              failed: r.failed,
              skippedNoImage: r.skippedNoImage,
              scanned,
            },
            force,
          });
          router.refresh();
          return;
        }
      } finally {
        setPendingKind(null);
      }
    });
  };

  // 各ボタンのラベル・aria 文言をまとめて生成。pending 中は当該 kind に
  // ローダーを出し、それ以外はラベル維持 (ボタン disabled で同時実行防止)。
  const isThisPending = (k: ActionKind) => pending && pendingKind === k;
  const videoMetaProgressLabel = (() => {
    if (!videoMetaProgress) return m.maintenance.metaImporting;
    if (videoMetaProgress.phase === "duration") {
      if (videoMetaProgress.total > 0) {
        const pct = Math.floor(
          (videoMetaProgress.processed / videoMetaProgress.total) * 100,
        );
        return m.maintenance.metaProgress(
          videoMetaProgress.processed,
          videoMetaProgress.total,
          pct,
        );
      }
      return m.maintenance.metaCount(videoMetaProgress.processed);
    }
    return m.maintenance.postedAtFetching;
  })();

  const strategyThumbProgressLabel = (() => {
    if (!strategyThumbProgress) return m.maintenance.thumbFetching;
    if (strategyThumbProgress.total > 0) {
      const pct = Math.floor(
        (strategyThumbProgress.processed / strategyThumbProgress.total) * 100,
      );
      return m.maintenance.thumbProgress(
        strategyThumbProgress.processed,
        strategyThumbProgress.total,
        pct,
      );
    }
    return m.maintenance.thumbCount(strategyThumbProgress.processed);
  })();

  // pending 中はトリガーボタン側に該当ラベルを出す。実行中の phase が
  // 何かは見える方がユーザーの安心になるため、ラベル切替で表現。
  const triggerLabel = (() => {
    if (!pending) return m.maintenance.trigger;
    if (pendingKind === "discord") return m.maintenance.discordImporting;
    if (pendingKind === "firstClearForce") return m.maintenance.firstClearRunning;
    if (
      pendingKind === "videoMeta" ||
      pendingKind === "videoMetaForceRefresh"
    )
      return videoMetaProgressLabel;
    if (
      pendingKind === "strategyThumb" ||
      pendingKind === "strategyThumbForceRefresh"
    )
      return strategyThumbProgressLabel;
    return m.maintenance.running;
  })();

  return (
    <div className="relative flex flex-col gap-2">
      {/* 2.1 (2026-04-29) v6: Hobby plan の Edge function 上限 (25s) で
          全部実行が "Page Error" を返していたため各 phase を独立化。
          v7: ヘッダー圧迫を避けるため DropdownMenu に集約 (ユーザー要望)。
          トリガーは 1 ボタン、メニュー内に ① / ② / ③ を縦並び表示。 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuTriggerRef}
          disabled={pending}
          aria-label={m.maintenance.triggerAria}
          title={m.maintenance.triggerTitle}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {triggerLabel}
          {!pending && (
            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuItem
            onClick={() => run("discord")}
            disabled={pending}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5 text-[12px]">
              {isThisPending("discord") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
              )}
              {m.maintenance.discordItem}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground whitespace-nowrap">
              {m.maintenance.discordItemDesc}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("videoMeta")}
            disabled={pending}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5 text-[12px]">
              {isThisPending("videoMeta") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
              )}
              {m.maintenance.videoMetaItem}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground whitespace-nowrap">
              {m.maintenance.videoMetaItemDesc}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("firstClearForce")}
            disabled={pending}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5 text-[12px]">
              {isThisPending("firstClearForce") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trophy className="h-3.5 w-3.5 text-amber-300" aria-hidden />
              )}
              {m.maintenance.firstClearItem}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground whitespace-nowrap">
              {m.maintenance.firstClearItemDesc}
            </span>
          </DropdownMenuItem>
          {/* Phase 14 (2.x, 2026-05-13): 攻略リンクの og:image を一括取得。
              デフォルトは NULL のみ対象 (新規列の追加時の既存行 backfill)。
              「全件再取得」は SHIFT 等の修飾なしで誤爆させないため確認ダイアログ
              を runStrategyThumb 側で出す。 */}
          <DropdownMenuItem
            onClick={() => run("strategyThumb")}
            disabled={pending}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5 text-[12px]">
              {isThisPending("strategyThumb") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
              )}
              {m.maintenance.thumbItem}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground whitespace-nowrap">
              {m.maintenance.thumbItemDesc}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("strategyThumbForceRefresh")}
            disabled={pending}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex items-center gap-1.5 text-[12px]">
              {isThisPending("strategyThumbForceRefresh") ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 text-rose-300" aria-hidden />
              )}
              {m.maintenance.thumbForceItem}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground whitespace-nowrap">
              {m.maintenance.thumbForceItemDesc}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {result && (
        <div
          ref={popupRef}
          role="region"
          aria-label={m.maintenance.resultAria}
          tabIndex={-1}
          className="glass-popup relative z-30 max-h-[70vh] w-full overflow-y-auto rounded-md p-3 focus:outline-none sm:absolute sm:top-full sm:right-0 sm:mt-2 sm:w-[36rem] sm:max-w-[calc(100vw-2rem)]"
        >
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label={m.maintenance.closeResultAria}
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>

          {result.kind === "discord" && (
            <DiscordPanel items={result.data.items} />
          )}
          {result.kind === "videoMeta" && (
            <VideoMetaPanel
              durations={result.data.durations}
              postedAt={result.data.postedAt}
            />
          )}
          {result.kind === "firstClear" && (
            <FirstClearPanel data={result.data} force={result.force} />
          )}
          {result.kind === "strategyThumb" && (
            <StrategyThumbPanel data={result.data} force={result.force} />
          )}
        </div>
      )}
    </div>
  );
}

// 結果パネル (DiscordPanel / VideoMetaPanel / FirstClearPanel /
// StrategyThumbPanel) は C-5 で `./maintenance/*` に分離。

