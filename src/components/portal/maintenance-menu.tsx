"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Cloud,
  Loader2,
  Settings2,
  Timer,
  Trophy,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  backfillFirstClearFromExistingVideos,
  backfillPostedAtFromDiscordChannels,
  backfillVideoDurations,
  importDiscordNow,
  type BackfillResult,
  type DurationBackfillResult,
  type ImportNowItem,
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
type ActionKind = "discord" | "videoMeta" | "firstClearForce";

type Result =
  | { kind: "discord"; data: { items: ImportNowItem[] } }
  | {
      kind: "videoMeta";
      data: {
        durations: DurationBackfillResult;
        postedAt: PostedAtBackfillResult;
      };
    }
  | { kind: "firstClear"; data: BackfillResult; force: boolean };

export function MaintenanceMenu() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKind, setPendingKind] = useState<ActionKind | null>(null);
  const [result, setResult] = useState<Result | null>(null);
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

  const run = (kind: ActionKind) => {
    setResult(null);
    setPendingKind(kind);
    startTransition(async () => {
      try {
        if (kind === "discord") {
          const r = await importDiscordNow();
          if (!r.ok) {
            toast.error("Discord 取り込み失敗: " + (r.reason ?? "unknown"));
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
        if (kind === "videoMeta") {
          // 1.9.16 統合アクション: YouTube から duration / uploadDate を
          // 取得 → そのあと Discord メッセージから posted_at を埋める。
          // 旧 "durations" + "postedAt" を 1 ボタン化。
          const dur = await backfillVideoDurations();
          if (!dur.ok) {
            toast.error("動画時間取得失敗: " + (dur.reason ?? "unknown"));
            return;
          }
          const posted = await backfillPostedAtFromDiscordChannels();
          if (!posted.ok) {
            toast.error("投稿日時取得失敗: " + (posted.reason ?? "unknown"));
            // duration の結果は表示する
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
            toast.error("スキャン失敗: " + (r.reason ?? "unknown"));
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
      } finally {
        setPendingKind(null);
      }
    });
  };

  return (
    <div className="relative flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground disabled:opacity-60"
          disabled={pending}
          aria-label="メンテナンスメニュー"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {pending
            ? pendingKind === "discord"
              ? "取り込み中…"
              : pendingKind === "videoMeta"
                ? "メタデータ取得中…"
                : "再スキャン中…"
            : "メンテナンス"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="glass-popup min-w-60">
          <DropdownMenuItem
            onClick={() => run("discord")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Discord 取り込み</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                各チャンネルの最新メッセージから URL を取得
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => run("videoMeta")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">動画時間 + 投稿日時を取得</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                YouTube から duration / uploadDate を一括取得 +
                Discord メッセージから posted_at を埋める
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("firstClearForce")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Trophy
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300"
              aria-hidden
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">クリア日時 / クリア時間の取得</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                各コンテンツのクリア日と「クリアまでの累計時間」を再計算
                (手動設定値も上書きされます)
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {result && (
        <div
          ref={popupRef}
          className="glass-popup relative z-30 w-full max-w-md rounded-md p-3 sm:absolute sm:top-full sm:right-0 sm:mt-2"
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
        </div>
      )}
    </div>
  );
}

// ----- Result panels -------------------------------------------------------

function DiscordPanel({ items }: { items: ImportNowItem[] }) {
  return (
    <>
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
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
  if (!it.ok) return `エラー: ${it.reason ?? "unknown"}`;
  if (it.skipped === "disabled") return "一時停止中";
  if (it.scanned === 0) return "URL 検出できず（チャンネル空 or Bot 不可）";
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
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        動画メタデータ — 取得結果
      </p>
      <div className="flex flex-col gap-2 text-[11px] leading-relaxed">
        <section>
          <p className="font-mono text-[10px] text-violet-300/85 tracking-[0.18em] uppercase">
            YouTube (duration / uploadDate)
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-emerald-300">取得</span>
              <span className="font-mono text-foreground">
                {durations.filled}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-zinc-400">
                YouTube 以外 / 取得不可
              </span>
              <span className="font-mono text-foreground">
                {durations.skippedNonYoutube}
              </span>
            </li>
            {durations.failed > 0 && (
              <li className="flex items-baseline gap-2">
                <span className="font-mono text-rose-300">失敗</span>
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
              <span className="font-mono text-emerald-300">更新</span>
              <span className="font-mono text-foreground">
                {postedAt.updated}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-zinc-400">URL 一致</span>
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
      <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
        ⚡ この後「クリア日時を強制再計算」を実行すると、正しい
        posted_at で計算されます
      </p>
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
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
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
                        className="ml-2 inline-flex items-center rounded-sm border border-amber-400/45 bg-amber-400/10 px-1 text-[9px] font-mono tracking-[0.18em] uppercase text-amber-200"
                        title={`動画時間が未取得の動画が ${d.videosWithoutDurationCount} 件あります — 「動画時間 + 投稿日時を取得」で取り込んでからクリア時間を再計算してください`}
                      >
                        ⚠ {d.videosWithoutDurationCount} 件未取得
                      </span>
                    )}
                    {d.excludedForeignCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-zinc-400/45 bg-zinc-400/10 px-1 text-[9px] font-mono tracking-[0.18em] uppercase text-zinc-300"
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
              <p className="font-mono text-[10px] text-rose-300/85 tracking-[0.18em] uppercase">
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

// Removed in 1.9.16: SnapshotPanel + DiagnosePanel + PostedAtPanel +
// DurationsPanel. Snapshot trigger and per-URL diagnose tester were
// never useful in production (auto-cron handles snapshots; the
// diagnose tester required users to know what they were debugging).
// Durations / postedAt panels are merged into VideoMetaPanel above.

function formatLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}
