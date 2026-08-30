"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  BookMarked,
  ChevronDown,
  ClipboardPaste,
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
  buildFloorMap,
  filterToFloorCluster,
  floorLabel,
  floorToneClass,
  formatFightDuration,
  formatPercentage,
  isClearFight,
  percentageToneClass,
  progressTimeline,
  summarize,
  type DaySummary,
  type FightRow,
  type FloorMap,
} from "@/lib/fflogs-progress";
import {
  buildFflogsReportUrl,
  buildVideoTimestampUrl,
  buildXivAnalysisUrl,
  formatClock,
} from "@/lib/fflogs-url";
import { isSavageContent, isUltimateContent } from "@/lib/content-groups";
import { humanizeFflogsSyncReason } from "@/lib/fflogs-sync-reason";
import type { ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import {
  importFflogsReportsAction,
  setReportVideoAction,
  suggestVideoForReportAction,
  syncFflogsFightsAction,
} from "@/lib/server/fflogs-fights-actions";
import {
  extractFflogsReportCodes,
  FFLOGS_REPORT_LINKS_BOOKMARKLET,
} from "@/lib/fflogs-url";
import { Textarea } from "@/components/ui/textarea";

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
  totalClears,
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
  totalClears: number;
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
  // 直近の手動同期で取得に失敗した report とその理由。失敗行はカテゴリ別の
  // ページにしか表示されず「どこで見ればいいか分からない」ため (2026-08-28
  // 実機報告)、同期を実行したその場にも表示する。
  const [lastSyncFailures, setLastSyncFailures] = useState<
    Array<{ reportCode: string; reason: string }>
  >([]);
  // URL 貼り付けインポート (unlisted の「発見」を人間側で補う導線)。
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const importCodes = useMemo(
    () => extractFflogsReportCodes(importText),
    [importText],
  );

  const runImport = async () => {
    setImporting(true);
    const result = await importFflogsReportsAction(importText);
    setImporting(false);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    setLastSyncFailures(result.failures ?? []);
    toast.success(
      `取り込み完了 — ${result.codesFound} レポート / ${result.fightsUpserted} pull` +
        (result.videosBridged > 0 ? ` / 動画に紐づけ ${result.videosBridged}` : "") +
        (result.failed > 0 ? ` (失敗 ${result.failed} — 理由は下に表示)` : ""),
    );
    setImportOpen(false);
    setImportText("");
    router.refresh();
  };
  const [offsetTarget, setOffsetTarget] = useState<{
    reportCode: string;
    videoUrl: string;
    offset: string;
  } | null>(null);

  // フェーズ (P1〜) 単位で管理するのは実質「絶」だけ (2026-08-28 指摘)。
  const showPhase = useMemo(
    () => isUltimateContent(categoryName),
    [categoryName],
  );
  // 絶はフェーズ (P1〜) で管理するので層マップを作らない (別コンテンツの
  // 混入で誤った「◯層」表示が付くのを防ぐ)。零式ティアのみ層モデル。
  // 零式は必ず 4 層構成: 最終層が前半/後半に分かれるティア (encounter が
  // 5 個) を「5層」と誤表示せず「4層前半/後半」に畳む (2026-08-28 指摘)。
  const floors = useMemo(
    () =>
      showPhase
        ? null
        : buildFloorMap(fights, isSavageContent(categoryName) ? 4 : null),
    [showPhase, fights, categoryName],
  );
  // クラスタ外 (同じレポートに混ざった別コンテンツの戦闘) は集計から除外。
  const tierFights = useMemo(
    () => filterToFloorCluster(fights, floors),
    [fights, floors],
  );
  const summary = useMemo(
    () => summarize(tierFights, floors),
    [tierFights, floors],
  );
  // DB の総数にはクラスタ外の混入分も含まれるため、取得済み明細で判明した
  // 混入数だけ差し引く (未打ち切りなら tierFights.length と一致する)。
  const shownTotalPulls = Math.max(0, totalPulls - (fights.length - tierFights.length));
  // 動画オフセットの基準: レポートごとの「最初の pull の戦闘開始時刻」。
  // 旧基準は「レポート開始時刻」だったが、ユーザーが動画で見つけて合わせる
  // のは pull #1 の開始なので、レポート開始〜初 pull の準備時間分 (実機で
  // +40 秒) が必ずずれた (2026-08-28 報告)。基準を操作と一致させる。
  const firstPullStartByReport = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of tierFights) {
      const cur = m.get(f.reportCode);
      if (cur === undefined || f.startMs < cur) m.set(f.reportCode, f.startMs);
    }
    return m;
  }, [tierFights]);
  // 631 pull / 54 日のような蓄積で縦に伸びすぎる (2026-08-28 実機報告)。
  // 到達度・振り返りとも既定は直近 10 日、トグルで全件。
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);

  const timeline = useMemo(
    () => progressTimeline(summary.days, floors),
    [summary.days, floors],
  );

  const runSync = () => {
    startSync(async () => {
      const result = await syncFflogsFightsAction();
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      setLastSyncFailures(result.failures ?? []);
      toast.success(
        `同期完了 — ${result.reportsFetched} レポート / ${result.fightsUpserted} pull` +
          (result.reattributed > 0 ? ` / 再分類 ${result.reattributed}` : "") +
          (result.videosBridged > 0 ? ` / 動画に紐づけ ${result.videosBridged}` : "") +
          (result.failed > 0 ? ` (失敗 ${result.failed} — 理由は下に表示)` : "") +
          (result.truncated ? " ※途中まで" : ""),
      );
      router.refresh();
    });
  };

  const importButton = canEdit ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setImportOpen(true)}
      className="gap-1.5 text-[11px] tracking-normal"
    >
      <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
      URL から取り込む
    </Button>
  ) : null;

  const importDialog = (
    <Dialog
      open={importOpen}
      onOpenChange={(open) => {
        if (!open) setImportOpen(false);
      }}
    >
      {/* ブックマークレット手順で縦に長いので、画面高を超えたら
          ダイアログ内でスクロールさせる (2026-08-28 実機報告「縦も見切れ」)。 */}
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>レポート URL から取り込む</DialogTitle>
          <DialogDescription>
            unlisted (限定公開) レポートは一覧からの自動発見ができないため、
            URL を貼り付けて取り込みます (1 回につき最大 25 件)。
            <a
              href="https://www.fflogs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              FFLogs
            </a>
            の一覧ページはリンク文字にしか名前が出ず、通常のコピーでは URL が
            取れないため、下の<strong>抽出ブックマークレット</strong>を使うのが
            最短です。
          </DialogDescription>
        </DialogHeader>
        {/* ブックマークレット: FFLogs の一覧ページ上で実行すると、表示中の
            全レポート URL がクリップボードに入る。fflogs.com 側 (本人の
            ブラウザセッション) で動くので unlisted / private の一覧も拾える。 */}
        <div className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            一覧から URL を一括コピーする (初回のみ設定)
          </p>
          <ol className="ml-4 flex list-decimal flex-col gap-0.5 text-[11px] leading-relaxed text-muted-foreground">
            <li>下のボタンで抽出コードをコピー</li>
            <li>
              ブラウザで新しいブックマークを作り、URL 欄に貼り付けて保存
              (名前は「FFLogs URL 抽出」など)
            </li>
            <li>FFLogs のレポート一覧ページを開いた状態でそのブックマークをクリック</li>
            <li>「N 件のレポート URL をコピーしました」と出たら、下の欄に貼り付け</li>
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-fit gap-1.5 text-[11px] tracking-normal"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  FFLOGS_REPORT_LINKS_BOOKMARKLET,
                );
                toast.success("抽出ブックマークレットをコピーしました");
              } catch {
                toast.error("コピー失敗（ブラウザの権限を確認してください）");
              }
            }}
          >
            <BookMarked className="h-3.5 w-3.5" aria-hidden />
            抽出ブックマークレットをコピー
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="import-text">貼り付け</Label>
          {/* Textarea 基底の field-sizing-content は内容に合わせて幅まで
              広がり、長い URL でダイアログを突き破る (2026-08-28 実機報告
              「見切れている」)。fixed に戻して幅を親に固定する。 */}
          <Textarea
            id="import-text"
            value={importText}
            rows={6}
            placeholder="https://www.fflogs.com/reports/... (改行区切りで複数可)"
            className="max-w-full font-mono text-[11px] break-all [field-sizing:fixed]"
            onChange={(e) => setImportText(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {importCodes.length > 0
              ? `${importCodes.length} 件のレポートを検出しました`
              : "レポート URL が未検出です"}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setImportOpen(false)}
            disabled={importing}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={runImport}
            disabled={importing || importCodes.length === 0}
          >
            {importing ? "取り込み中..." : `${Math.min(importCodes.length, 25)} 件を取り込む`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

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

  const lastSyncFailuresBlock =
    lastSyncFailures.length > 0 ? (
      <section className="rounded-md border border-rose-400/35 bg-rose-400/5 px-3 py-2">
        <h3 className="font-mono text-[10px] tracking-[0.16em] text-rose-200 uppercase">
          今回の同期で取得できなかったレポート ({lastSyncFailures.length} 件)
        </h3>
        <ul className="mt-1 flex flex-col gap-1">
          {lastSyncFailures.map((f) => (
            <li
              key={f.reportCode}
              className="text-[11px] leading-relaxed text-muted-foreground"
            >
              <a
                href={`https://www.fflogs.com/reports/${encodeURIComponent(f.reportCode)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-rose-200/90 underline underline-offset-2 hover:text-rose-100"
              >
                {f.reportCode}
              </a>
              <span className="block pl-2">
                {humanizeFflogsSyncReason(f.reason)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (fights.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex justify-end gap-2">
          {importButton}
          {syncButton}
        </div>
        {importDialog}
        {lastSyncFailuresBlock}
        <div className="flex flex-col gap-2">
          <EmptyState
            icon={Activity}
            title="練習ログがまだありません"
            description={
              "FFLogs のレポートを取り込むと、pull 数・到達度・残 HP% がここに並びます。" +
              "レポートは「動画に FFLogs URL を紐づける」「コンテンツ編集の FFLogs zone ID / マッチワード」" +
              "またはレポートの zone 名からこのコンテンツに割り当てられます。" +
              "unlisted (限定公開) レポートは URL を portal に登録してあれば取得できます (要 FFLOGS_API_KEY)。" +
              "private (非公開) は本人の OAuth 連携か、公開設定の変更が必要です。"
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
        <span className="flex items-center gap-2">
          {importButton}
          {syncButton}
        </span>
        {/* スクロールで SubTabs が stuck 化したとき右端に複製されるボタン。
            2026-08-28 実機報告「ログを同期しか追従しない」— 取り込みボタンも
            同じ頻度で使うので両方を portal する。 */}
        {canEdit && (
          <MirrorActionSlot>
            <span className="flex items-center gap-1">
              {importButton}
              {syncButton}
            </span>
          </MirrorActionSlot>
        )}
      </header>

      {importDialog}

      {lastSyncFailuresBlock}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="総 pull"
          value={String(shownTotalPulls)}
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
            totalClears > 0
              ? "討伐"
              : showPhase && summary.bestPhase !== null
                ? `P${summary.bestPhase}`
                : floors && summary.days.length > 0
                  ? (() => {
                      const maxIdx = Math.max(
                        ...summary.days.map((d) => d.bestFloor ?? 0),
                      );
                      return maxIdx > 0 ? floorLabel(floors, maxIdx) : "—";
                    })()
                  : summary.bestPercentage !== null
                    ? `残 ${formatPercentage(summary.bestPercentage)}`
                    : "—"
          }
          sub={
            totalClears > 0
              ? undefined
              : showPhase && summary.bestPhase !== null
                ? `残 ${formatPercentage(summary.bestPercentage)}`
                : floors
                  ? `残 ${formatPercentage(summary.bestPercentage)}`
                  : undefined
          }
        />
        <StatCard
          label={floors ? `${floors.finalFloorLabel}クリア` : "クリア"}
          value={totalClears > 0 ? `${totalClears} 回` : "—"}
          sub={
            // 明細が打ち切られている場合の「初クリア」は表示範囲内の最古の
            // クリアでしかないので出さない (誤情報を作らない)。
            summary.fastestClearSeconds !== null
              ? `最速 ${formatFightDuration(summary.fastestClearSeconds)}`
              : !truncated && summary.firstKill
                ? `初クリア ${new Date(summary.firstKill.startMs).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`
                : undefined
          }
          highlight={totalClears > 0}
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
          {[...timeline]
            .reverse()
            .slice(0, showAllTimeline ? undefined : 10)
            .map((t) => (
              <li key={t.date} className="flex items-center gap-2">
                {/* 2026-08-30: 10px の灰色一辺倒で読みにくい (実機報告) —
                    データ行は 11px に上げ、日付は foreground 寄りに。 */}
                <span className="w-[4.5rem] shrink-0 font-mono text-[11px] text-foreground/75 tabular-nums">
                  {t.date.slice(5)}
                </span>
                <span className="relative flex h-4 min-w-0 flex-1 items-center rounded-sm bg-secondary/40">
                  {/* 複数層のカテゴリでは層の区切り線を引く (バーの上にも
                      乗るよう明色。border/60 では薄すぎた — 2026-08-28 指摘)。 */}
                  {floors &&
                    Array.from({ length: floors.floorCount - 1 }, (_, i) => (
                      <span
                        key={i}
                        className="absolute top-0 h-full w-px bg-foreground/50"
                        style={{
                          left: `${((i + 1) / floors.floorCount) * 100}%`,
                        }}
                        aria-hidden
                      />
                    ))}
                  <span
                    className={
                      "h-full rounded-sm " +
                      (t.hasClear
                        ? "bg-emerald-400/75"
                        : t.isRecord
                          ? "bg-[var(--neon-cyan)]/70"
                          : "bg-[var(--neon-cyan)]/35")
                    }
                    style={{ width: `${Math.max(2, t.progress)}%` }}
                    aria-hidden
                  />
                </span>
                <span
                  className="w-[6.5rem] shrink-0 text-right font-mono text-[11px] tabular-nums"
                  title={
                    t.hasClear
                      ? floors
                        ? `${floors.finalFloorLabel}クリア`
                        : "討伐"
                      : "その日のベスト到達"
                  }
                >
                  {/* 残% は値に応じた熱量色 (討伐 = emerald)。層ラベルは
                      層の識別色 (floorToneClass のテキスト色相当)。 */}
                  {t.hasClear ? (
                    <span className="font-medium text-emerald-300">討伐</span>
                  ) : (
                    <>
                      {floors && t.bestFloor !== null && (
                        <span className="text-foreground/70">
                          {floorLabel(floors, t.bestFloor)}{" "}
                        </span>
                      )}
                      {!floors && showPhase && t.bestPhase !== null && (
                        <span className="text-foreground/70">P{t.bestPhase} </span>
                      )}
                      <span className={percentageToneClass(t.bestPercentage)}>
                        残{formatPercentage(t.bestPercentage)}
                      </span>
                    </>
                  )}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
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
            ))}
        </ul>
        {timeline.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllTimeline((v) => !v)}
            className="self-start rounded px-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showAllTimeline
              ? "直近 10 日だけ表示"
              : `残り ${timeline.length - 10} 日を表示`}
          </button>
        )}
      </section>

      {/* A-2: 日 → pull 一覧 → FFLogs / XIVAnalysis / 動画時刻。 */}
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          セッション振り返り
        </h3>
        <ul className="flex flex-col gap-2">
          {summary.days.slice(0, showAllDays ? undefined : 10).map((day) => (
            <DayRow
              key={day.date}
              day={day}
              videoLinks={videoLinks}
              canEdit={canEdit}
              showPhase={showPhase}
              floors={floors}
              firstPullStartByReport={firstPullStartByReport}
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
        {summary.days.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllDays((v) => !v)}
            className="self-start rounded px-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showAllDays
              ? "直近 10 日だけ表示"
              : `残り ${summary.days.length - 10} 日を表示`}
          </button>
        )}
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
      {/* 2026-08-30: PC では一回り大きく (実機報告「PC から見ると小さい」)。 */}
      <span className="font-display text-lg tabular-nums sm:text-xl">{value}</span>
      {sub && (
        <span className="truncate text-[10px] text-muted-foreground sm:text-[11px]">
          {sub}
        </span>
      )}
    </li>
  );
}

function DayRow({
  day,
  videoLinks,
  canEdit,
  showPhase,
  floors,
  firstPullStartByReport,
  onEditOffset,
}: {
  day: DaySummary;
  videoLinks: Record<string, ReportVideoLink>;
  canEdit: boolean;
  showPhase: boolean;
  floors: FloorMap;
  firstPullStartByReport: Map<string, number>;
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
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {day.pulls} pull / 戦闘 {formatFightDuration(day.fightSeconds)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* 何層に挑んだ日かを常時表示 (2026-08-28 実機フィードバック)。
              複数層に挑んだ日は範囲表記 (例: 1-4層)。 */}
          {floors &&
            day.bestFloor !== null &&
            (() => {
              const dayFloors = day.fights
                .map((f) =>
                  f.encounterId !== null
                    ? (floors.byEncounter.get(f.encounterId) ?? null)
                    : null,
                )
                .filter((v): v is number => v !== null);
              const minF = Math.min(...dayFloors);
              const maxF = Math.max(...dayFloors);
              // 範囲は表示層番号 (前半/後半とも 4) で出す。単一 index の
              // 日だけ「4層前半」のようなフルラベルで区別する。
              const minD = floors.displayFloorByIndex.get(minF) ?? minF;
              const maxD = floors.displayFloorByIndex.get(maxF) ?? maxF;
              // 2026-08-30: 単一層はその層の識別色、複数層 (複合) は cyan
              // (floorToneClass(null))。どの層の日かが色で拾えるように。
              const singleFloor = minD === maxD ? maxD : null;
              return (
                <span
                  className={
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
                    floorToneClass(singleFloor)
                  }
                >
                  {minF === maxF
                    ? floorLabel(floors, maxF)
                    : minD === maxD
                      ? `${maxD}層`
                      : `${minD}-${maxD}層`}
                </span>
              );
            })()}
          {day.clears > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">
              <Trophy className="h-3 w-3" aria-hidden />
              CLEAR
            </span>
          ) : (
            <span className="font-mono text-[11px] tabular-nums">
              {showPhase && day.bestPhase !== null && (
                <span className="text-muted-foreground">P{day.bestPhase} / </span>
              )}
              <span className={percentageToneClass(day.bestPercentage)}>
                残{formatPercentage(day.bestPercentage)}
              </span>
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
                floors={floors}
                firstPullStartMs={firstPullStartByReport.get(f.reportCode) ?? null}
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
  floors,
  firstPullStartMs,
}: {
  index: number;
  fight: FightRow;
  video: ReportVideoLink | null;
  showPhase: boolean;
  floors: FloorMap;
  firstPullStartMs: number | null;
}) {
  const durationSec = Math.max(0, Math.round((fight.endMs - fight.startMs) / 1000));
  // 日付のグルーピングが JST 基準なので時刻も JST に固定する
  // (閲覧者のタイムゾーンに依存すると日付と時刻がずれて見える)。
  const clock = new Date(fight.startMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });

  // A-2 の肝: 「最初の pull の戦闘開始」からの相対位置 + オフセットで
  // 動画内時刻を計算する (オフセット = 動画上で pull #1 が始まる秒数)。
  const videoSeconds =
    video && firstPullStartMs !== null
      ? video.offsetSeconds + (fight.startMs - firstPullStartMs) / 1000
      : null;
  const videoHref =
    video?.videoUrl && videoSeconds !== null
      ? buildVideoTimestampUrl(video.videoUrl, videoSeconds)
      : null;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/30 bg-background/30 px-2 py-1">
      {/* 2026-08-30: 10px 灰色一色の行を再配色 (実機報告「灰色だらけで
          見にくい」)。番号/時刻/時間は 11px に上げ、層は識別色チップ、
          結果 (CLEAR / 残%) は熱量色の別チップに分離した。 */}
      <span className="w-8 shrink-0 font-mono text-[11px] text-foreground/70 tabular-nums">
        #{index}
      </span>
      <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {clock}
      </span>
      <span className="w-11 shrink-0 font-mono text-[11px] text-foreground/75 tabular-nums">
        {formatFightDuration(durationSec)}
      </span>
      {(() => {
        const floor =
          floors && fight.encounterId !== null
            ? (floors.byEncounter.get(fight.encounterId) ?? null)
            : null;
        const displayFloor =
          floors && floor !== null
            ? (floors.displayFloorByIndex.get(floor) ?? floor)
            : null;
        const isClear = isClearFight(fight, floors);
        const floorChip =
          floor !== null ? (
            <span
              className={
                "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
                floorToneClass(displayFloor)
              }
            >
              {floorLabel(floors, floor)}
            </span>
          ) : null;
        // kill は層を問わず CLEAR 表記 (最終層 = 濃い緑 / 他層 = 淡い緑)。
        const resultChip = fight.kill ? (
          <span
            className={
              "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
              (isClear
                ? "bg-emerald-400/20 font-medium text-emerald-200"
                : "bg-emerald-400/10 text-emerald-200/80")
            }
          >
            CLEAR
          </span>
        ) : (
          <span className="shrink-0 rounded-sm bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
            {showPhase && fight.lastPhase !== null && (
              <span className="text-foreground/70">P{fight.lastPhase} </span>
            )}
            <span className={percentageToneClass(fight.fightPercentage)}>
              残{formatPercentage(fight.fightPercentage)}
            </span>
          </span>
        );
        return (
          <>
            {floorChip}
            {resultChip}
          </>
        );
      })()}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <a
          href={buildFflogsReportUrl(fight.reportCode, fight.fightId)}
          target="_blank"
          rel="noopener noreferrer"
          title="FFLogs でこの pull を開く"
          className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-amber-200 uppercase transition-colors hover:bg-amber-400/15"
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
          className="inline-flex items-center gap-1 rounded-sm border border-sky-400/45 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-sky-200 uppercase transition-colors hover:bg-sky-400/15"
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
            className="inline-flex items-center gap-1 rounded-sm border border-violet-400/45 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-violet-200 uppercase transition-colors hover:bg-violet-400/15"
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
            動画上で<strong>最初の pull (一覧の #1) の戦闘が始まる時刻 (秒)
            </strong>を 1 回だけ入れておくと、以降その日の全 pull の動画内
            時刻が自動計算されます。例: 動画の 0:56 で #1 が始まるなら
            「56」。
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
              placeholder="例: 56（動画の 0:56 で #1 の戦闘が始まる）"
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
