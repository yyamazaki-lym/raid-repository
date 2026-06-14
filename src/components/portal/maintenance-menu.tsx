"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Settings2,
  Trophy,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/portal/confirm-dialog";
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

// Inline type since "use server" modules can't re-export pure types.
type PostedAtBackfillResult = {
  ok: boolean;
  reason?: string;
  scannedMessages: number;
  scannedUrls: number;
  matched: number;
  updated: number;
  channels: Array<{
    categorySlug: string;
    kind: "strategy" | "video";
    ok: boolean;
    reason?: string;
    scanned: number;
    updated: number;
  }>;
};

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

  // Click-outside-to-dismiss for the result popup.
  useEffect(() => {
    if (!result) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current && popupRef.current.contains(target)) return;
      setResult(null);
    };
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDocClick);
    };
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
        durFatal = r.reason ?? "原因不明";
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
        fatal = r.reason ?? "原因不明";
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
        title: "全動画の posted_at を再取得しますか？",
        description:
          "古い動画を Discord に貼って posted_at が誤って取り込み日になっている場合の修復用 (TODO #22)。\n動画件数 × 1 リクエスト発行されるため数十秒〜数分かかります。",
        confirmText: "実行",
      });
      if (!ok) return;
    }
    if (kind === "strategyThumbForceRefresh") {
      const ok = await confirm({
        title: "攻略リンク全件の og:image を再取得しますか？",
        description:
          "既に取得済みのサムネイルも上書きされます。\n登録件数 × 1 リクエスト発行されるため数十秒〜数分かかります。",
        confirmText: "実行",
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
            toast.error("Discord 取り込み失敗: " + (r.reason ?? "原因不明"));
            return;
          }
          const summary =
            r.totalInserted > 0
              ? `+${r.totalInserted} 件取り込み`
              : r.totalFailed > 0
                ? `0 件挿入 (失敗 ${r.totalFailed})`
                : r.totalScanned > 0
                  ? `0 件挿入 (重複スキップ)`
                  : `0 件 (URL 検出できず)`;
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
            toast.error("動画時間取得失敗: " + (dur.reason ?? "原因不明"));
            return;
          }
          if (!posted.ok) {
            toast.error("投稿日時取得失敗: " + (posted.reason ?? "原因不明"));
            setResult({
              kind: "videoMeta",
              data: { durations: dur, postedAt: posted },
            });
            return;
          }
          const summaryParts: string[] = [];
          if (dur.filled > 0) summaryParts.push(`動画時間 ${dur.filled} 件`);
          if (posted.updated > 0)
            summaryParts.push(`投稿日時 ${posted.updated} 件`);
          toast.success(
            summaryParts.length > 0
              ? summaryParts.join(" / ") + " を取得"
              : "更新なし",
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
            toast.error("スキャン失敗: " + (r.reason ?? "原因不明"));
            return;
          }
          toast.success(
            r.filled > 0
              ? `${r.filled} コンテンツのクリア日時を再計算`
              : `更新なし (該当 ${r.noMatch} / 設定済み ${r.alreadySet})`,
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
            toast.error("サムネ取得失敗: " + (r.reason ?? "原因不明"));
            return;
          }
          const scanned = r.filled + r.failed + r.skippedNoImage;
          const summary =
            r.filled > 0
              ? `サムネ ${r.filled} 件取得`
              : scanned > 0
                ? `更新なし (取得不可 ${r.skippedNoImage} / 失敗 ${r.failed})`
                : "対象なし";
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
    if (!videoMetaProgress) return "② メタ取込中…";
    if (videoMetaProgress.phase === "duration") {
      if (videoMetaProgress.total > 0) {
        const pct = Math.floor(
          (videoMetaProgress.processed / videoMetaProgress.total) * 100,
        );
        return `② 動画情報 ${videoMetaProgress.processed}/${videoMetaProgress.total} (${pct}%)`;
      }
      return `② 動画情報 ${videoMetaProgress.processed} 件`;
    }
    return "② 投稿日時取得中…";
  })();

  const strategyThumbProgressLabel = (() => {
    if (!strategyThumbProgress) return "④ サムネ取得中…";
    if (strategyThumbProgress.total > 0) {
      const pct = Math.floor(
        (strategyThumbProgress.processed / strategyThumbProgress.total) * 100,
      );
      return `④ サムネ ${strategyThumbProgress.processed}/${strategyThumbProgress.total} (${pct}%)`;
    }
    return `④ サムネ ${strategyThumbProgress.processed} 件`;
  })();

  // pending 中はトリガーボタン側に該当ラベルを出す。実行中の phase が
  // 何かは見える方がユーザーの安心になるため、ラベル切替で表現。
  const triggerLabel = (() => {
    if (!pending) return "メンテナンス";
    if (pendingKind === "discord") return "① Discord 取込中…";
    if (pendingKind === "firstClearForce") return "③ クリア再計算中…";
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
    return "実行中…";
  })();

  return (
    <div className="relative flex flex-col gap-2">
      {/* 2.1 (2026-04-29) v6: Hobby plan の Edge function 上限 (25s) で
          全部実行が "Page Error" を返していたため各 phase を独立化。
          v7: ヘッダー圧迫を避けるため DropdownMenu に集約 (ユーザー要望)。
          トリガーは 1 ボタン、メニュー内に ① / ② / ③ を縦並び表示。 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          aria-label="メンテナンスメニューを開く"
          title="Discord 取込 / 動画メタ / クリア再計算"
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
        <DropdownMenuContent align="end" className="w-64">
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
              ① Discord 取込
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              攻略情報 / 動画チャンネルから新着 URL を取り込み
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
              ② 動画メタ取得
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              YouTube 再生時間 + Discord 投稿日時
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
              ③ クリア再計算
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              クリア日時 + 累計時間を上書き再計算
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
              ④ サムネ取得
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              攻略リンクの og:image を取得 (NULL のみ)
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
              ④ サムネ全件再取得
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">
              全攻略リンク (取得済も上書き)
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {result && (
        <div
          ref={popupRef}
          className="glass-popup relative z-30 max-h-[70vh] w-full overflow-y-auto rounded-md p-3 sm:absolute sm:top-full sm:right-0 sm:mt-2 sm:w-[36rem] sm:max-w-[calc(100vw-2rem)]"
        >
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="結果を閉じる"
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

// ----- Result panels -------------------------------------------------------

function DiscordPanel({ items }: { items: ImportNowItem[] }) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        Discord 取り込み結果
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">対象チャンネルなし</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <DiscordIcon item={it} />
              <div className="flex-1 leading-relaxed">
                <span className="font-mono text-foreground">
                  {it.category}/{it.kind}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {describeDiscord(it)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DiscordIcon({ item }: { item: ImportNowItem }) {
  if (!item.ok)
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden />;
  if (item.skipped === "disabled")
    return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
  if (item.failed > 0)
    return <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden />;
  if (item.inserted > 0)
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden />;
  return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
}

function describeDiscord(it: ImportNowItem): string {
  if (!it.ok) return `エラー: ${it.reason ?? "原因不明"}`;
  if (it.skipped === "disabled") return "一時停止中";
  if (it.scanned === 0) {
    // Phase 13.1: フィルタ判定前に URL は見つかっていたが全件フィルタで弾かれた
    // ケースを「Bot 権限不足」と誤判定しない。prefilteredCount > 0 なら原因は
    // フィルタ設定なので、その旨を表示してユーザーに見直しを促す。
    if ((it.prefilteredCount ?? 0) > 0) {
      // Phase 13.3: フィルタ全件除外時、タイトル取得成功数も併記して
      // 「タイトル取得失敗 (0/N) が原因」なのか「ワード不一致が原因」なのかを
      // 区別できるようにする。titleFetchedCount は fresh (DB 未登録) URL 限定
      // なので、`prefilteredCount` (= 抽出ユニーク総数) と必ずしも一致しない。
      const tail =
        typeof it.titleFetchedCount === "number"
          ? ` (タイトル取得 ${it.titleFetchedCount})`
          : "";
      return `フィルタ条件に一致する URL なし (${it.prefilteredCount} 件中 0 件)${tail} — フィルタワード設定を見直し`;
    }
    return "URL 検出できず（チャンネル空 or Bot 不可）";
  }
  if (it.failed > 0)
    return `scanned ${it.scanned}, 失敗 ${it.failed}${it.reason ? " — " + it.reason : ""}`;
  if (it.inserted > 0)
    return `+${it.inserted} 件 (重複 ${it.duplicates})`;
  return `すべて重複 (${it.duplicates})`;
}

/**
 * 1.9.16: durations + postedAt の旧 2 ボタンを統合した結果パネル。
 * YouTube 取得 → Discord 取得 を順次実行し、両方の結果サマリーを 1
 * パネルに表示する。
 */
function VideoMetaPanel({
  durations,
  postedAt,
}: {
  durations: DurationBackfillResult;
  postedAt: PostedAtBackfillResult;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        動画メタデータ — 取得結果
      </p>
      <div className="flex flex-col gap-2 text-[11px] leading-relaxed">
        <section>
          <p className="font-mono text-[10px] text-violet-300/85 tracking-[0.18em] uppercase">
            YouTube (duration / uploadDate)
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            <li className="flex items-baseline gap-2">
              <span className="text-emerald-300">取得</span>
              <span className="font-mono text-foreground">
                {durations.filled}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="text-zinc-400">
                YouTube 以外 / 取得不可
              </span>
              <span className="font-mono text-foreground">
                {durations.skippedNonYoutube}
              </span>
            </li>
            {durations.failed > 0 && (
              <li className="flex items-baseline gap-2">
                <span className="text-rose-300">失敗</span>
                <span className="font-mono text-foreground">
                  {durations.failed}
                </span>
              </li>
            )}
            <li className="text-[10px] text-muted-foreground">
              対象: {durations.scanned} 件
            </li>
          </ul>
        </section>
        <section>
          <p className="font-mono text-[10px] text-emerald-300/85 tracking-[0.18em] uppercase">
            Discord (posted_at)
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            <li className="flex items-baseline gap-2">
              <span className="text-emerald-300">更新</span>
              <span className="font-mono text-foreground">
                {postedAt.updated}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="text-zinc-400">URL 一致</span>
              <span className="font-mono text-foreground">
                {postedAt.matched}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="text-[10px] text-muted-foreground">
              スキャン: {postedAt.scannedMessages} メッセージ /{" "}
              {postedAt.scannedUrls} URL
            </li>
          </ul>
          {postedAt.channels.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-[10px] leading-relaxed">
              {postedAt.channels.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 rounded-sm border border-border/40 bg-secondary/20 px-2 py-0.5 font-mono"
                >
                  <span className="text-foreground">
                    {c.categorySlug}/{c.kind}
                  </span>
                  <span
                    className={c.ok ? "text-emerald-300" : "text-rose-300"}
                  >
                    +{c.updated}
                  </span>
                  <span className="text-muted-foreground">
                    ({c.scanned} msgs)
                  </span>
                  {c.reason && (
                    <span className="text-rose-300">{c.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function FirstClearPanel({
  data,
}: {
  data: BackfillResult;
  force: boolean;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        クリア日時 / クリア時間 取得結果
      </p>
      {data.filled === 0 && data.noMatchDetails.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          更新なし（該当 {data.noMatch} / 設定済み {data.alreadySet}）
        </p>
      ) : (
        <>
          {data.filledDetails.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-[11px]">
              {data.filledDetails.map((d, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 leading-relaxed"
                >
                  <Trophy
                    className="mt-0.5 h-3 w-3 shrink-0 text-amber-300"
                    aria-hidden
                  />
                  <div className="flex-1">
                    <span className="font-mono text-foreground">
                      {d.slug}
                    </span>
                    <span className="ml-2 text-amber-200">
                      {formatLong(d.isoDate)}
                    </span>
                    <span
                      className={
                        "ml-2 inline-flex items-center rounded-sm border px-1 text-[9px] font-mono tracking-[0.18em] uppercase " +
                        (d.source === "title"
                          ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
                          : "border-zinc-400/45 bg-zinc-400/10 text-zinc-300")
                      }
                      title={
                        d.source === "title"
                          ? "動画タイトルから抽出した日付"
                          : "投稿日時を使用 (タイトルに日付なし)"
                      }
                    >
                      {d.source === "title"
                        ? "title"
                        : d.source === "posted_at"
                          ? "posted"
                          : "created"}
                    </span>
                    {d.timeToClearSeconds > 0 && (
                      <span className="ml-2 inline-flex items-center rounded-sm border border-violet-400/45 bg-violet-400/10 px-1 text-[9px] font-mono tracking-[0.18em] uppercase text-violet-200">
                        {formatHM(d.timeToClearSeconds)}
                      </span>
                    )}
                    {d.videosWithoutDurationCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-amber-400/45 bg-amber-400/10 px-1 text-[9px] tracking-normal text-amber-200"
                        title={`動画時間が未取得の動画が ${d.videosWithoutDurationCount} 件あります — 「動画時間 + 投稿日時を取得」で取り込んでからクリア時間を再計算してください`}
                      >
                        ⚠ {d.videosWithoutDurationCount} 件未取得
                      </span>
                    )}
                    {d.excludedForeignCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-zinc-400/45 bg-zinc-400/10 px-1 text-[9px] tracking-normal text-zinc-300"
                        title={`他コンテンツの動画を ${d.excludedForeignCount} 件除外`}
                      >
                        -{d.excludedForeignCount} 異
                      </span>
                    )}
                    <p className="mt-0.5 text-muted-foreground/80 break-words">
                      {d.videoTitle}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.noMatchDetails.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border/30 pt-2">
              <p className="text-[10px] font-medium text-rose-300/85 tracking-normal">
                該当なし — 詳細
              </p>
              <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
                {data.noMatchDetails.map((nm, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400/70"
                      aria-hidden
                    />
                    <div className="flex-1">
                      <span className="font-mono text-foreground">
                        {nm.slug}
                      </span>
                      <span className="ml-2 text-[10px] text-rose-200/85">
                        {explainNoMatchReason(nm.reason)}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        ({nm.inCategoryCount}/{nm.videoCount} 件)
                      </span>
                      {nm.titleSamples.length > 0 && (
                        <ul className="mt-0.5 flex flex-col gap-0.5 text-[10px] text-muted-foreground/80">
                          {nm.titleSamples.map((t, j) => (
                            <li key={j} className="break-words pl-2">
                              · {t}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(data.filled > 0 || data.noMatchDetails.length > 0) && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          設定済み {data.alreadySet} ／ 該当なし {data.noMatch} ／ 更新{" "}
          {data.filled}
        </p>
      )}
    </>
  );
}

/** Translate a no-match reason code into a Japanese hint. */
function explainNoMatchReason(
  reason: BackfillResult["noMatchDetails"][number]["reason"],
): string {
  switch (reason) {
    case "no-videos":
      return "動画が登録されていません";
    case "all-foreign":
      return "他コンテンツの動画のみ (フィルター除外)";
    case "no-clear-keyword":
      return "「クリア」/「clear」を含む動画がありません";
    case "no-final-floor":
      return "「4 層 / 4 層クリア / M4S」等の最終層クリアと判定できる動画がありません";
    case "missing-name":
      return "コンテンツ名未設定";
    default:
      return "未分類";
  }
}

function formatHM(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

function formatLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}

/**
 * Phase 14 (2.x, 2026-05-13): 攻略リンクサムネイル backfill の結果サマリー。
 * 取得成功 / og:image なし / Supabase エラー の 3 値を表示。
 */
function StrategyThumbPanel({
  data,
  force,
}: {
  data: {
    filled: number;
    failed: number;
    skippedNoImage: number;
    scanned: number;
  };
  force: boolean;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        攻略サムネ — {force ? "全件再取得" : "NULL のみ"} 結果
      </p>
      <ul className="flex flex-col gap-0.5 text-[11px]">
        <li className="flex items-baseline gap-2">
          <span className="text-emerald-300">取得</span>
          <span className="font-mono text-foreground">{data.filled}</span>
          <span className="text-muted-foreground">件</span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="text-zinc-400">og:image なし</span>
          <span className="font-mono text-foreground">
            {data.skippedNoImage}
          </span>
          <span className="text-muted-foreground">件</span>
        </li>
        {data.failed > 0 && (
          <li className="flex items-baseline gap-2">
            <span className="text-rose-300">失敗</span>
            <span className="font-mono text-foreground">{data.failed}</span>
            <span className="text-muted-foreground">件</span>
          </li>
        )}
        <li className="text-[10px] text-muted-foreground">
          対象: {data.scanned} 件
        </li>
      </ul>
    </>
  );
}

