"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BookMarked,
  ClipboardPaste,
  Flag,
  RefreshCw,
  SlidersHorizontal,
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
  floorHalf,
  floorLabel,
  floorTextToneClass,
  floorToneClass,
  formatFightDuration,
  formatPercentage,
  observedPhaseCount,
  percentageToneClass,
  phaseTextToneClass,
  progressTimeline,
  pullBreakdown,
  summarize,
  type FightRow,
} from "@/lib/fflogs-progress";
import { PERF_BAR, PERF_BAR_SOFT, perfForProgress } from "@/lib/perf-tone";
import {
  phaseTimeTotals,
  wipeCauseCounts,
  type PhaseTimeTotal,
  type PhaseFirstReach,
} from "@/lib/fflogs-fight-detail";
import {
  difficultyToneClass,
  resolveDifficultyLabel,
  resolveFloorCount,
  resolveProgressModel,
  type ProgressModel,
} from "@/lib/content-model";
import { teamBadges } from "@/lib/fflogs-session";
import { humanizeFflogsSyncReason } from "@/lib/fflogs-sync-reason";
import type { ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import {
  deleteFflogsReportAction,
  importFflogsReportsAction,
  diagnoseFflogsReportsAction,
  recategorizeFflogsReportsAction,
  assignFflogsReportsToCategoryAction,
  type FflogsReportDiag,
  setCategoryMinDifficultyAction,
  syncFflogsFightsAction,
} from "@/lib/server/fflogs-fights-actions";
import { useConfirm } from "@/components/portal/confirm-dialog";
import {
  extractFflogsReportCodes,
  FFLOGS_REPORT_LINKS_BOOKMARKLET,
} from "@/lib/fflogs-url";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { DayRow } from "@/components/portal/logs/day-row";
import { FailedList } from "@/components/portal/logs/failed-list";
import { OffsetDialog } from "@/components/portal/logs/offset-dialog";
import { type VideoSyncAnchor } from "@/lib/video-sync";
import { PhaseTimeCard } from "@/components/portal/logs/phase-time-card";
import { PullBreakdownChips, StatCard } from "@/components/portal/logs/stat-card";
import type { OffsetTarget } from "@/components/portal/logs/video-link";
import { TeamBadgesCard } from "@/components/portal/logs/team-badges-card";
import { TrendCard } from "@/components/portal/logs/trend-card";
import { WipeCausesCard } from "@/components/portal/logs/wipe-causes-card";

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
 * 表示するのは PT としての到達度のみ。個人 DPS は集計も表示もしない
 * (2026-09-03 に加えた PT 合計 DPS / 死亡数も PT 単位の値で、個人の内訳は
 * DB にも無い)。
 *
 * **本モジュールが持つのは状態と組み立てだけ** (2026-09-07 の分割 / #20)。
 * 同期・取り込み・診断・再分類のダイアログ、フィルタ、集計の `useMemo`、
 * 編集中の動画 (`offsetTarget`) を保持し、表示は
 * `@/components/portal/logs/*` の部品に任せる。分割の経緯と依存の向きは
 * `src/components/portal/logs/README.md` を参照。
 */
export function LogsView({
  categoryId,
  categoryName,
  minDifficulty,
  fights,
  totalPulls,
  totalClears,
  truncated,
  progressModel,
  difficultyLabel,
  phaseTotalsAll = null,
  videoLinks,
  failedSyncs,
  canEdit,
}: {
  categoryId: string;
  categoryName: string;
  /** 取り込み難易度の下限 (null = 制限なし)。 */
  minDifficulty: number | null;
  /**
   * カテゴリ全 pull のフェーズ滞在時間 (2026-09-07)。絶のページで server が
   * 全件から集計して渡す。null なら表示中の明細から計算する (従来)。
   */
  phaseTotalsAll?: {
    totals: PhaseTimeTotal[];
    pulls: number;
    firstReach: PhaseFirstReach[];
  } | null;
  /** 明細。件数が多いカテゴリでは直近分だけが渡る (`truncated`)。 */
  fights: FightRow[];
  /** カテゴリ全体の pull 数 / クリア数 (明細が打ち切られていても正確)。 */
  totalPulls: number;
  totalClears: number;
  truncated: boolean;
  /**
   * W-33 ① (2026-09-07): 進行モデルの明示指定。`auto` のときだけ名前から
   * 推測する (8.0 の新難易度は名称未発表なので人が指定できる経路を残す)。
   */
  progressModel: ProgressModel;
  /** W-33 ① (2026-09-07): 表示用の難易度ラベル (空なら名前から推測)。 */
  difficultyLabel: string | null;
  videoLinks: Record<string, ReportVideoLink[]>;
  failedSyncs: Array<{
    reportCode: string;
    reason: string | null;
    unassigned: boolean;
  }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const m = useMessages();
  const locale = useLocale();
  const [syncing, startSync] = useTransition();
  // 2026-08-30 実機報告「ノーマルのものを登録してしまった際に削除できない」。
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  const [difficultyDraft, setDifficultyDraft] = useState(
    minDifficulty === null ? "" : String(minDifficulty),
  );
  const [savingDifficulty, startSaveDifficulty] = useTransition();
  // 直近の手動同期で取得に失敗した report とその理由。失敗行はカテゴリ別の
  // ページにしか表示されず「どこで見ればいいか分からない」ため (2026-08-28
  // 実機報告)、同期を実行したその場にも表示する。
  const [lastSyncFailures, setLastSyncFailures] = useState<
    Array<{ reportCode: string; reason: string }>
  >([]);
  // URL 貼り付けインポート (unlisted の「発見」を人間側で補う導線)。
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  // 2026-09-07: 取り込んだのに出ないときの診断結果 (DB を見るだけ)。
  const [diag, setDiag] = useState<FflogsReportDiag[] | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const runDiagnose = async () => {
    setDiagBusy(true);
    const r = await diagnoseFflogsReportsAction(importText, categoryId);
    setDiagBusy(false);
    if (!r.ok) {
      toast.error(r.reason);
      return;
    }
    setDiag(r.reports);
  };
  const diagAssignable = (diag ?? []).reduce(
    (acc, d) => acc + d.fights.unassigned + d.fights.otherCategory,
    0,
  );
  // 2026-09-07: 混在レポートの後始末 — いまの分類器で pull ごとに決め直す。
  const [recatBusy, setRecatBusy] = useState(false);
  const runRecategorize = async () => {
    setRecatBusy(true);
    const r = await recategorizeFflogsReportsAction(importText);
    setRecatBusy(false);
    if (!r.ok) {
      toast.error(r.reason);
      return;
    }
    toast.success(m.logsImport.recategorized(r.moved, r.unchanged));
    setDiag(null);
    router.refresh();
  };
  const runAssign = async () => {
    setAssignBusy(true);
    const r = await assignFflogsReportsToCategoryAction(importText, categoryId);
    setAssignBusy(false);
    if (!r.ok) {
      toast.error(r.reason);
      return;
    }
    toast.success(m.logsImport.assigned(r.reports, r.fights));
    setDiag(null);
    setImportOpen(false);
    router.refresh();
  };
  const [importing, setImporting] = useState(false);
  const importCodes = useMemo(
    () => extractFflogsReportCodes(importText),
    [importText],
  );

  const runImport = async () => {
    setImporting(true);
    // 2026-09-07: このコンテンツで貼った = このコンテンツのログとして取り込む。
    const result = await importFflogsReportsAction(importText, categoryId);
    setImporting(false);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    setLastSyncFailures(result.failures ?? []);
    toast.success(
      m.logsImport.toastDone(result.codesFound, result.fightsUpserted) +
        (result.videosBridged > 0 ? m.logsSync.videosBridged(result.videosBridged) : "") +
        (result.failed > 0 ? m.logsSync.failedSuffix(result.failed) : ""),
    );
    setImportOpen(false);
    setImportText("");
    router.refresh();
  };
  // 2026-09-07: 1 レポートに複数動画。`id` が null なら「この report に
  // 動画を 1 本追加」、非 null ならその行の編集 (オフセットは行ごと)。
  const [offsetTarget, setOffsetTarget] = useState<OffsetTarget | null>(null);

  // フェーズ (P1〜) 単位で管理するのは実質「絶」だけ (2026-08-28 指摘)。
  // 2026-09-07 (W-33 ①): カテゴリの明示指定 (`progress_model`) が
  // 名前の推測より優先される。8.0 の新難易度は名称が未発表で辞書に
  // 足せないため、admin が「フェーズ管理」を選べる経路を用意した。
  const showPhase = useMemo(
    () => resolveProgressModel(progressModel, categoryName) === "phases",
    [progressModel, categoryName],
  );
  // 絶はフェーズ (P1〜) で管理するので層マップを作らない (別コンテンツの
  // 混入で誤った「◯層」表示が付くのを防ぐ)。零式ティアのみ層モデル。
  // 零式は必ず 4 層構成: 最終層が前半/後半に分かれるティア (encounter が
  // 5 個) を「5層」と誤表示せず「4層前半/後半」に畳む (2026-08-28 指摘)。
  const floors = useMemo(
    () =>
      showPhase
        ? null
        : buildFloorMap(
            fights,
            resolveFloorCount(progressModel, categoryName),
            locale,
          ),
    [showPhase, fights, progressModel, categoryName, locale],
  );
  // クラスタ外 (同じレポートに混ざった別コンテンツの戦闘) は集計から除外。
  const tierFights = useMemo(
    () => filterToFloorCluster(fights, floors),
    [fights, floors],
  );
  // 絶のフェーズ数 (観測値)。層モデルと同じ「区間」として扱う (2026-09-03)。
  const phaseCount = useMemo(
    () => (showPhase ? observedPhaseCount(tierFights) : null),
    [showPhase, tierFights],
  );
  const summary = useMemo(
    () => summarize(tierFights, floors, showPhase),
    [tierFights, floors, showPhase],
  );
  // 2026-09-07 W-31: チーム実績バッジ。層クラスタ外 (別コンテンツの混入) を
  // 除いた pull を対象にする — 混ざった別コンテンツの kill が「初討伐」に
  // なると日付が狂う。明細が打ち切られている場合は「登録ログのうち」の
  // 実績になるので、バッジの title でそう明示している。
  const badges = useMemo(() => teamBadges(tierFights), [tierFights]);
  // バーを区切る区間数 = 層数 (零式) / フェーズ数 (絶)。
  const segmentCount = floors ? floors.floorCount : phaseCount;
  // 死亡数の列を確保するか (1 pull も取得できていないカテゴリでは幅を取らない)。
  const anyDeaths = useMemo(
    () => tierFights.some((f) => f.deaths !== null),
    [tierFights],
  );
  // 総 pull の層 / フェーズ内訳 (2026-09-03 実機要望)。明細が打ち切られて
  // いる場合は表示中の分だけの内訳になる (タイルの sub に明記)。
  const breakdown = useMemo(
    () => pullBreakdown(tierFights, floors, showPhase, locale),
    [tierFights, floors, showPhase, locale],
  );
  // 2026-09-06 W-1: ワイプ原因 (初死亡の技) の集計。個人名は持たない。
  // 明細が打ち切られている場合は表示中の分だけの集計 (sub に明記)。
  const wipeCauses = useMemo(
    () => wipeCauseCounts(tierFights.map((f) => f.wipe), 5, locale),
    [tierFights, locale],
  );
  const wipeCount = useMemo(
    () => tierFights.filter((f) => f.wipe !== null).length,
    [tierFights],
  );
  // 絶: 初死亡が起きたフェーズの回数 (どのフェーズで崩れているか)。
  const wipePhaseCounts = useMemo(() => {
    if (!showPhase) return [] as Array<{ phase: number; count: number }>;
    const m = new Map<number, number>();
    for (const f of tierFights) {
      if (f.wipe?.phase == null) continue;
      m.set(f.wipe.phase, (m.get(f.wipe.phase) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, count]) => ({ phase, count }));
  }, [tierFights, showPhase]);
  // 2026-09-06 W-2: フェーズ滞在時間の合計 (絶のみ。零式は phases が null)。
  // 全件集計が server から来ていればそれを優先する (2026-09-07: 打ち切り
  // カテゴリで「表示中の分」だけになっていた)。
  const phaseTotals = useMemo(
    () =>
      !showPhase
        ? []
        : phaseTotalsAll
          ? phaseTotalsAll.totals
          : phaseTimeTotals(tierFights.map((f) => f.phases)),
    [tierFights, showPhase, phaseTotalsAll],
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
  // W-11 (2026-09-07): オフセットを動画で合わせるときの基準候補。
  // 編集中のレポートの pull だけを時刻順に渡す (他のレポートの pull を
  // 基準にするとオフセットの意味が変わるため、レポートで絞る)。
  const offsetAnchors = useMemo<VideoSyncAnchor[]>(() => {
    const code = offsetTarget?.reportCode;
    if (!code) return [];
    return tierFights
      .filter((f) => f.reportCode === code)
      .sort((a, b) => a.startMs - b.startMs)
      .map((f, i) => ({ fightId: f.fightId, startMs: f.startMs, index: i + 1 }));
  }, [offsetTarget?.reportCode, tierFights]);
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);
  // 2026-08-30 (Tier3-13): 層で pull を絞り込む。層チップに色が付いた
  // ので「4層だけ見たい」を安価に足せる。null = 全層。
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  // 2026-08-30 実機要望「日時クリックで該当日のセッション振り返りに飛びたい」。
  // 対象日と「何回目の要求か」を持ち、DayRow 側は nonce の変化を見て開く
  // (同じ日を続けて押しても再度開ける)。
  const [jump, setJump] = useState<{ date: string; nonce: number } | null>(
    null,
  );


  // 取り込み済みの難易度の内訳 (2026-08-30)。FFLogs の difficulty は
  // コンテンツ種別で値が変わり公開仕様が無いため、**実データを見せて**
  // admin に下限を選んでもらう。混入したノーマルは値が違うので判別できる。
  const difficultyStats = useMemo(() => {
    const m = new Map<number, { count: number; sample: string | null }>();
    for (const f of fights) {
      if (f.difficulty === null) continue;
      const cur = m.get(f.difficulty);
      if (cur) cur.count += 1;
      else m.set(f.difficulty, { count: 1, sample: f.name ?? null });
    }
    return [...m.entries()]
      .map(([difficulty, v]) => ({ difficulty, ...v }))
      .sort((a, b) => a.difficulty - b.difficulty);
  }, [fights]);

  const onDeleteReport = async (code: string) => {
    const ok = await confirm({
      title: m.logsSync.deleteConfirmTitle(code.slice(0, 8)),
      description: m.logsSync.deleteConfirmDescription,
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    setDeletingCode(code);
    // 第 2 引数は DB に保存される除外理由 (表示言語に依らず固定)。
    const r = await deleteFflogsReportAction(code, "誤取り込み");
    setDeletingCode(null);
    if (!r.ok) {
      toast.error(m.logsSync.deleteFailed(r.reason));
      return;
    }
    toast.success(m.logsSync.deleted(r.removedFights));
    router.refresh();
  };

  const timeline = useMemo(
    () => progressTimeline(summary.days, floors, phaseCount),
    [summary.days, floors, phaseCount],
  );

  // フィルタに出す層の一覧 (実データに存在する層のみ、昇順)。
  // 2026-08-30: 4層前半 / 4層後半 は別項目にする (色も分けたので、
  // 「後半だけ見たい」に応えられるようにする)。キーは層 index。
  const floorChoices = useMemo(() => {
    if (!floors) return [];
    const set = new Set<number>();
    for (const f of tierFights) {
      if (f.encounterId === null) continue;
      const idx = floors.byEncounter.get(f.encounterId);
      if (idx !== undefined) set.add(idx);
    }
    return [...set]
      .sort((a, b) => a - b)
      .map((idx) => ({
        index: idx,
        label: floorLabel(floors, idx, locale),
        displayFloor: floors.displayFloorByIndex.get(idx) ?? idx,
        half: floorHalf(floors, idx),
      }));
  }, [floors, tierFights, locale]);

  // 層フィルタ適用後の日リスト。pull が 1 つも残らない日は表示しない
  // (その層に挑んでいない日を空行で並べても意味が無い)。
  const filteredDays = useMemo(() => {
    if (floorFilter === null || !floors) return summary.days;
    return summary.days
      .map((day) => ({
        ...day,
        fights: day.fights.filter((f) => {
          if (f.encounterId === null) return false;
          return floors.byEncounter.get(f.encounterId) === floorFilter;
        }),
      }))
      .filter((day) => day.fights.length > 0);
  }, [summary.days, floors, floorFilter]);

  const jumpToDay = (date: string) => {
    // 折りたたみ中 / フィルタで隠れている日にも飛べるようにする。
    setShowAllDays(true);
    if (floorFilter !== null) {
      const stillVisible = filteredDays.some((d) => d.date === date);
      if (!stillVisible) setFloorFilter(null);
    }
    setJump((cur) => ({ date, nonce: (cur?.nonce ?? 0) + 1 }));
    // 展開後にレイアウトが決まってからスクロールする。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(`log-day-${date}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  const runSync = () => {
    startSync(async () => {
      const result = await syncFflogsFightsAction();
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      setLastSyncFailures(result.failures ?? []);
      // W-5 (2026-09-07): 自動発見の結果は成功トーストと別に出す。件数 0 の
      // 理由 (guild ID 未設定 / 新着なし / API エラー) を混ぜると本文が
      // 読みにくくなるうえ、設定を直す人と同期を押す人が別なことが多い。
      if (result.discovered > 0) {
        toast.success(m.logsSync.discovered(result.discovered));
      } else if (result.discoveryNote) {
        toast.warning(m.logsSync.discoveryNote(result.discoveryNote));
      }
      toast.success(
        m.logsSync.toastDone(result.reportsFetched, result.fightsUpserted) +
          (result.reattributed > 0 ? m.logsSync.reattributed(result.reattributed) : "") +
          (result.videosBridged > 0 ? m.logsSync.videosBridged(result.videosBridged) : "") +
          (result.failed > 0 ? m.logsSync.failedSuffix(result.failed) : "") +
          // 2026-09-07: 代替経路 (v1 / cookie) で取れたレポートにはフェーズ遷移 /
          // 死亡イベントが入らない。理由が見えるように内訳を出す。
          (result.fetchedViaFallback > 0
            ? m.logsSync.routeSuffix(result.fetchedViaV2, result.fetchedViaFallback)
            : "") +
          // 2026-09-07: 取り直しが溜まって 1 回の枠に入らないときは残件数と
          // 「もう一度押す」を明示する。
          (result.remaining > 0
            ? m.logsSync.remainingSuffix(result.remaining)
            : result.truncated
              ? m.logsSync.truncatedSuffix
              : ""),
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
      {m.logsImport.button}
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
          <DialogTitle>{m.logsImport.title}</DialogTitle>
          <DialogDescription>
            {m.logsImport.descA}
            <a
              href="https://www.fflogs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              {m.logsImport.descLink}
            </a>
            {m.logsImport.descB}
            <strong>{m.logsImport.descStrong}</strong>
            {m.logsImport.descC}
          </DialogDescription>
        </DialogHeader>
        {/* ブックマークレット: FFLogs の一覧ページ上で実行すると、表示中の
            全レポート URL がクリップボードに入る。fflogs.com 側 (本人の
            ブラウザセッション) で動くので unlisted / private の一覧も拾える。 */}
        <div className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            {m.logsImport.bookmarkletTitle}
          </p>
          <ol className="ml-4 flex list-decimal flex-col gap-0.5 text-[11px] leading-relaxed text-muted-foreground">
            <li>{m.logsImport.step1}</li>
            <li>{m.logsImport.step2}</li>
            <li>{m.logsImport.step3}</li>
            <li>{m.logsImport.step4}</li>
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
                toast.success(m.logsImport.toastCopied);
              } catch {
                toast.error(m.logsImport.toastCopyFailed);
              }
            }}
          >
            <BookMarked className="h-3.5 w-3.5" aria-hidden />
            {m.logsImport.copyBookmarklet}
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="import-text">{m.logsImport.pasteLabel}</Label>
          {/* Textarea 基底の field-sizing-content は内容に合わせて幅まで
              広がり、長い URL でダイアログを突き破る (2026-08-28 実機報告
              「見切れている」)。fixed に戻して幅を親に固定する。 */}
          <Textarea
            id="import-text"
            value={importText}
            rows={6}
            placeholder={m.logsImport.pastePlaceholder}
            className="max-w-full font-mono text-[11px] break-all [field-sizing:fixed]"
            onChange={(e) => setImportText(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {importCodes.length > 0
              ? m.logsImport.detected(importCodes.length)
              : m.logsImport.notDetected}
          </p>
        </div>
        {/* 2026-09-07: 診断 — 台帳と pull の保存先を見せる (FFLogs は叩かない)。
            分類器で決められないレポートは「このコンテンツに割り当て」で最終手段。 */}
        <div className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/10 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {m.logsImport.diagHint}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 text-[11px] tracking-normal"
              onClick={runDiagnose}
              disabled={diagBusy || importCodes.length === 0}
            >
              {diagBusy ? m.logsImport.diagnosing : m.logsImport.diagnose}
            </Button>
          </div>
          {diag && (
            <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed">
              {diag.map((d) => (
                <li key={d.code} className="flex flex-col gap-0.5 border-t border-border/30 pt-1.5">
                  <a
                    href={`https://www.fflogs.com/reports/${encodeURIComponent(d.code)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-foreground underline underline-offset-2"
                  >
                    {d.code}
                  </a>
                  <span className="text-muted-foreground">
                    {d.blocked
                      ? m.logsImport.diagBlocked
                      : !d.ledger
                        ? m.logsImport.diagNotInLedger
                        : !d.ledger.ok
                          ? m.logsImport.diagFailed(d.ledger.reason ?? "?")
                          : m.logsImport.diagOk(
                              d.ledger.zoneName ?? m.logsImport.diagNone,
                              d.ledger.title ?? m.logsImport.diagNone,
                              d.ledger.categoryName ?? m.logsImport.diagNone,
                            )}
                  </span>
                  {d.fights.total > 0 && (
                    <span className="text-muted-foreground">
                      {m.logsImport.diagFights(
                        d.fights.total,
                        d.fights.inCategory,
                        d.fights.otherCategory,
                        d.fights.unassigned,
                      )}
                    </span>
                  )}
                  {d.ledger?.zoneCategoryName && (
                    <span className="text-muted-foreground">
                      {m.logsImport.diagZoneCategory(d.ledger.zoneCategoryName)}
                    </span>
                  )}
                  {d.fights.total > 0 && (
                    <span className="text-muted-foreground">
                      {m.logsImport.diagProgress(
                        d.fights.progress.kills,
                        d.fights.progress.noPercentage,
                        d.fights.progress.noPhase,
                      )}
                      {d.fights.progress.rawMin !== null &&
                      d.fights.progress.rawMax !== null
                        ? m.logsImport.diagProgressRaw(
                            d.fights.progress.rawMin,
                            d.fights.progress.rawMax,
                          )
                        : ""}
                    </span>
                  )}
                  {d.fights.progress.sessionDates.length > 0 && (
                    <span className="text-muted-foreground">
                      {m.logsImport.diagDates(
                        d.fights.progress.sessionDates.join(", "),
                      )}
                    </span>
                  )}
                  {d.fights.names.map((n) => (
                    <span key={n.name ?? ""} className="pl-2 font-mono text-[12px] text-muted-foreground/85">
                      {m.logsImport.diagName(
                        n.name ?? m.logsImport.diagUnnamed,
                        n.count,
                        n.resolvedCategoryName ?? m.logsImport.diagUnresolved,
                      )}
                      {n.difficulty !== null ? ` · difficulty ${n.difficulty}` : ""}
                      {n.encounterId !== null ? ` · encounter ${n.encounterId}` : ""}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {diag && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[11px] tracking-normal"
                onClick={runRecategorize}
                disabled={recatBusy}
              >
                {recatBusy
                  ? m.logsImport.recategorizeBusy
                  : m.logsImport.recategorize}
              </Button>
              {diagAssignable > 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="text-[11px] tracking-normal"
                  onClick={runAssign}
                  disabled={assignBusy}
                >
                  {assignBusy
                    ? m.logsImport.assignBusy
                    : m.logsImport.assign(diagAssignable)}
                </Button>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setImportOpen(false)}
            disabled={importing}
          >
            {m.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={runImport}
            disabled={importing || importCodes.length === 0}
          >
            {importing
              ? m.logsImport.submitBusy
              : m.logsImport.submit(Math.min(importCodes.length, 25))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const difficultyButton = canEdit ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setDifficultyOpen(true)}
      className="gap-1.5 text-[11px] tracking-normal"
      title={m.logsDifficulty.buttonTitle}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
      {m.logsDifficulty.button}
    </Button>
  ) : null;

  const difficultyDialog = (
    <Dialog
      open={difficultyOpen}
      onOpenChange={(open) => {
        if (!open) setDifficultyOpen(false);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.logsDifficulty.title}</DialogTitle>
          <DialogDescription>
            {m.logsDifficulty.descA}
            <strong>{m.logsDifficulty.descStrong}</strong>
            {m.logsDifficulty.descB}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
            <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              {m.logsDifficulty.observedTitle}
            </p>
            {difficultyStats.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {m.logsDifficulty.observedEmpty}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {difficultyStats.map((d) => (
                  <li
                    key={d.difficulty}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="font-mono tabular-nums text-foreground/90">
                      {d.difficulty}
                    </span>
                    <span className="text-muted-foreground">
                      {m.logs.pulls(d.count)}
                    </span>
                    {d.sample && (
                      <span className="min-w-0 truncate text-muted-foreground/80">
                        {d.sample}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="min-difficulty">{m.logsDifficulty.minLabel}</Label>
            <Input
              id="min-difficulty"
              value={difficultyDraft}
              inputMode="numeric"
              placeholder={m.logsDifficulty.minPlaceholder}
              onChange={(e) => setDifficultyDraft(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {m.logsDifficulty.hint}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDifficultyOpen(false)}
            disabled={savingDifficulty}
          >
            {m.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={savingDifficulty}
            onClick={() => {
              const trimmed = difficultyDraft.trim();
              const value = trimmed === "" ? null : Number.parseInt(trimmed, 10);
              if (value !== null && !Number.isInteger(value)) {
                toast.error(m.logsDifficulty.errNotNumber);
                return;
              }
              startSaveDifficulty(async () => {
                const r = await setCategoryMinDifficultyAction(
                  categoryId,
                  value,
                );
                if (!r.ok) {
                  toast.error(m.logs.saveFailed(r.reason));
                  return;
                }
                toast.success(
                  value === null
                    ? m.logsDifficulty.toastCleared
                    : m.logsDifficulty.toastSet(value),
                );
                setDifficultyOpen(false);
                router.refresh();
              });
            }}
          >
            {savingDifficulty ? m.logs.savingDots : m.common.save}
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
      {syncing ? m.logsSync.buttonBusy : m.logsSync.button}
    </Button>
  ) : null;

  const lastSyncFailuresBlock =
    lastSyncFailures.length > 0 ? (
      <section className="rounded-md border border-rose-400/35 bg-rose-400/5 px-3 py-2">
        <h3 className="font-mono text-[11px] tracking-[0.16em] text-rose-200 uppercase">
          {m.logsSync.failuresTitle(lastSyncFailures.length)}
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
          {/* 2026-09-04 実機要望「分かりにくい文章の修正」。旧文は 1 段落に
              5 文を詰め込み、しかも「割り当てられる条件」という **仕組みの説明**
              から始まっていた。ここで読む人が知りたいのは「どうすれば出るか」
              なので、押すボタンを先に書き、仕組みは括弧に落とす。 */}
          <EmptyState
            icon={Activity}
            title={m.logsEmpty.title}
            description={
              // 2026-09-06 実機指摘「若干左寄りに見える」: 中央寄せの箱の中で
              // 本文だけ text-left にしていたため、行末の余白ぶん左に寄って
              // 見えていた。見出しと同じく中央寄せに揃える。
              <span className="flex flex-col gap-2 text-center">
                <span>{m.logsEmpty.intro}</span>
                <span className="flex flex-col gap-1.5">
                  <span>
                    <strong className="font-medium text-foreground/85">
                      {m.logsEmpty.syncStrong}
                    </strong>
                    {m.logsEmpty.syncText}
                  </span>
                  <span>
                    <strong className="font-medium text-foreground/85">
                      {m.logsEmpty.importStrong}
                    </strong>
                    {m.logsEmpty.importText}
                  </span>
                </span>
                <span className="text-muted-foreground/80">
                  {m.logsEmpty.privateNote}
                </span>
              </span>
            }
          />
          <p className="text-center text-[11px] text-muted-foreground">
            {m.logsEmpty.dataSource}{" "}
            <a
              href="https://www.fflogs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              FFLogs
            </a>
            {m.logsEmpty.analysis}
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
          <h2 className="font-display text-base">{m.logs.title}</h2>
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
            {categoryName}
          </span>
          {/* W-33 ① (2026-09-07): 難易度バッジ。明示設定が無ければ名前から
              推測する (絶 / 零式)。8.0 の新難易度は名前から拾えないので、
              コンテンツ編集で入れたラベルがそのまま出る。 */}
          {(() => {
            const label = resolveDifficultyLabel(
              difficultyLabel,
              categoryName,
              locale,
            );
            if (!label) return null;
            return (
              <span
                className={
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap " +
                  difficultyToneClass(label)
                }
                title={m.logs.difficultyTitle}
              >
                {label}
              </span>
            );
          })()}
        </div>
        <span className="flex items-center gap-2">
          {difficultyButton}
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
      {difficultyDialog}

      {lastSyncFailuresBlock}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label={m.logs.statTotalPulls}
          value={String(shownTotalPulls)}
          sub={truncated ? m.logs.statRecentShown(summary.totalPulls) : undefined}
          detail={
            breakdown.length > 1 ? (
              <PullBreakdownChips items={breakdown} truncated={truncated} />
            ) : undefined
          }
        />
        <StatCard
          label={m.logs.statPracticeDays}
          value={m.logs.daysValue(summary.days.length)}
        />
        <StatCard
          label={m.logs.statBest}
          value={
            // クリア済みなら「残 0%」ではなく「討伐」と言い切る。
            totalClears > 0
              ? m.logs.kill
              : showPhase && summary.bestPhase !== null
                ? `P${summary.bestPhase}`
                : floors && summary.days.length > 0
                  ? (() => {
                      const maxIdx = Math.max(
                        ...summary.days.map((d) => d.bestFloor ?? 0),
                      );
                      return maxIdx > 0 ? floorLabel(floors, maxIdx, locale) : "—";
                    })()
                  : summary.bestPercentage !== null
                    ? m.logs.hpLeft(formatPercentage(summary.bestPercentage))
                    : "—"
          }
          sub={
            totalClears > 0
              ? undefined
              : showPhase && summary.bestPhase !== null
                ? m.logs.hpLeft(formatPercentage(summary.bestPercentage))
                : floors
                  ? m.logs.hpLeft(formatPercentage(summary.bestPercentage))
                  : undefined
          }
        />
        <StatCard
          label={floors ? m.logs.statFloorClear(floors.finalFloorLabel) : m.logs.statClear}
          value={totalClears > 0 ? m.logs.clearCount(totalClears) : "—"}
          sub={
            // 明細が打ち切られている場合の「初クリア」は表示範囲内の最古の
            // クリアでしかないので出さない (誤情報を作らない)。
            summary.fastestClearSeconds !== null
              ? m.logs.fastestClear(formatFightDuration(summary.fastestClearSeconds))
              : !truncated && summary.firstKill
                ? m.logs.firstClear(
                    new Date(summary.firstKill.startMs).toLocaleDateString(
                      locale === "en" ? "en-US" : "ja-JP",
                      { timeZone: "Asia/Tokyo" },
                    ),
                  )
                : undefined
          }
          highlight={totalClears > 0}
        />
      </ul>

      {/* 2026-09-06 W-1 / W-2: ワイプ原因の内訳とフェーズ滞在時間。
          どちらも「PT として何で止まっているか」の指標で、個人の値は無い。
          データが 1 つも無いコンテンツでは丸ごと出さない (旧データのみの
          カテゴリで空セクションを並べない)。 */}
      {/* 2026-09-07 W-4: 進行トレンド。2 セッション未満では傾向が存在しない
          ので TrendCard 側で何も描かない。グラフライブラリは入れず
          インライン SVG で描く (bundle を増やさない)。 */}
      <TrendCard days={timeline} truncated={truncated} />

      {/* 2026-09-07 W-31: チーム実績バッジ。討伐が無いカテゴリでは何も
          出さない (空の枠が「まだ何も無い」ことだけを主張しないように)。
          個人の実績は作らない — 個人 DPS / 出席率のランキングを出さない
          方針と揃える。 */}
      <TeamBadgesCard badges={badges} />

      {(wipeCauses.length > 0 || phaseTotals.length > 1) && (
        <section className="grid gap-2 sm:grid-cols-2">
          {wipeCauses.length > 0 && (
            <WipeCausesCard
              causes={wipeCauses}
              wipeCount={wipeCount}
              phaseCounts={wipePhaseCounts}
              truncated={truncated}
            />
          )}
          {phaseTotals.length > 1 && (
            <PhaseTimeCard
              totals={phaseTotals}
              firstReach={phaseTotalsAll?.firstReach ?? []}
              truncated={truncated}
              allPulls={phaseTotalsAll?.pulls ?? null}
              totalPulls={shownTotalPulls}
            />
          )}
        </section>
      )}

      {/* A-1: 日ごとの到達度の推移。
          バーの長さ = その日のベスト到達度 (100 − 残 HP%)。バーが右端に
          届いたらクリア、伸びていく様子がそのまま「進んでいる実感」になる。
          旧実装はバー = pull 数で「量」しか見えず、肝心の「どこまで行けたか」
          が読み取れなかった (2026-08-28 ユーザー指摘)。 */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {m.logs.timelineTitle}
          </h3>
          <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70">
            {m.logs.timelineLegend}
            {segmentCount !== null &&
              (floors ? m.logs.timelineLegendFloors : m.logs.timelineLegendPhases)}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {[...timeline]
            .reverse()
            .slice(0, showAllTimeline ? undefined : 10)
            .map((t) => (
              <li key={t.date} className="flex items-center gap-2">
                {/* 2026-08-30: 10px の灰色一辺倒で読みにくい (実機報告) —
                    データ行は 11px に上げ、日付は foreground 寄りに。
                    日付クリックでその日のセッション振り返りへ飛ぶ。 */}
                <button
                  type="button"
                  onClick={() => jumpToDay(t.date)}
                  title={m.logs.openDayTitle(t.date)}
                  className="w-[4.5rem] shrink-0 rounded text-left font-mono text-[11px] text-foreground/75 tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--neon-cyan)]"
                >
                  {t.date.slice(5)}
                </button>
                <span className="relative flex h-4 min-w-0 flex-1 items-center rounded-sm bg-secondary/40">
                  {/* 区間の区切り線 — 零式は層、絶はフェーズ (2026-09-03
                      実機要望「絶も P 毎に線を引いて見やすくできるか」)。
                      バーの上にも乗るよう明色 (border/60 では薄すぎた —
                      2026-08-28 指摘)。 */}
                  {segmentCount !== null &&
                    Array.from({ length: segmentCount - 1 }, (_, i) => (
                      <span
                        key={i}
                        className="absolute top-0 h-full w-px bg-foreground/50"
                        style={{ left: `${((i + 1) / segmentCount) * 100}%` }}
                        aria-hidden
                      />
                    ))}
                  {/* 2026-09-06 (UI-12): バーの色は到達度を 5 段階スケール
                      (perf-tone.ts) に乗せる。記録更新の日は濃く、それ以外は
                      薄く (旧実装の cyan 濃淡の役割を引き継ぐ)。討伐 = best。 */}
                  <span
                    className={
                      "h-full rounded-sm " +
                      (t.hasClear
                        ? PERF_BAR.best
                        : t.isRecord
                          ? PERF_BAR[perfForProgress(t.progress)]
                          : PERF_BAR_SOFT[perfForProgress(t.progress)])
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
                        ? m.logs.statFloorClear(floors.finalFloorLabel)
                        : m.logs.kill
                      : m.logs.dayBestTitle
                  }
                >
                  {/* 残% は値に応じた熱量色 (討伐 = emerald)。層ラベルは
                      層の識別色 (floorToneClass のテキスト色相当)。 */}
                  {t.hasClear ? (
                    <span className="font-medium text-emerald-300">{m.logs.kill}</span>
                  ) : (
                    <>
                      {floors && t.bestFloor !== null && (
                        // 2026-08-30 実機要望「右側の 1層 / 2層 なども層ごとに
                        // 色分けしたい」。チップの識別色と同じ色相をテキストに
                        // 当てる (背景まで付けると行が窮屈になるため文字色のみ)。
                        <span
                          className={floorTextToneClass(
                            floors.displayFloorByIndex.get(t.bestFloor) ?? null,
                          )}
                        >
                          {floorLabel(floors, t.bestFloor, locale)}{" "}
                        </span>
                      )}
                      {!floors && showPhase && t.bestPhase !== null && (
                        // 2026-09-03: 層ラベルと同じ扱いで、フェーズも識別色に。
                        <span
                          className={phaseTextToneClass(t.bestPhase)}
                        >
                          P{t.bestPhase}{" "}
                        </span>
                      )}
                      <span className={percentageToneClass(t.bestPercentage)}>
                        {m.logs.hpLeftCompact(formatPercentage(t.bestPercentage))}
                      </span>
                    </>
                  )}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {m.logs.pulls(t.pulls)}
                </span>
                {/* 2026-09-07 実機質問「右端のフラグの意味は」。読み上げ用の
                    aria しか無く hover で何も出なかったので、包む span に
                    title を付ける (lucide のアイコンは title prop を取らない)。 */}
                <span
                  className="w-3 shrink-0"
                  title={
                    t.isRecord
                      ? t.isFirstClear
                        ? m.logs.firstKillFlagTitle
                        : m.logs.recordFlagTitle
                      : undefined
                  }
                >
                  {t.isRecord && (
                    <Flag
                      className={
                        "h-3 w-3 " +
                        (t.isFirstClear
                          ? "text-emerald-300"
                          : "text-[var(--neon-cyan)]")
                      }
                      aria-label={t.isFirstClear ? m.logs.firstKillAria : m.logs.recordAria}
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
            className="self-start rounded px-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showAllTimeline
              ? m.logs.showRecentOnly
              : m.logs.showRemainingDays(timeline.length - 10)}
          </button>
        )}
      </section>

      {/* A-2: 日 → pull 一覧 → FFLogs / XIVAnalysis / 動画時刻。 */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            {m.logs.sessionsTitle}
          </h3>
          {/* 層フィルタ: 表示層 (1..4) 単位。層マップが無いコンテンツ
              (絶など) では出さない。選択中を再クリックで解除。 */}
          {floors && floorChoices.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setFloorFilter(null)}
                aria-pressed={floorFilter === null}
                className={
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tracking-normal transition-colors " +
                  (floorFilter === null
                    ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                    : "border-border/50 text-muted-foreground hover:text-foreground")
                }
              >
                {m.logs.allFloors}
              </button>
              {floorChoices.map((f) => (
                <button
                  key={f.index}
                  type="button"
                  onClick={() =>
                    setFloorFilter((cur) => (cur === f.index ? null : f.index))
                  }
                  aria-pressed={floorFilter === f.index}
                  title={m.logs.floorFilterTitle(f.label)}
                  className={
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors " +
                    (floorFilter === f.index
                      ? floorToneClass(f.displayFloor, f.half)
                      : "border-border/50 text-muted-foreground hover:text-foreground")
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="flex flex-col gap-2">
          {filteredDays.slice(0, showAllDays ? undefined : 10).map((day) => (
            <DayRow
              key={day.date}
              day={day}
              jumpNonce={jump?.date === day.date ? jump.nonce : null}
              onDeleteReport={canEdit ? onDeleteReport : undefined}
              deletingCode={deletingCode}
              videoLinks={videoLinks}
              canEdit={canEdit}
              showPhase={showPhase}
              reserveDeaths={anyDeaths}
              floors={floors}
              firstPullStartByReport={firstPullStartByReport}
              onEditOffset={(reportCode, videoId) => {
                const existing =
                  videoId === null
                    ? null
                    : ((videoLinks[reportCode] ?? []).find((v) => v.id === videoId) ??
                      null);
                setOffsetTarget({
                  id: existing?.id ?? null,
                  reportCode,
                  videoUrl: existing?.videoUrl ?? "",
                  offset: String(existing?.offsetSeconds ?? 0),
                  label: existing?.label ?? "",
                });
              }}
            />
          ))}
        </ul>
        {filteredDays.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllDays((v) => !v)}
            className="self-start rounded px-1 font-mono text-[11px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showAllDays
              ? m.logs.showRecentOnly
              : m.logs.showRemainingDays(filteredDays.length - 10)}
          </button>
        )}
      </section>

      {failedSyncs.length > 0 && <FailedList failedSyncs={failedSyncs} />}

      <OffsetDialog
        target={offsetTarget}
        anchors={offsetAnchors}
        firstPullStartMs={
          offsetTarget
            ? (firstPullStartByReport.get(offsetTarget.reportCode) ?? null)
            : null
        }
        onChange={setOffsetTarget}
        onSaved={() => {
          setOffsetTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
