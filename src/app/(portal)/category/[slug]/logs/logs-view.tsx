"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Film,
  Flag,
  Microscope,
  RefreshCw,
  Trophy,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/portal/empty-state";
import { MirrorActionSlot } from "@/components/portal/action-slot";
import {
  formatFightDuration,
  formatPercentage,
  progressTimeline,
  summarize,
  type DaySummary,
  type FightRow,
} from "@/lib/fflogs-progress";
import {
  buildFflogsReportUrl,
  buildVideoTimestampUrl,
  buildXivAnalysisUrl,
  formatClock,
} from "@/lib/fflogs-url";
import { isUltimateContent } from "@/lib/content-groups";
import { humanizeFflogsSyncReason } from "@/lib/fflogs-sync-reason";
import type { ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import {
  setReportVideoAction,
  suggestVideoForReportAction,
  syncFflogsFightsAction,
} from "@/lib/server/fflogs-fights-actions";

/**
 * 練習ログの表示 (TODO #94 / A-1 + A-2)。
 *
 * A-1 (進捗): 上部のサマリ + 日ごとの pull 数バー。「先週より進んでいるか」
 *   が一目で分かることが目的なので、記録更新日にはバッジを立てる。
 * A-2 (振り返り): 日を開くと pull 一覧。各 pull から
 *   - FFLogs の該当 fight
 *   - XIVAnalysis のその pull の解析
 *   - 動画のその瞬間 (オフセット登録済みの report のみ)
 *   に 1 クリックで飛べる。
 *
 * 表示するのは PT としての到達度のみ。個人 DPS は集計も表示もしない。
 */
export function LogsView({
  categoryName,
  fights,
  totalPulls,
  totalKills,
  truncated,
  videoLinks,
  failedSyncs,
  canEdit,
}: {
  categoryName: string;
  /** 明細。件数が多いカテゴリでは直近分だけが渡る (`truncated`)。 */
  fights: FightRow[];
  /** カテゴリ全体の pull 数 / クリア数 (明細が打ち切られていても正確)。 */
  totalPulls: number;
  totalKills: number;
  truncated: boolean;
  videoLinks: Record<string, ReportVideoLink>;
  failedSyncs: Array<{
    reportCode: string;
    reason: string | null;
    unassigned: boolean;
  }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [offsetTarget, setOffsetTarget] = useState<{
    reportCode: string;
    videoUrl: string;
    offset: string;
  } | null>(null);

  const summary = useMemo(() => summarize(fights), [fights]);
  // フェーズ (P1〜) 単位で管理するのは実質「絶」だけ。零式で「P2 8.3%」の
  // ような表記を出すとノイズになる (2026-08-28 ユーザー指摘) ので、
  // 絶コンテンツと判定できたときだけフェーズを表示する。
  const showPhase = useMemo(() => isUltimateContent(categoryName), [categoryName]);
  const timeline = useMemo(
    () => progressTimeline(summary.days),
    [summary.days],
  );

  const runSync = () => {
    startSync(async () => {
      const result = await syncFflogsFightsAction();
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(
        `同期完了 — ${result.reportsFetched} レポート / ${result.fightsUpserted} pull` +
          (result.reattributed > 0 ? ` / 再分類 ${result.reattributed}` : "") +
          (result.failed > 0 ? ` (失敗 ${result.failed})` : "") +
          (result.truncated ? " ※途中まで" : ""),
      );
      router.refresh();
    });
  };

  const syncButton = canEdit ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={runSync}
      disabled={syncing}
      className="gap-1.5 text-[11px] tracking-normal"
    >
      <RefreshCw
        className={"h-3.5 w-3.5 " + (syncing ? "animate-spin" : "")}
        aria-hidden
      />
      {syncing ? "同期中..." : "ログを同期"}
    </Button>
  ) : null;

  if (fights.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex justify-end">{syncButton}</div>
        <div className="flex flex-col gap-2">
          <EmptyState
            icon={Activity}
            title="練習ログがまだありません"
            description={
              "FFLogs のレポートを取り込むと、pull 数・到達度・残 HP% がここに並びます。" +
              "レポートは「動画に FFLogs URL を紐づける」「コンテンツ編集の FFLogs zone ID / マッチワード」" +
              "またはレポートの zone 名からこのコンテンツに割り当てられます。" +
              "非公開 (private / unlisted) レポートは連携した本人のもの以外 API では取得できません" +
              " (確実な対処はレポートを Public にすること。アップローダの既定公開設定を Public にすると以後は自動で入ります)。"
            }
          />
          <p className="text-center text-[11px] text-muted-foreground">
            データ元:{" "}
            <a
              href="https://www.fflogs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              FFLogs
            </a>
            {" / 解析: "}
            <a
              href="https://xivanalysis.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              XIVAnalysis
            </a>
          </p>
        </div>
        {failedSyncs.length > 0 && (
          <FailedList failedSyncs={failedSyncs} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--neon-cyan)]" aria-hidden />
          <h2 className="font-display text-base">練習ログ</h2>
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
            {categoryName}
          </span>
        </div>
        {syncButton}
        {syncButton && <MirrorActionSlot>{syncButton}</MirrorActionSlot>}
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="総 pull"
          value={String(totalPulls)}
          sub={truncated ? `直近 ${summary.totalPulls} 件を表示` : undefined}
        />
        <StatCard
          label="練習日数"
          value={`${summary.days.length} 日`}
        />
        <StatCard
          label="最深到達"
          value={
            // クリア済みなら「残 0%」ではなく「討伐」と言い切る。
            totalKills > 0
              ? "討伐"
              : showPhase && summary.bestPhase !== null
                ? `P${summary.bestPhase}`
                : summary.bestPercentage !== null
                  ? `残 ${formatPercentage(summary.bestPercentage)}`
                  : "—"
          }
          sub={
            totalKills > 0
              ? undefined
              : showPhase && summary.bestPhase !== null
                ? `残 ${formatPercentage(summary.bestPercentage)}`
                : undefined
          }
        />
        <StatCard
          label="クリア"
          value={totalKills > 0 ? `${totalKills} 回` : "—"}
          sub={
            // 明細が打ち切られている場合の「初クリア」は表示範囲内の最古の
            // クリアでしかないので出さない (誤情報を作らない)。
            !truncated && summary.firstKill
              ? `初クリア ${new Date(summary.firstKill.startMs).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`
              : undefined
          }
          highlight={totalKills > 0}
        />
      </ul>

      {/* A-1: 日ごとの到達度の推移。
          バーの長さ = その日のベスト到達度 (100 − 残 HP%)。バーが右端に
          届いたらクリア、伸びていく様子がそのまま「進んでいる実感」になる。
          旧実装はバー = pull 数で「量」しか見えず、肝心の「どこまで行けたか」
          が読み取れなかった (2026-08-28 ユーザー指摘)。 */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            日ごとの到達度
          </h3>
          <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70">
            バー = ベスト到達度 / 右端 = 討伐
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {[...timeline].reverse().map((t) => {
            // 到達度 (%)。kill 日は 100、残 HP 不明の日は 0 扱いで薄く出す。
            const progress = t.hasKill
              ? 100
              : t.bestPercentage !== null
                ? Math.max(0, Math.min(100, 100 - t.bestPercentage))
                : 0;
            return (
              <li key={t.date} className="flex items-center gap-2">
                <span className="w-[4.5rem] shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {t.date.slice(5)}
                </span>
                <span className="relative flex h-4 min-w-0 flex-1 items-center rounded-sm bg-secondary/40">
                  <span
                    className={
                      "h-full rounded-sm " +
                      (t.hasKill
                        ? "bg-emerald-400/75"
                        : t.isRecord
                          ? "bg-[var(--neon-cyan)]/70"
                          : "bg-[var(--neon-cyan)]/35")
                    }
                    style={{ width: `${Math.max(2, progress)}%` }}
                    aria-hidden
                  />
                </span>
                <span
                  className="w-[4.5rem] shrink-0 text-right font-mono text-[10px] tabular-nums"
                  title={t.hasKill ? "討伐" : "その日のベスト (ボス残 HP)"}
                >
                  {t.hasKill
                    ? "討伐"
                    : `${showPhase && t.bestPhase !== null ? `P${t.bestPhase} ` : ""}残${formatPercentage(t.bestPercentage)}`}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                  {t.pulls} pull
                </span>
                <span className="w-3 shrink-0">
                  {t.isRecord && (
                    <Flag
                      className="h-3 w-3 text-[var(--neon-cyan)]"
                      aria-label="自己ベスト更新"
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* A-2: 日 → pull 一覧 → FFLogs / XIVAnalysis / 動画時刻。 */}
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          セッション振り返り
        </h3>
        <ul className="flex flex-col gap-2">
          {summary.days.map((day) => (
            <DayRow
              key={day.date}
              day={day}
              videoLinks={videoLinks}
              canEdit={canEdit}
              showPhase={showPhase}
              onEditOffset={(reportCode) => {
                const existing = videoLinks[reportCode];
                setOffsetTarget({
                  reportCode,
                  videoUrl: existing?.videoUrl ?? "",
                  offset: String(existing?.offsetSeconds ?? 0),
                });
              }}
            />
          ))}
        </ul>
      </section>

      {failedSyncs.length > 0 && <FailedList failedSyncs={failedSyncs} />}

      <OffsetDialog
        target={offsetTarget}
        onChange={setOffsetTarget}
        onSaved={() => {
          setOffsetTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={
        "flex flex-col gap-0.5 rounded-md border px-3 py-2 " +
        (highlight
          ? "border-emerald-400/40 bg-emerald-400/5"
          : "border-border/40 bg-secondary/15")
      }
    >
      <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-display text-lg tabular-nums">{value}</span>
      {sub && (
        <span className="truncate text-[10px] text-muted-foreground">{sub}</span>
      )}
    </li>
  );
}

function DayRow({
  day,
  videoLinks,
  canEdit,
  showPhase,
  onEditOffset,
}: {
  day: DaySummary;
  videoLinks: Record<string, ReportVideoLink>;
  canEdit: boolean;
  showPhase: boolean;
  onEditOffset: (reportCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const codes = Array.from(new Set(day.fights.map((f) => f.reportCode)));

  return (
    <li className="rounded-md border border-border/40 bg-secondary/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-secondary/25"
      >
        <ChevronDown
          className={
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform " +
            (open ? "rotate-0" : "-rotate-90")
          }
          aria-hidden
        />
        <span className="font-display text-sm tabular-nums">{day.date}</span>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {day.pulls} pull / 戦闘 {formatFightDuration(day.fightSeconds)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {day.kills > 0 && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
              <Trophy className="h-3 w-3" aria-hidden />
              CLEAR
            </span>
          )}
          {day.kills === 0 && (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {showPhase && day.bestPhase !== null ? `P${day.bestPhase} / ` : ""}
              残{formatPercentage(day.bestPercentage)}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border/30 px-3 py-2">
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                動画オフセット
              </span>
              {codes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => onEditOffset(code)}
                  className={
                    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors " +
                    (videoLinks[code]?.videoUrl
                      ? "border-violet-400/45 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20"
                      : "border-border/50 text-muted-foreground hover:text-foreground")
                  }
                  title="この report の動画とオフセットを設定"
                >
                  <Video className="h-3 w-3" aria-hidden />
                  {code.slice(0, 6)}
                </button>
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {day.fights.map((f, i) => (
              <PullRow
                key={`${f.reportCode}:${f.fightId}`}
                index={i + 1}
                fight={f}
                video={videoLinks[f.reportCode] ?? null}
                showPhase={showPhase}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function PullRow({
  index,
  fight,
  video,
  showPhase,
}: {
  index: number;
  fight: FightRow;
  video: ReportVideoLink | null;
  showPhase: boolean;
}) {
  const durationSec = Math.max(0, Math.round((fight.endMs - fight.startMs) / 1000));
  // 日付のグルーピングが JST 基準なので時刻も JST に固定する
  // (閲覧者のタイムゾーンに依存すると日付と時刻がずれて見える)。
  const clock = new Date(fight.startMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });

  // A-2 の肝: report 開始からの相対位置 + オフセットで動画内時刻を計算する。
  const videoHref =
    video?.videoUrl && fight.reportStartMs !== null
      ? buildVideoTimestampUrl(
          video.videoUrl,
          video.offsetSeconds + (fight.startMs - fight.reportStartMs) / 1000,
        )
      : null;
  const videoSeconds =
    video && fight.reportStartMs !== null
      ? video.offsetSeconds + (fight.startMs - fight.reportStartMs) / 1000
      : null;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/30 bg-background/30 px-2 py-1">
      <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        #{index}
      </span>
      <span className="w-11 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        {clock}
      </span>
      <span className="w-10 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatFightDuration(durationSec)}
      </span>
      <span
        className={
          "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] tabular-nums " +
          (fight.kill
            ? "bg-emerald-400/15 text-emerald-200"
            : "bg-secondary/50 text-foreground/80")
        }
      >
        {fight.kill
          ? "CLEAR"
          : `${showPhase && fight.lastPhase !== null ? `P${fight.lastPhase} ` : ""}残${formatPercentage(fight.fightPercentage)}`}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <a
          href={buildFflogsReportUrl(fight.reportCode, fight.fightId)}
          target="_blank"
          rel="noopener noreferrer"
          title="FFLogs でこの pull を開く"
          className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-amber-200 uppercase transition-colors hover:bg-amber-400/15"
        >
          <BarChart3 className="h-2.5 w-2.5" aria-hidden />
          Logs
        </a>
        {/* XIVAnalysis: この pull のスキル回し / CD 落ちを自動で指摘してくれる。
            開くのは自分たちの pull を自分たちで見るための導線 (§1-F)。 */}
        <a
          href={buildXivAnalysisUrl(fight.reportCode, fight.fightId)}
          target="_blank"
          rel="noopener noreferrer"
          title="XIVAnalysis でこの pull を解析する"
          className="inline-flex items-center gap-1 rounded-sm border border-sky-400/45 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-sky-200 uppercase transition-colors hover:bg-sky-400/15"
        >
          <Microscope className="h-2.5 w-2.5" aria-hidden />
          Analysis
        </a>
        {videoHref && (
          <a
            href={videoHref}
            target="_blank"
            rel="noopener noreferrer"
            title="動画のこの瞬間から再生"
            className="inline-flex items-center gap-1 rounded-sm border border-violet-400/45 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-violet-200 uppercase transition-colors hover:bg-violet-400/15"
          >
            <Film className="h-2.5 w-2.5" aria-hidden />
            {videoSeconds !== null ? formatClock(videoSeconds) : "動画"}
          </a>
        )}
      </span>
    </li>
  );
}

function FailedList({
  failedSyncs,
}: {
  failedSyncs: Array<{
    reportCode: string;
    reason: string | null;
    unassigned: boolean;
  }>;
}) {
  return (
    <section className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
      <h3 className="font-mono text-[10px] tracking-[0.16em] text-amber-200 uppercase">
        取り込めていないレポート
      </h3>
      <ul className="mt-1 flex flex-col gap-1">
        {failedSyncs.map((f) => (
          <li key={f.reportCode} className="text-[11px] leading-relaxed text-muted-foreground">
            <a
              href={`https://www.fflogs.com/reports/${encodeURIComponent(f.reportCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-amber-200/90 underline underline-offset-2 hover:text-amber-100"
            >
              {f.reportCode}
            </a>
            {f.unassigned && (
              <span className="ml-1.5 rounded-sm border border-border/50 px-1 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase">
                コンテンツ未割当
              </span>
            )}
            {f.reason ? (
              <span className="block pl-2">
                {humanizeFflogsSyncReason(f.reason)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OffsetDialog({
  target,
  onChange,
  onSaved,
}: {
  target: { reportCode: string; videoUrl: string; offset: string } | null;
  onChange: (
    v: { reportCode: string; videoUrl: string; offset: string } | null,
  ) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!target) return;
    const offset = Number(target.offset);
    if (!Number.isFinite(offset)) {
      toast.error("オフセットは秒数で入力してください");
      return;
    }
    setBusy(true);
    const result = await setReportVideoAction({
      reportCode: target.reportCode,
      videoUrl: target.videoUrl.trim() || null,
      offsetSeconds: Math.trunc(offset),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error("保存失敗: " + result.reason);
      return;
    }
    toast.success("保存しました");
    onSaved();
  };

  const autofill = async () => {
    if (!target) return;
    const result = await suggestVideoForReportAction(target.reportCode);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    if (!result.videoUrl) {
      toast.error("この report に紐づいた動画が見つかりませんでした");
      return;
    }
    onChange({ ...target, videoUrl: result.videoUrl });
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onChange(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>動画オフセットの設定</DialogTitle>
          <DialogDescription>
            「レポート開始時刻が動画の何秒地点か」を 1 回だけ入れておくと、
            以降その日の全 pull の動画内時刻が自動計算されます (
            <span className="font-mono">
              オフセット + (pull 開始 − レポート開始)
            </span>
            )。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offset-video">動画 URL</Label>
            <div className="flex gap-1.5">
              <Input
                id="offset-video"
                value={target?.videoUrl ?? ""}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(e) =>
                  onChange(target ? { ...target, videoUrl: e.target.value } : null)
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={autofill}
                className="shrink-0 text-[11px]"
              >
                自動入力
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offset-seconds">オフセット（秒）</Label>
            <Input
              id="offset-seconds"
              inputMode="numeric"
              value={target?.offset ?? "0"}
              placeholder="例: 92（動画の 1:32 でレポートが始まる）"
              onChange={(e) =>
                onChange(target ? { ...target, offset: e.target.value } : null)
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(null)}
            disabled={busy}
          >
            キャンセル
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
