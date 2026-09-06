"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
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
  ShieldAlert,
  Skull,
  SlidersHorizontal,
  Swords,
  Trash2,
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
  floorHalfOf,
  floorLabel,
  floorToneClass,
  formatFightDuration,
  formatPartyDps,
  formatPercentage,
  isClearFight,
  observedPhaseCount,
  percentageToneClass,
  phaseToneClass,
  progressTimeline,
  pullBreakdown,
  summarize,
  type DaySummary,
  type FightRow,
  type FloorMap,
  type PullBreakdownItem,
} from "@/lib/fflogs-progress";
import {
  buildFflogsFightViewUrl,
  buildFflogsReportUrl,
  buildVideoTimestampUrl,
  buildXivAnalysisUrl,
  formatClock,
} from "@/lib/fflogs-url";
import {
  PERF_BAR,
  PERF_BAR_SOFT,
  PERF_CHIP,
  PERF_TEXT,
  perfForDeaths,
  perfForProgress,
} from "@/lib/perf-tone";
import {
  formatMs,
  formatWipeLabel,
  jobAbbr,
  phaseTimeTotals,
  wipeCauseCounts,
  type PhaseSpan,
  type WipeCauseCount,
  type PhaseTimeTotal,
} from "@/lib/fflogs-fight-detail";
import { isSavageContent, isUltimateContent } from "@/lib/content-groups";
import { humanizeFflogsSyncReason } from "@/lib/fflogs-sync-reason";
import type { ReportVideoLink } from "@/lib/supabase/fflogs-fights";
import {
  deleteFflogsReportAction,
  importFflogsReportsAction,
  setCategoryMinDifficultyAction,
  setReportVideoAction,
  suggestVideoForReportAction,
  syncFflogsFightsAction,
} from "@/lib/server/fflogs-fights-actions";
import { useConfirm } from "@/components/portal/confirm-dialog";
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
 * 表示するのは PT としての到達度のみ。個人 DPS は集計も表示もしない
 * (2026-09-03 に加えた PT 合計 DPS / 死亡数も PT 単位の値で、個人の内訳は
 * DB にも無い)。
 */
export function LogsView({
  categoryId,
  categoryName,
  minDifficulty,
  fights,
  totalPulls,
  totalClears,
  truncated,
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
  phaseTotalsAll?: { totals: PhaseTimeTotal[]; pulls: number } | null;
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
  const confirm = useConfirm();
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
  // 絶のフェーズ数 (観測値)。層モデルと同じ「区間」として扱う (2026-09-03)。
  const phaseCount = useMemo(
    () => (showPhase ? observedPhaseCount(tierFights) : null),
    [showPhase, tierFights],
  );
  const summary = useMemo(
    () => summarize(tierFights, floors, showPhase),
    [tierFights, floors, showPhase],
  );
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
    () => pullBreakdown(tierFights, floors, showPhase),
    [tierFights, floors, showPhase],
  );
  // 2026-09-06 W-1: ワイプ原因 (初死亡の技) の集計。個人名は持たない。
  // 明細が打ち切られている場合は表示中の分だけの集計 (sub に明記)。
  const wipeCauses = useMemo(
    () => wipeCauseCounts(tierFights.map((f) => f.wipe), 5),
    [tierFights],
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
      title: `レポート ${code.slice(0, 8)} を練習ログから削除しますか？`,
      description:
        "このレポートの pull をすべて削除し、以後の同期でも取り込まないようにします (設定から解除できます)。",
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    setDeletingCode(code);
    const r = await deleteFflogsReportAction(code, "誤取り込み");
    setDeletingCode(null);
    if (!r.ok) {
      toast.error("削除失敗: " + r.reason);
      return;
    }
    toast.success(`${r.removedFights} pull を削除し、今後は取り込みません`);
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
      .map((idx) => {
        const label = floorLabel(floors, idx);
        return {
          index: idx,
          label,
          displayFloor: floors.displayFloorByIndex.get(idx) ?? idx,
          half: floorHalfOf(label),
        };
      });
  }, [floors, tierFights]);

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

  const difficultyButton = canEdit ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setDifficultyOpen(true)}
      className="gap-1.5 text-[11px] tracking-normal"
      title="取り込む難易度の下限を設定 (ノーマル混入の防止)"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
      取り込み設定
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
          <DialogTitle>取り込む難易度の下限</DialogTitle>
          <DialogDescription>
            ノーマルなど別難易度のレポートを取り込まないようにできます。
            FFLogs の難易度は数値で、コンテンツ種別によって値が変わります
            (公開された対応表がありません)。
            <strong>下の実測値を見て</strong>、残したい難易度の最小値を
            入れてください。空にすると制限なしに戻ります。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
            <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              取り込み済みの難易度
            </p>
            {difficultyStats.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                難易度が記録された pull がまだありません
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
                      {d.count} pull
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
            <Label htmlFor="min-difficulty">下限 (空 = 制限なし)</Label>
            <Input
              id="min-difficulty"
              value={difficultyDraft}
              inputMode="numeric"
              placeholder="例: 101"
              onChange={(e) => setDifficultyDraft(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              既に取り込んだ pull はこの設定では消えません。個別のレポートは
              日ごとの一覧にあるゴミ箱から削除してください。
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
            キャンセル
          </Button>
          <Button
            type="button"
            disabled={savingDifficulty}
            onClick={() => {
              const trimmed = difficultyDraft.trim();
              const value = trimmed === "" ? null : Number.parseInt(trimmed, 10);
              if (value !== null && !Number.isInteger(value)) {
                toast.error("数値で入力してください");
                return;
              }
              startSaveDifficulty(async () => {
                const r = await setCategoryMinDifficultyAction(
                  categoryId,
                  value,
                );
                if (!r.ok) {
                  toast.error("保存失敗: " + r.reason);
                  return;
                }
                toast.success(
                  value === null
                    ? "難易度の制限を解除しました"
                    : `難易度 ${value} 未満を取り込まないようにしました`,
                );
                setDifficultyOpen(false);
                router.refresh();
              });
            }}
          >
            {savingDifficulty ? "保存中..." : "保存"}
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
          {/* 2026-09-04 実機要望「分かりにくい文章の修正」。旧文は 1 段落に
              5 文を詰め込み、しかも「割り当てられる条件」という **仕組みの説明**
              から始まっていた。ここで読む人が知りたいのは「どうすれば出るか」
              なので、押すボタンを先に書き、仕組みは括弧に落とす。 */}
          <EmptyState
            icon={Activity}
            title="練習ログがまだありません"
            description={
              // 2026-09-06 実機指摘「若干左寄りに見える」: 中央寄せの箱の中で
              // 本文だけ text-left にしていたため、行末の余白ぶん左に寄って
              // 見えていた。見出しと同じく中央寄せに揃える。
              <span className="flex flex-col gap-2 text-center">
                <span>
                  FFLogs のレポートを取り込むと、pull 数・到達度・残 HP%
                  がここに並びます。取り込み方は 2 つです。
                </span>
                <span className="flex flex-col gap-1.5">
                  <span>
                    <strong className="font-medium text-foreground/85">
                      「ログを同期」を押す
                    </strong>
                    — 動画に FFLogs の URL が紐づいているか、コンテンツ編集で
                    zone ID / マッチワードを設定してあるか、レポートの zone 名が
                    一致すれば、このコンテンツのログとして取り込まれます。
                  </span>
                  <span>
                    <strong className="font-medium text-foreground/85">
                      「URL から取り込む」に貼る
                    </strong>
                    — 一覧に出てこない unlisted (限定公開) のレポートは、URL
                    を直接貼れば取り込めます。
                  </span>
                </span>
                <span className="text-muted-foreground/80">
                  private (非公開) のレポートだけは、FFLogs の公開設定を
                  unlisted 以上に変えるか、本人の FFLogs 連携が必要です。
                </span>
              </span>
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
          label="総 pull"
          value={String(shownTotalPulls)}
          sub={truncated ? `直近 ${summary.totalPulls} 件を表示` : undefined}
          detail={
            breakdown.length > 1 ? (
              <PullBreakdownChips items={breakdown} truncated={truncated} />
            ) : undefined
          }
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

      {/* 2026-09-06 W-1 / W-2: ワイプ原因の内訳とフェーズ滞在時間。
          どちらも「PT として何で止まっているか」の指標で、個人の値は無い。
          データが 1 つも無いコンテンツでは丸ごと出さない (旧データのみの
          カテゴリで空セクションを並べない)。 */}
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
              truncated={truncated}
              allPulls={phaseTotalsAll?.pulls ?? null}
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
          <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            日ごとの到達度
          </h3>
          <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70">
            バー = ベスト到達度 / 右端 = 討伐
            {segmentCount !== null &&
              (floors ? " / 縦線 = 層の境目" : " / 縦線 = フェーズの境目")}
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
                  title={`${t.date} のセッション振り返りを開く`}
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
                        // 2026-08-30 実機要望「右側の 1層 / 2層 なども層ごとに
                        // 色分けしたい」。チップの識別色と同じ色相をテキストに
                        // 当てる (背景まで付けると行が窮屈になるため文字色のみ)。
                        <span
                          className={
                            FLOOR_TEXT_TONE[
                              floors.displayFloorByIndex.get(t.bestFloor) ?? 0
                            ] ?? "text-foreground/70"
                          }
                        >
                          {floorLabel(floors, t.bestFloor)}{" "}
                        </span>
                      )}
                      {!floors && showPhase && t.bestPhase !== null && (
                        // 2026-09-03: 層ラベルと同じ扱いで、フェーズも識別色に。
                        <span
                          className={
                            PHASE_TEXT_TONE[t.bestPhase] ?? "text-foreground/70"
                          }
                        >
                          P{t.bestPhase}{" "}
                        </span>
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
                      className={
                        "h-3 w-3 " +
                        (t.isFirstClear
                          ? "text-emerald-300"
                          : "text-[var(--neon-cyan)]")
                      }
                      aria-label={t.isFirstClear ? "初討伐" : "自己ベスト更新"}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            セッション振り返り
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
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-normal transition-colors " +
                  (floorFilter === null
                    ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/12 text-[var(--neon-cyan)]"
                    : "border-border/50 text-muted-foreground hover:text-foreground")
                }
              >
                全層
              </button>
              {floorChoices.map((f) => (
                <button
                  key={f.index}
                  type="button"
                  onClick={() =>
                    setFloorFilter((cur) => (cur === f.index ? null : f.index))
                  }
                  aria-pressed={floorFilter === f.index}
                  title={`${f.label}の pull だけ表示`}
                  className={
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors " +
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
        {filteredDays.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllDays((v) => !v)}
            className="self-start rounded px-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showAllDays
              ? "直近 10 日だけ表示"
              : `残り ${filteredDays.length - 10} 日を表示`}
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

/**
 * 層ラベルの文字色 (2026-08-30)。`floorToneClass` と同じ色相の text のみ版。
 * 4層は前半/後半で分けたいが、ここは日ごとの最深層 (index) しか無いので
 * 表示層番号ベース。前半/後半の区別は行内の層チップ側で付く。
 */
const FLOOR_TEXT_TONE: Record<number, string> = {
  1: "text-sky-200",
  2: "text-teal-200",
  3: "text-violet-200",
  4: "text-rose-200",
};

/**
 * フェーズ (P1〜) の文字色 (2026-09-03)。`phaseToneClass` と同じ色相の
 * text のみ版 (層の FLOOR_TEXT_TONE と対になる)。
 */
const PHASE_TEXT_TONE: Record<number, string> = {
  1: "text-sky-200",
  2: "text-teal-200",
  3: "text-indigo-200",
  4: "text-violet-200",
  5: "text-fuchsia-200",
  6: "text-rose-200",
  7: "text-amber-200",
};

/**
 * フェーズの帯 (滞在時間バー) の背景色 (2026-09-06)。`phaseToneClass` と
 * 同じ色相の bg のみ版。8 以降 / 不明は cyan。
 */
const PHASE_BAR_TONE: Record<number, string> = {
  1: "bg-sky-400/70",
  2: "bg-teal-400/70",
  3: "bg-indigo-400/70",
  4: "bg-violet-400/70",
  5: "bg-fuchsia-400/70",
  6: "bg-rose-400/70",
  7: "bg-amber-400/70",
};
const PHASE_BAR_FALLBACK = "bg-[var(--neon-cyan)]/60";

/**
 * ワイプ原因の内訳カード (2026-09-06 W-1)。「初死亡の致命技」を技名で数え、
 * 多い順に並べる。絶ではどのフェーズで崩れたかも添える。
 * 誰が落ちたかは出さない (pull 行のジョブ略称までが粒度の上限)。
 */
function WipeCausesCard({
  causes,
  wipeCount,
  phaseCounts,
  truncated,
}: {
  causes: WipeCauseCount[];
  wipeCount: number;
  phaseCounts: Array<{ phase: number; count: number }>;
  truncated: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          ワイプ原因
        </span>
        <span
          className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70"
          title="各 wipe で最初に落ちた人の致命の一撃 (killing blow) を技名で数えています。DoT や遅れて倒れた場合は真因と一致しないことがあります"
        >
          初死亡の技 / {wipeCount} wipe
          {truncated ? " (表示中の分)" : ""}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5" aria-label="ワイプ原因の内訳">
        {causes.map((c) => (
          <li
            key={c.ability}
            className="flex items-center gap-2 font-mono text-[11px] tabular-nums"
          >
            <span className={"min-w-0 flex-1 truncate " + PERF_TEXT.bad} title={c.ability}>
              {c.ability}
            </span>
            <span className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-sm bg-secondary/50">
              <span
                className={"absolute inset-y-0 left-0 rounded-sm " + PERF_BAR.bad}
                style={{
                  width: `${Math.max(4, Math.round((c.count / Math.max(1, wipeCount)) * 100))}%`,
                }}
                aria-hidden
              />
            </span>
            <span className="w-8 shrink-0 text-right text-muted-foreground">
              ×{c.count}
            </span>
          </li>
        ))}
      </ul>
      {phaseCounts.length > 0 && (
        <ul
          className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"
          aria-label="初死亡が起きたフェーズ"
          title="最初の死亡が起きたフェーズごとの wipe 数"
        >
          {phaseCounts.map((p) => (
            <li
              key={p.phase}
              className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
            >
              <span className={PHASE_TEXT_TONE[p.phase] ?? "text-foreground/75"}>
                P{p.phase}
              </span>
              <span className="text-muted-foreground">{p.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * フェーズ滞在時間カード (2026-09-06 W-2、絶のみ)。取得済み pull の各
 * フェーズ滞在時間を合計し、積み上げバー + 凡例で出す。「P3 に時間の
 * 何割を使っているか」がそのまま練習の重心になる。
 */
function PhaseTimeCard({
  totals,
  truncated,
  allPulls,
}: {
  totals: Array<{ id: number; ms: number; share: number }>;
  truncated: boolean;
  /** 全件集計のときの母数 (pull 数)。null なら表示中の明細からの集計。 */
  allPulls: number | null;
}) {
  const totalMs = totals.reduce((acc, t) => acc + t.ms, 0);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          フェーズ滞在時間
        </span>
        <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground/70">
          合計 {formatMs(totalMs)}
          {allPulls !== null
            ? ` (登録ログ全 ${allPulls} pull)`
            : truncated
              ? " (表示中の分)"
              : ""}
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-sm bg-secondary/50"
        role="img"
        aria-label={totals
          .map((t) => `P${t.id} ${Math.round(t.share * 100)}%`)
          .join(" / ")}
      >
        {totals.map((t) => (
          <span
            key={t.id}
            className={PHASE_BAR_TONE[t.id] ?? PHASE_BAR_FALLBACK}
            style={{ width: `${t.share * 100}%` }}
            title={`P${t.id}: ${formatMs(t.ms)} (${Math.round(t.share * 100)}%)`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5" aria-label="フェーズごとの滞在時間">
        {totals.map((t) => (
          <li
            key={t.id}
            className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className={PHASE_TEXT_TONE[t.id] ?? "text-foreground/75"}>
              P{t.id}
            </span>
            <span className="text-foreground/80">{Math.round(t.share * 100)}%</span>
            <span className="text-muted-foreground">{formatMs(t.ms)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 1 pull のフェーズ滞在バー (2026-09-06 W-2)。区間チップの隣に置く小さな
 * 帯で、幅 = 戦闘時間に対する各フェーズの割合。hover で各フェーズの秒数。
 */
function PhaseSpanBar({ spans }: { spans: PhaseSpan[] }) {
  const total = spans.reduce((acc, s) => acc + s.dur, 0);
  if (total <= 0) return null;
  const label = spans.map((s) => `P${s.id} ${formatMs(s.dur)}`).join(" / ");
  return (
    <span
      className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-sm bg-secondary/50"
      role="img"
      aria-label={`フェーズ滞在: ${label}`}
      title={label}
    >
      {spans.map((s, i) => (
        <span
          key={`${s.id}:${i}`}
          className={PHASE_BAR_TONE[s.id] ?? PHASE_BAR_FALLBACK}
          style={{ width: `${(s.dur / total) * 100}%` }}
        />
      ))}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  detail,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  /** value / sub の下に出す補足 (内訳チップなど)。 */
  detail?: ReactNode;
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
      {detail}
    </li>
  );
}

/**
 * 総 pull タイルの内訳チップ (2026-09-03)。層は識別色 (FLOOR_TEXT_TONE /
 * 後半は fuchsia)、フェーズは foreground、討伐は emerald。枝葉が増えても
 * タイルの幅を壊さないよう、枠線なしの 10px mono を折り返して並べる。
 */
function PullBreakdownChips({
  items,
  truncated,
}: {
  items: PullBreakdownItem[];
  truncated: boolean;
}) {
  const tone = (b: PullBreakdownItem): string => {
    switch (b.kind) {
      case "floor":
        return b.half === "second"
          ? "text-fuchsia-200"
          : (FLOOR_TEXT_TONE[b.displayFloor ?? 0] ?? "text-foreground/70");
      case "phase":
        // 2026-09-03: フェーズも識別色を持たせたので内訳チップも揃える
        // (総 pull の内訳 / 日の見出し / pull 行 / 到達度の右ラベルで同色)。
        return PHASE_TEXT_TONE[b.phase ?? 0] ?? "text-foreground/75";
      case "clear":
        return "text-emerald-300";
      default:
        return "text-muted-foreground";
    }
  };
  return (
    <ul
      className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"
      aria-label="pull 数の内訳"
      title={
        truncated
          ? "表示中の明細の内訳 (古い pull は含まれません)"
          : "層 / フェーズごとの pull 数"
      }
    >
      {items.map((b) => (
        <li
          key={b.label}
          className="inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
        >
          <span className={tone(b)}>{b.label}</span>
          <span className="text-muted-foreground">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

function DayRow({
  day,
  jumpNonce,
  onDeleteReport,
  deletingCode,
  videoLinks,
  canEdit,
  showPhase,
  reserveDeaths,
  floors,
  firstPullStartByReport,
  onEditOffset,
}: {
  day: DaySummary;
  /**
   * 「日ごとの到達度」の日付クリックで飛んできたときに増える値
   * (自分の日でなければ null)。値が変わったら開く。
   */
  jumpNonce: number | null;
  /** admin のみ: このレポートを練習ログから削除する。 */
  onDeleteReport?: (reportCode: string) => void;
  deletingCode: string | null;
  videoLinks: Record<string, ReportVideoLink>;
  canEdit: boolean;
  showPhase: boolean;
  /** カテゴリ全体で死亡数が 1 つでも取得済みか (見出しの列幅の確保用)。 */
  reserveDeaths: boolean;
  floors: FloorMap;
  firstPullStartByReport: Map<string, number>;
  onEditOffset: (reportCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // jumpNonce の変化で開く。effect で setState するとカスケードレンダー
  // (react-hooks/set-state-in-effect) になるため、React 公式の
  // 「レンダー中に前回値と比較して調整する」形にする。
  const [lastJump, setLastJump] = useState<number | null>(jumpNonce);
  if (jumpNonce !== lastJump) {
    setLastJump(jumpNonce);
    if (jumpNonce !== null && !open) setOpen(true);
  }
  const codes = Array.from(new Set(day.fights.map((f) => f.reportCode)));
  // その日の死亡数の合計 (2026-09-03)。1 pull も取得できていない日は出さない。
  const dayDeaths = day.fights.some((f) => f.deaths !== null)
    ? day.fights.reduce((acc, f) => acc + (f.deaths ?? 0), 0)
    : null;
  // 2026-09-03 実機要望「もう少し綺麗に揃えられないか」。pull 行は列幅を
  // 固定して縦に揃えるが、**その日に 1 つも無い列は幅を取らない** (PT 指標が
  // 未取得の古い日や、動画が紐づいていない日で無駄な空白を作らないため)。
  const reserve = {
    metrics: day.fights.some((f) => f.partyDps !== null || f.deaths !== null),
    video: day.fights.some((f) => videoLinks[f.reportCode]?.videoUrl),
    // 絶はフェーズを層と同じ位置のチップで出すので、その列を確保する。
    phase: showPhase && day.fights.some((f) => f.lastPhase !== null),
    // 2026-09-06 W-2: フェーズ滞在バー (絶で遷移が取れた日のみ)。
    phaseBar:
      showPhase && day.fights.some((f) => f.phases !== null && f.phases.length > 1),
  };
  // 2026-09-06 W-1: この日のワイプ原因 (初死亡の技) 上位 3 つ。
  const dayWipeCauses = wipeCauseCounts(day.fights.map((f) => f.wipe), 3);

  return (
    <li
      id={`log-day-${day.date}`}
      className="scroll-mt-24 rounded-md border border-border/40 bg-secondary/15"
    >
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
        {/* 2026-09-03 実機要望「見出しの層・残 HP・CLEAR も揃えられるか」。
            日付は表記がデータ由来で長さが揃わない (「2026-09-01」のことも
            「2026/09/01(火) 22:00-2:00」のこともある) ため、日付列に余りを
            吸わせ (flex-1)、以降の列は固定幅にして行ごとに同じ位置で始める。 */}
        <span className="min-w-0 flex-1 truncate font-display text-sm tabular-nums">
          {day.date}
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {/* 「12 pull」を右寄せで固定幅に入れると、数字の右端も単位も揃う。 */}
          <span className="w-14 text-right">{day.pulls} pull</span>
          <span className="w-20 text-right">
            戦闘 {formatFightDuration(day.fightSeconds)}
          </span>
          {reserveDeaths && (
            <span
              className="inline-flex w-11 items-center justify-end gap-0.5"
              title={
                dayDeaths !== null
                  ? "この日の死亡数 (取得済みの pull の合計)"
                  : "この日の死亡数は未取得です"
              }
            >
              {dayDeaths !== null && (
                <>
                  <Skull className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  {dayDeaths}
                </>
              )}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* 何層 / どのフェーズに挑んだ日かを常時表示 (2026-08-28 実機
              フィードバック / 絶は 2026-09-03 追加)。複数に跨る日は範囲表記
              (例: 1-4層 / P1-P3)。幅は固定して右の結果チップを揃える。 */}
          {(() => {
            const chipClass =
              "w-[3.75rem] shrink-0 rounded-sm border px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ";
            if (floors && day.bestFloor !== null) {
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
              // その日が 1 つの層 index に収まるときだけ前半/後半色にする
              // (「4層前半と後半の両方に挑んだ日」は複合扱いのまま)。
              const singleHalf =
                minF === maxF ? floorHalfOf(floorLabel(floors, maxF)) : null;
              return (
                <span className={chipClass + floorToneClass(singleFloor, singleHalf)}>
                  {minF === maxF
                    ? floorLabel(floors, maxF)
                    : minD === maxD
                      ? `${maxD}層`
                      : `${minD}-${maxD}層`}
                </span>
              );
            }
            if (!showPhase) return null;
            const dayPhases = day.fights
              .map((f) => f.lastPhase)
              .filter((v): v is number => v !== null);
            if (dayPhases.length === 0) return null;
            const minP = Math.min(...dayPhases);
            const maxP = Math.max(...dayPhases);
            return (
              <span className={chipClass + phaseToneClass(minP === maxP ? maxP : null)}>
                {minP === maxP ? `P${maxP}` : `P${minP}-${maxP}`}
              </span>
            );
          })()}
          {/* 結果 (CLEAR / 残%) も固定幅・中央寄せ。フェーズは上のチップが
              担うので、ここでは残% だけを出す (層と同じ組み立て)。 */}
          {day.clears > 0 ? (
            <span className="inline-flex w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1 py-0.5 font-mono text-[11px] whitespace-nowrap text-emerald-200">
              <Trophy className="h-3 w-3 shrink-0" aria-hidden />
              CLEAR
            </span>
          ) : (
            <span
              className={
                "w-[4.5rem] shrink-0 text-center font-mono text-[11px] whitespace-nowrap tabular-nums " +
                percentageToneClass(day.bestPercentage)
              }
            >
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
                <span key={code} className="inline-flex items-center gap-0.5">
                <button
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
                {/* 2026-08-30: 誤って取り込んだレポート (ノーマル等) を
                    ここから消せるようにする。削除 = pull を消したうえで
                    以後の同期でも取り込まない (除外リスト行き)。 */}
                {onDeleteReport && (
                  <button
                    type="button"
                    onClick={() => onDeleteReport(code)}
                    disabled={deletingCode === code}
                    aria-label={`レポート ${code} を練習ログから削除`}
                    title="このレポートを練習ログから削除 (以後も取り込まない)"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                )}
                </span>
              ))}
            </div>
          )}
          {dayWipeCauses.length > 0 && (
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums"
              title="この日の wipe で最初に落ちた人の致命の一撃 (技名) を数えたもの"
            >
              <span className="tracking-[0.14em] text-muted-foreground uppercase">
                ワイプ原因
              </span>
              {dayWipeCauses.map((c) => (
                <span key={c.ability} className="inline-flex items-baseline gap-1">
                  <span className={PERF_TEXT.bad}>{c.ability}</span>
                  <span className="text-muted-foreground">×{c.count}</span>
                </span>
              ))}
            </p>
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
                reserve={reserve}
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
  reserve,
}: {
  index: number;
  fight: FightRow;
  video: ReportVideoLink | null;
  showPhase: boolean;
  floors: FloorMap;
  firstPullStartMs: number | null;
  /**
   * 列幅を確保するか (2026-09-03)。その日のどれかの pull に値があれば、
   * 値の無い pull も幅だけ残して縦揃えを保つ。1 つも無い列は幅を取らない。
   */
  reserve: { metrics: boolean; video: boolean; phase: boolean; phaseBar: boolean };
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
          結果 (CLEAR / 残%) は熱量色の別チップに分離した。
          2026-09-03: 3 つのメタ列 (#回数 / 時刻 / 戦闘時間) が同系の灰色で
          区別しづらかったので色相を分けた (実機要望)。層・結果・リンクが
          既に色で意味を持っているため、ここは主張しすぎない彩度に留める:
          #回数 = cyan / 時刻 = 寒色グレー / 戦闘時間 = indigo。
          戦闘時間に暖色 (amber) を当てると残 HP% の熱量色 (orange/amber) や
          Logs チップと同系になって「警告的な値」に見えるため避けた。
          3 色ともテーマ var を経由しない固定色にする — `--neon-cyan` は
          テーマで色相が動き (azure テーマでは indigo と、verdant では
          CLEAR の emerald と近づく)、列の区別がテーマ依存になるため。
          層 / 熱量色を全テーマ共通の固定色にしているのと同じ理由。
          桁数で列がずれないよう数値列は右寄せ + tabular-nums。 */}
      <span
        className="w-8 shrink-0 text-right font-mono text-[11px] text-cyan-300/80 tabular-nums"
        title={`この日の ${index} 番目の pull`}
      >
        #{index}
      </span>
      <span
        className="w-9 shrink-0 font-mono text-[11px] text-slate-400 tabular-nums"
        title="戦闘開始時刻 (JST)"
      >
        {clock}
      </span>
      <span
        className="w-10 shrink-0 text-right font-mono text-[11px] text-indigo-300/90 tabular-nums"
        title="戦闘時間"
      >
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
        const floorHalf =
          floors && floor !== null ? floorHalfOf(floorLabel(floors, floor)) : null;
        const isClear = isClearFight(fight, floors);
        // 層ラベルは「1層」〜「4層後半」で文字数が変わる。幅を固定して
        // 中央寄せにし、後続の列 (結果 / PT 指標) が行ごとにずれないようにする。
        // 2026-09-03: 絶はフェーズを同じ列のチップにする (結果チップから
        // 「P3 」の前置きが消え、零式と同じ「区間チップ + 残%」の並びになる)。
        const chipClass =
          "w-[3.75rem] shrink-0 rounded-sm border px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ";
        const segmentChip =
          floor !== null ? (
            <span className={chipClass + floorToneClass(displayFloor, floorHalf)}>
              {floorLabel(floors, floor)}
            </span>
          ) : showPhase && fight.lastPhase !== null ? (
            <span className={chipClass + phaseToneClass(fight.lastPhase)}>
              P{fight.lastPhase}
            </span>
          ) : reserve.phase ? (
            <span className="w-[3.75rem] shrink-0" aria-hidden />
          ) : null;
        // 結果チップも幅を固定する (フェーズは上の区間チップに移したので
        // 零式・絶で同じ幅)。
        const resultWidth = "w-[4.25rem]";
        // kill は層を問わず CLEAR 表記 (最終層 = 濃い緑 / 他層 = 淡い緑)。
        const resultChip = fight.kill ? (
          <span
            className={
              `${resultWidth} shrink-0 rounded-sm px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums ` +
              (isClear
                ? "bg-emerald-400/20 font-medium text-emerald-200"
                : "bg-emerald-400/10 text-emerald-200/80")
            }
          >
            CLEAR
          </span>
        ) : (
          <span
            className={`${resultWidth} shrink-0 rounded-sm bg-secondary/50 px-1 py-0.5 text-center font-mono text-[11px] whitespace-nowrap tabular-nums`}
          >
            <span className={percentageToneClass(fight.fightPercentage)}>
              残{formatPercentage(fight.fightPercentage)}
            </span>
          </span>
        );
        // 2026-09-03: 残 HP% の横に PT 合計 DPS と死亡数 (取得済みの pull のみ)。
        // 個人の内訳は無い — PT として削れているか / 何人落ちたかだけ。
        // 値の無い pull もスロットの幅は残す (その日に 1 つでも値があるとき)
        // ので、数字が縦に揃う。
        const metrics = reserve.metrics ? (
          <span className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] whitespace-nowrap tabular-nums">
            <span
              className="inline-flex w-14 items-center justify-end gap-0.5 text-foreground/80"
              title={
                fight.partyDps !== null
                  ? "PT 合計 DPS (個人の内訳は保存していません)"
                  : "PT 合計 DPS は未取得です"
              }
            >
              {fight.partyDps !== null && (
                <>
                  <Swords
                    className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  {formatPartyDps(fight.partyDps)}
                </>
              )}
            </span>
            <span
              className={
                "inline-flex w-8 items-center justify-end gap-0.5 " +
                // 2026-09-06 (UI-12): 死亡数は 0 = 良い … 5+ = 悪い の 5 段階。
                (fight.deaths === 0
                  ? "text-muted-foreground"
                  : PERF_TEXT[perfForDeaths(fight.deaths)])
              }
              title={fight.deaths !== null ? "死亡数" : "死亡数は未取得です"}
            >
              {fight.deaths !== null && (
                <>
                  <Skull className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  {fight.deaths}
                </>
              )}
            </span>
          </span>
        ) : null;
        // 2026-09-06 W-2: フェーズ滞在バー (絶のみ)。遷移が取れていない
        // pull はその日に 1 つでもあれば幅だけ残す。
        const phaseBar =
          showPhase && fight.phases && fight.phases.length > 1 ? (
            <PhaseSpanBar spans={fight.phases} />
          ) : reserve.phaseBar ? (
            <span className="w-16 shrink-0" aria-hidden />
          ) : null;
        // 2026-09-06 W-1: ワイプ原因 (最初に落ちたジョブ ← 致命技 +同時死亡数)。
        // 個人名は持っていない。可変幅なので左グループの末尾に置く。
        const wipeChip = fight.wipe ? (
          <span
            className={
              "inline-flex max-w-[15rem] min-w-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
              PERF_CHIP.bad
            }
            title={
              `最初の死亡: ${formatMs(fight.wipe.t)}` +
              (fight.wipe.phase !== null ? ` (P${fight.wipe.phase})` : "") +
              ` / ${jobAbbr(fight.wipe.job)}` +
              (fight.wipe.ability ? ` ← ${fight.wipe.ability}` : "") +
              (fight.wipe.cluster > 1
                ? ` / 10 秒以内に ${fight.wipe.cluster} 人`
                : "") +
              ` / 死亡 ${fight.wipe.total}`
            }
          >
            <Skull className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{formatWipeLabel(fight.wipe)}</span>
          </span>
        ) : null;
        return (
          <>
            {segmentChip}
            {phaseBar}
            {resultChip}
            {metrics}
            {wipeChip}
          </>
        );
      })()}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {/* FFLogs 群: 概要 (Logs) + 死亡 + 被ダメの 3 ビュー。2026-08-30
            調査 §2 の deep link。行が伸びないよう、追加の 2 つは
            アイコンのみ (ラベルは title / aria-label) にして左右に
            border でつないだ 1 グループとして見せる。 */}
        <span className="inline-flex items-center overflow-hidden rounded-sm border border-amber-400/45 bg-amber-400/10">
          <a
            href={buildFflogsReportUrl(fight.reportCode, fight.fightId)}
            target="_blank"
            rel="noopener noreferrer"
            title="FFLogs でこの pull を開く"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-amber-200 uppercase transition-colors hover:bg-amber-400/20"
          >
            <BarChart3 className="h-2.5 w-2.5" aria-hidden />
            Logs
          </a>
          <a
            href={buildFflogsFightViewUrl(
              fight.reportCode,
              fight.fightId,
              "deaths",
            )}
            target="_blank"
            rel="noopener noreferrer"
            title="この pull の死亡一覧 (死亡直前の被ダメ / 回復) を開く"
            aria-label="死亡一覧を開く"
            className="inline-flex items-center border-l border-amber-400/35 px-1.5 py-0.5 text-amber-200/85 transition-colors hover:bg-amber-400/20 hover:text-amber-100"
          >
            <Skull className="h-2.5 w-2.5" aria-hidden />
          </a>
          <a
            href={buildFflogsFightViewUrl(
              fight.reportCode,
              fight.fightId,
              "damage-taken",
            )}
            target="_blank"
            rel="noopener noreferrer"
            title="この pull の被ダメージ (何で削られたか) を開く"
            aria-label="被ダメージを開く"
            className="inline-flex items-center border-l border-amber-400/35 px-1.5 py-0.5 text-amber-200/85 transition-colors hover:bg-amber-400/20 hover:text-amber-100"
          >
            <ShieldAlert className="h-2.5 w-2.5" aria-hidden />
          </a>
        </span>
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
        {/* 動画チップは「1:13:08」まで入る幅で固定し、動画が無い pull には
            同じ幅の空きを置く (その日に動画がある場合のみ)。これで LOGS /
            ANALYSIS の位置が行ごとにずれない。 */}
        {videoHref ? (
          <a
            href={videoHref}
            target="_blank"
            rel="noopener noreferrer"
            title="動画のこの瞬間から再生"
            className="inline-flex w-[4.75rem] items-center justify-center gap-1 rounded-sm border border-violet-400/45 bg-violet-400/10 px-1 py-0.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap text-violet-200 uppercase transition-colors hover:bg-violet-400/15"
          >
            <Film className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {videoSeconds !== null ? formatClock(videoSeconds) : "動画"}
          </a>
        ) : (
          reserve.video && <span className="w-[4.75rem] shrink-0" aria-hidden />
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
