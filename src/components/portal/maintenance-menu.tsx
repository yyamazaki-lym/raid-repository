"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Cloud,
  Loader2,
  Settings2,
  Stethoscope,
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
  backfillVideoDurations,
  diagnoseYouTubeUrl,
  importDiscordNow,
  type BackfillResult,
  type DurationBackfillResult,
  type ImportNowItem,
  type YouTubeDiagnosticResult,
} from "@/lib/server/categories-actions";

/**
 * Single dropdown that consolidates the three rarely-used maintenance
 * actions (Discord import, video-duration backfill, first-clear backfill)
 * behind one ⚙ button — they were previously laid out side-by-side and
 * cluttering the categories header.
 *
 * Each action displays its result in a shared popup region below the menu
 * button, with click-outside-to-dismiss and an explicit ✕ close.
 */
type ActionKind =
  | "discord"
  | "durations"
  | "firstClear"
  | "firstClearForce"
  | "diagnose";

type Result =
  | { kind: "discord"; data: { items: ImportNowItem[] } }
  | { kind: "durations"; data: DurationBackfillResult }
  | { kind: "firstClear"; data: BackfillResult; force: boolean }
  | { kind: "diagnose"; data: YouTubeDiagnosticResult };

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
        if (kind === "durations") {
          const r = await backfillVideoDurations();
          if (!r.ok) {
            toast.error("動画時間取得失敗: " + (r.reason ?? "unknown"));
            return;
          }
          toast.success(
            r.filled > 0
              ? `${r.filled} 件の動画時間を取得`
              : r.scanned === 0
                ? "未取得の動画なし"
                : `更新なし (YouTube 以外: ${r.skippedNonYoutube})`,
          );
          setResult({ kind: "durations", data: r });
          router.refresh();
          return;
        }
        if (kind === "diagnose") {
          const url = window.prompt(
            "診断する YouTube URL を入力してください：\n（既存動画の URL をコピペ → 各ステップの結果を表示）",
            "https://www.youtube.com/watch?v=",
          );
          if (!url) return;
          const r = await diagnoseYouTubeUrl(url);
          if (r.durationSeconds || r.uploadDate) {
            toast.success(
              `取得成功: duration=${r.durationSeconds}s upload=${r.uploadDate?.slice(0, 10)}`,
            );
          } else {
            toast.error("取得失敗 — 詳細はパネルで確認");
          }
          setResult({ kind: "diagnose", data: r });
          return;
        }
        // firstClear (NULL only) or firstClearForce
        const force = kind === "firstClearForce";
        if (force) {
          const ok = window.confirm(
            "全カテゴリーのクリア日時を動画から再計算します。\n手動で編集した値も上書きされます。続行しますか？",
          );
          if (!ok) return;
        }
        const r = await backfillFirstClearFromExistingVideos({ overwrite: force });
        if (!r.ok) {
          toast.error("スキャン失敗: " + (r.reason ?? "unknown"));
          return;
        }
        toast.success(
          r.filled > 0
            ? `${r.filled} カテゴリーのクリア日時を${force ? "再計算" : "設定"}`
            : `更新なし (該当 ${r.noMatch} / 設定済み ${r.alreadySet})`,
        );
        setResult({ kind: "firstClear", data: r, force });
        router.refresh();
      } finally {
        setPendingKind(null);
      }
    });
  };

  return (
    <div className="relative flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground disabled:opacity-60"
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
              : pendingKind === "durations"
                ? "時間取得中…"
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
            onClick={() => run("durations")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">動画時間 + 投稿日時を取得</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                未取得の動画から duration と posted_at を一括取得
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("firstClear")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">クリア日時を設定（NULL のみ）</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                未設定カテゴリーに動画タイトルから初クリア日を埋める
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run("firstClearForce")}
            className="flex cursor-pointer items-start gap-2 text-rose-200 focus:text-rose-100"
          >
            <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">クリア日時を強制再計算</span>
              <span className="text-[10px] text-rose-300/70 leading-snug">
                既存値を含めて全カテゴリー再計算（手動編集も上書き）
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => run("diagnose")}
            className="flex cursor-pointer items-start gap-2"
          >
            <Stethoscope className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-300" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">1件テスト（診断用）</span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                単一 URL を fetch して取得結果＆失敗ステップを表示
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
          {result.kind === "durations" && (
            <DurationsPanel data={result.data} />
          )}
          {result.kind === "firstClear" && (
            <FirstClearPanel data={result.data} force={result.force} />
          )}
          {result.kind === "diagnose" && <DiagnosePanel data={result.data} />}
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

function DurationsPanel({ data }: { data: DurationBackfillResult }) {
  return (
    <>
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        動画時間 + 投稿日時 — 取得結果
      </p>
      <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-emerald-300">取得</span>
          <span className="font-mono text-foreground">{data.filled}</span>
          <span className="text-muted-foreground">件</span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-zinc-400">YouTube 以外/取得不可</span>
          <span className="font-mono text-foreground">
            {data.skippedNonYoutube}
          </span>
        </li>
        {data.failed > 0 && (
          <li className="flex items-baseline gap-2">
            <span className="font-mono text-rose-300">失敗</span>
            <span className="font-mono text-foreground">{data.failed}</span>
          </li>
        )}
        <li className="mt-1 text-[10px] text-muted-foreground">
          対象: {data.scanned} 件
        </li>
      </ul>
    </>
  );
}

function FirstClearPanel({
  data,
  force,
}: {
  data: BackfillResult;
  force: boolean;
}) {
  return (
    <>
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        クリア日時 — {force ? "強制再計算" : "設定"}結果
      </p>
      {data.filled === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          更新なし（該当 {data.noMatch} / 設定済み {data.alreadySet}）
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {data.filledDetails.map((d, i) => (
            <li key={i} className="flex items-start gap-2 leading-relaxed">
              <Trophy className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
              <div className="flex-1">
                <span className="font-mono text-foreground">{d.slug}</span>
                <span className="ml-2 text-amber-200">
                  {formatLong(d.isoDate)}
                </span>
                <p className="mt-0.5 text-muted-foreground/80 break-words">
                  {d.videoTitle}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.filled > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          設定済み {data.alreadySet} ／ 該当なし {data.noMatch}
        </p>
      )}
    </>
  );
}

function DiagnosePanel({ data }: { data: YouTubeDiagnosticResult }) {
  return (
    <>
      <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        YouTube 診断
      </p>
      <p className="mb-2 break-all font-mono text-[10px] text-muted-foreground">
        {data.url}
      </p>
      <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-muted-foreground">duration</span>
          <span className="font-mono text-foreground">
            {data.durationSeconds === null
              ? "—"
              : `${data.durationSeconds}s`}
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-muted-foreground">uploadDate</span>
          <span className="font-mono text-foreground">
            {data.uploadDate ?? "—"}
          </span>
        </li>
      </ul>
      <p className="mt-3 mb-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        試行ログ
      </p>
      <ul className="flex flex-col gap-1 text-[10px] leading-relaxed">
        {data.attempts.map((a, i) => (
          <li
            key={i}
            className="rounded-sm border border-border/40 bg-secondary/20 px-2 py-1 font-mono"
          >
            <div>
              <span className="text-muted-foreground">{a.host}</span>
              <span className="ml-2">
                status=
                <span
                  className={
                    typeof a.status === "number" && a.status === 200
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }
                >
                  {a.status}
                </span>
              </span>
              {a.htmlSize !== null && (
                <span className="ml-2 text-muted-foreground">
                  size={a.htmlSize}
                </span>
              )}
              {a.matchedStrategy && (
                <span className="ml-2 text-emerald-300">
                  via {a.matchedStrategy}
                </span>
              )}
            </div>
            <div>
              length=
              <span className={a.foundLength ? "text-emerald-300" : "text-rose-300"}>
                {a.foundLength ? "OK" : "NONE"}
              </span>
              <span className="ml-2">
                upload=
                <span className={a.foundUpload ? "text-emerald-300" : "text-rose-300"}>
                  {a.foundUpload ? "OK" : "NONE"}
                </span>
              </span>
            </div>
            {a.pageMarkers && (
              <div className="text-muted-foreground break-words">
                player=
                <span
                  className={
                    a.pageMarkers.hasPlayerResponse
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }
                >
                  {a.pageMarkers.hasPlayerResponse ? "Y" : "N"}
                </span>
                {" "}
                ldjson=
                <span
                  className={
                    a.pageMarkers.hasLdJson
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }
                >
                  {a.pageMarkers.hasLdJson ? "Y" : "N"}
                </span>
                {" "}
                meta=
                <span
                  className={
                    a.pageMarkers.hasItempropDuration
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }
                >
                  {a.pageMarkers.hasItempropDuration ? "Y" : "N"}
                </span>
                {a.pageMarkers.hasConsentText && (
                  <span className="ml-2 text-amber-300">consent!</span>
                )}
                {a.pageMarkers.hasSignInWall && (
                  <span className="ml-2 text-amber-300">signin!</span>
                )}
              </div>
            )}
            {a.note && (
              <div className="text-amber-300 break-words">{a.note}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
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
