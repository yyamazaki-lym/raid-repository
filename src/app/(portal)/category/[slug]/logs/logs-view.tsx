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
  videoLinks,
  failedSyncs,
  canEdit,
}: {
  categoryName: string;
  fights: FightRow[];
  videoLinks: Record<string, ReportVideoLink>;
  failedSyncs: Array<{ reportCode: string; reason: string | null }>;
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
  const timeline = useMemo(
    () => progressTimeline(summary.days),
    [summary.days],
  );
  const maxPulls = Math.max(1, ...timeline.map((t) => t.pulls));

  const runSync = () => {
    startSync(async () => {
      const result = await syncFflogsFightsAction();
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(
        `同期完了 — ${result.reportsFetched} レポート / ${result.fightsUpserted} pull` +
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
        <EmptyState
          icon={Activity}
          title="練習ログがまだありません"
          description={
            "FFLogs のレポートを取り込むと、pull 数・到達フェーズ・残 HP% がここに並びます。" +
            "レポートは「動画に FFLogs URL を紐づける」か「コンテンツ編集の FFLogs zone ID」経由でこのコンテンツに割り当てられます。"
          }
        />
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
        <StatCard label="総 pull" value={String(summary.totalPulls)} />
        <StatCard
          label="練習日数"
          value={`${summary.days.length} 日`}
        />
        <StatCard
          label="最深到達"
          value={
            summary.bestPhase !== null
              ? `P${summary.bestPhase}`
              : formatPercentage(summary.bestPercentage)
          }
          sub={
            summary.bestPhase !== null
              ? formatPercentage(summary.bestPercentage)
              : undefined
          }
        />
        <StatCard
          label="クリア"
          value={summary.totalKills > 0 ? `${summary.totalKills} 回` : "—"}
          sub={
            summary.firstKill
              ? `初クリア ${new Date(summary.firstKill.startMs).toLocaleDateString("ja-JP")}`
              : undefined
          }
          highlight={summary.totalKills > 0}
        />
      </ul>

      {/* A-1: 日ごとの pull 数と到達の推移。ライブラリを足さず CSS 幅だけで描く。 */}
      <section className="flex flex-col gap-1.5">
        <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          日ごとの推移
        </h3>
        <ul className="flex flex-col gap-1">
          {[...timeline].reverse().map((t) => (
            <li key={t.date} className="flex items-center gap-2">
              <span className="w-[4.5rem] shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {t.date.slice(5)}
              </span>
              <span className="flex h-4 min-w-0 flex-1 items-center">
                <span
                  className={
                    "h-2 rounded-sm " +
                    (t.hasKill
                      ? "bg-emerald-400/70"
                      : t.isRecord
                        ? "bg-[var(--neon-cyan)]/70"
                        : "bg-secondary")
                  }
                  style={{ width: `${Math.max(4, (t.pulls / maxPulls) * 100)}%` }}
                  aria-hidden
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                {t.pulls}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums">
                {t.bestPhase !== null ? `P${t.bestPhase}` : ""}{" "}
                {formatPercentage(t.bestPercentage)}
              </span>
              {t.isRecord && (
                <Flag
                  className="h-3 w-3 shrink-0 text-[var(--neon-cyan)]"
                  aria-label="記録更新"
                />
              )}
            </li>
          ))}
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
  onEditOffset,
}: {
  day: DaySummary;
  videoLinks: Record<string, ReportVideoLink>;
  canEdit: boolean;
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
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary/25"
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
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {day.bestPhase !== null ? `P${day.bestPhase} / ` : ""}
            {formatPercentage(day.bestPercentage)}
          </span>
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
}: {
  index: number;
  fight: FightRow;
  video: ReportVideoLink | null;
}) {
  const durationSec = Math.max(0, Math.round((fight.endMs - fight.startMs) / 1000));
  const clock = new Date(fight.startMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
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
          : `${fight.lastPhase !== null ? `P${fight.lastPhase} ` : ""}${formatPercentage(fight.fightPercentage)}`}
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
  failedSyncs: Array<{ reportCode: string; reason: string | null }>;
}) {
  return (
    <section className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
      <h3 className="font-mono text-[10px] tracking-[0.16em] text-amber-200 uppercase">
        取り込めていないレポート
      </h3>
      <ul className="mt-1 flex flex-col gap-0.5">
        {failedSyncs.map((f) => (
          <li key={f.reportCode} className="text-[11px] text-muted-foreground">
            <span className="font-mono">{f.reportCode}</span>
            {f.reason ? ` — ${f.reason}` : ""}
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
