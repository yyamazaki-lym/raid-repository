"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CopyMinus,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  clearScheduleTopTextOverride,
  setScheduleTopTextOverride,
} from "@/lib/schedule-top-text-store";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useDismissablePopup } from "@/lib/use-dismissable-popup";
import { dedupeSessionLogs } from "@/lib/server/categories-actions";
import {
  ATT_TONE,
  ATT_TONE_FALLBACK,
  buildAttendanceLegend,
} from "@/lib/schedule/attendance-ui";
import { useLocale, useMessages } from "@/lib/i18n/client";

export function Legend({
  hasUltimateClear = false,
  onRefresh,
  refreshing = false,
  topTextScraped = null,
  topTextOverride = null,
  attendanceChoices = [],
  isAdmin = false,
}: {
  hasUltimateClear?: boolean;
  /**
   * 2026-08-30 (Tier3-12): 管理操作の発見性。重複 Logs の整理は設定
   * ダイアログの奥にあり、問題に気づく画面 (この予定表) から遠かった。
   * admin にだけショートカットを 1 個出す。
   */
  isAdmin?: boolean;
  /** Called when the user clicks the refresh button at the right end. */
  onRefresh?: () => void;
  /** Show a spinning loader while the refresh transition is pending. */
  refreshing?: boolean;
  /** 元サイトから取り込んだオリジナル運用ルール / 注意事項。同期のたびに
   * 最新のものに更新される。 */
  topTextScraped?: string | null;
  /** Portal 側で編集された override (`app_settings.schedule_top_text_override`)。
   * 同期では上書きされない。トグルボタンで scraped 表示と切り替え可能。 */
  topTextOverride?: string | null;
  /** `/schedule/edit` の `choiceValues` 由来の出欠選択肢順 (`×` `－`
   * 含まず)。空配列なら標準 5 種にフォールバック。詳細は
   * `buildAttendanceLegend`。 */
  attendanceChoices?: readonly string[];
}) {
  const m = useMessages();
  const locale = useLocale();
  const legend = buildAttendanceLegend(attendanceChoices, locale);
  const router = useRouter();
  const confirm = useConfirm();
  // Local controlled-popover state for the top-text comment icon.
  const [showTopText, setShowTopText] = useState(false);
  const topTextRef = useRef<HTMLDivElement | null>(null);
  const ruleTriggerRef = useRef<HTMLButtonElement | null>(null);
  // フォーカス管理用の遷移トラッキング (非モーダル dialog)。
  const focusedForOpenRef = useRef(false);

  // 楽観的 override 状態: save / clear 直後に prop が更新されるまでの
  // 間 UI を即時反映するためのローカル shadow state。
  //   undefined: prop の `topTextOverride` をそのまま使う (通常時)
  //   null: 「クリア中」を即時反映 (= scraped 表示に戻す)
  //   string: 「保存中」のテキストを即時反映 (= 編集後タブで表示)
  // prop が「楽観値と一致」した時にのみ undefined に戻して prop に追従。
  // prop が予期せず別値 (特に null) で来た場合は optimistic を保持し続ける
  // ので、強制更新やネットワーク不安定時に編集後テキストが消えない。
  const [optimisticOverride, setOptimisticOverride] = useState<
    string | null | undefined
  >(undefined);
  const effectiveOverride =
    optimisticOverride !== undefined ? optimisticOverride : topTextOverride;
  useEffect(() => {
    setOptimisticOverride((curr) => {
      // 既に通常状態 (= optimistic 不在) なら何もしない
      if (curr === undefined) return undefined;
      // server (DB) 側の値が optimistic と一致 → save/clear が確実に
      // 反映されたと判断できるので、楽観 state を畳んで prop に切替。
      if (curr === topTextOverride) return undefined;
      // 不一致 (例: prop が null で帰ってきた、別タブで別の値が保存された)
      // → 楽観 state を保持してユーザーの編集を画面から消さない。
      return curr;
    });
  }, [topTextOverride]);

  // 表示モード: 編集後 (override) があれば default で edited、無ければ scraped。
  // ユーザーがトグル切替したらその選択を尊重するが、override の null/non-null
  // 遷移 (= 新規保存 / 完全クリア) では view を自動追従させる。
  const [view, setView] = useState<"edited" | "scraped">(
    effectiveOverride !== null ? "edited" : "scraped",
  );
  // override の存在状態の遷移を監視: null → non-null で edited、
  // non-null → null で scraped にフリップ。同値での更新 (例: 同期で
  // 同じ override が再取得された場合) は view を変えない (ユーザー選択
  // を維持)。
  const prevHasOverrideRef = useRef<boolean>(effectiveOverride !== null);
  useEffect(() => {
    const has = effectiveOverride !== null;
    if (prevHasOverrideRef.current !== has) {
      setView(has ? "edited" : "scraped");
    }
    prevHasOverrideRef.current = has;
  }, [effectiveOverride]);

  // 編集モード: textarea + save / cancel
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dedupingLogs, setDedupingLogs] = useState(false);

  // 重複 Logs の整理 (設定ダイアログと同じ server action)。結果は toast
  // だけに出し、詳細な競合一覧が要る場合は設定画面へ誘導する。
  const runDedupeLogs = async () => {
    setDedupingLogs(true);
    const r = await dedupeSessionLogs();
    setDedupingLogs(false);
    if (!r.ok) {
      toast.error(m.legend.dedupeFailed(r.reason));
      return;
    }
    const removed = r.duplicateRowsRemoved + r.videoConflictRowsRemoved;
    toast.success(
      removed > 0
        ? m.legend.dedupeRemoved(removed) +
            (r.remainingConflicts.length > 0
              ? m.legend.dedupeRemainingSuffix(r.remainingConflicts.length)
              : "")
        : r.remainingConflicts.length > 0
          ? m.legend.dedupeNoneRemaining(r.remainingConflicts.length)
          : m.legend.dedupeNone,
    );
    router.refresh();
  };

  // 表示する text と「rule アイコンを出すか」判定。
  // どちらか一方でも値があればアイコンは出す。
  const hasAny = topTextScraped !== null || effectiveOverride !== null;
  const displayed = view === "edited" ? effectiveOverride : topTextScraped;

  // 開閉の共通処理 (2026-08-30 Tier3-10: use-dismissable-popup へ集約)。
  // トリガー除外 (再クリックで閉じられない不具合の防止)・Escape・
  // フォーカス復帰はフックが持つ。`locked` に editing を渡すことで、
  // 編集中は外側クリック / Escape で閉じない従来の保護を維持する。
  useDismissablePopup({
    open: showTopText,
    onClose: () => setShowTopText(false),
    popupRef: topTextRef,
    triggerRef: ruleTriggerRef,
    locked: editing,
  });

  // フォーカス導入: ルールパネルを開いたらパネル本体 (role=dialog) へフォーカスを
  // 移す。1 度だけ (再レンダーでは奪わない)。トラップは張らない (非モーダル)。
  useEffect(() => {
    if (!showTopText) {
      focusedForOpenRef.current = false;
      return;
    }
    if (focusedForOpenRef.current) return;
    focusedForOpenRef.current = true;
    topTextRef.current?.focus();
  }, [showTopText]);

  // 1.9.16: ラベル "MEMBERS" デフォルト、絶クリア達成済みの固定なら
  // "LEGENDS" 表記に昇格 (称号として)。
  const label = hasUltimateClear ? "Legends" : "Members";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 bg-secondary/15 px-3 py-2 text-[11px]">
      <span
        className={
          "font-mono text-[10px] tracking-[0.22em] uppercase " +
          (hasUltimateClear
            ? "text-amber-300"
            : "text-muted-foreground")
        }
        title={hasUltimateClear ? m.legend.legendsTitle : m.legend.membersTitle}
      >
        {label}
      </span>
      {legend.map((l) => (
        <span key={l.symbol} className="inline-flex items-center gap-1.5">
          <span
            // 凡例記号は設定画面で自由に編集できるため、長い値でも h-4 の
            // chip を壊さないよう max-w + truncate + nowrap で抑える。
            className={
              "inline-flex h-4 min-w-5 max-w-[6rem] items-center justify-center truncate rounded-sm border px-0.5 text-[11px] whitespace-nowrap leading-none " +
              (ATT_TONE[l.symbol] ?? ATT_TONE_FALLBACK)
            }
            title={l.symbol}
          >
            {l.symbol}
          </span>
          {l.label !== null && (
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
              {l.label}
            </span>
          )}
        </span>
      ))}
      {/* 1.9.37: ルール / 更新ボタンを右端 1 グループにまとめる。
          ml-auto を group コンテナに付けて全体を右寄せ。ルール
          ボタンの popover は right-0 で button right-edge 揃えに
          開くので、画面右端からの overflow を防げる。 */}
      <div className="ml-auto flex items-center gap-1.5">
        {isAdmin && (
          <button
            type="button"
            onClick={() => void runDedupeLogs()}
            disabled={dedupingLogs}
            aria-label={m.legend.dedupeAria}
            title={m.legend.dedupeTitle}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-background/30 px-2 text-[10px] tracking-normal whitespace-nowrap text-muted-foreground transition-colors hover:border-amber-300/60 hover:text-foreground disabled:opacity-50"
          >
            {dedupingLogs ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <CopyMinus className="h-3 w-3" aria-hidden />
            )}
            {m.legend.dedupeButton}
          </button>
        )}
        {hasAny && (
          <span className="relative inline-flex">
            <button
              ref={ruleTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowTopText((v) => !v);
              }}
              aria-label={m.legend.rulesAria}
              title={m.legend.rulesTitle}
              aria-expanded={showTopText}
              aria-controls="legend-rules-panel"
              className="inline-flex h-6 items-center whitespace-nowrap gap-1 rounded-md border border-[var(--neon-violet)]/40 bg-[var(--neon-violet)]/8 px-2 text-[10px] tracking-normal text-[var(--neon-violet)]/90 transition-all hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/15 hover:shadow-[0_0_8px_-2px_rgba(167,139,250,0.55)]"
            >
              <MessageSquare className="h-3 w-3" aria-hidden />
              {m.legend.rulesButton}
              {effectiveOverride !== null && (
                <span
                  className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--neon-cyan)]"
                  title={m.legend.overrideDotTitle}
                  aria-hidden
                />
              )}
            </button>
            {showTopText && (
              <div
                ref={topTextRef}
                id="legend-rules-panel"
                role="dialog"
                aria-label={m.legend.rulesTitle}
                tabIndex={-1}
                /* 2026-09-04 実機報告「ルールを開くと見切れる」。横幅は
                   viewport に収めていたが縦は青天井で、ルール本文が長いと
                   画面下に突き抜けて読めなかった。画面高に収めて内側で
                   スクロールさせる (overscroll-contain で背面の予定表を
                   巻き込まない)。 */
                className="glass-popup absolute top-full right-0 z-40 mt-1 max-h-[min(70dvh,34rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-[var(--neon-violet)]/35 px-3.5 py-3 text-[12px] leading-relaxed text-foreground/85 shadow-[0_12px_40px_-16px_rgba(167,139,250,0.45),0_2px_8px_-2px_rgba(0,0,0,0.4)]"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-medium tracking-normal text-[var(--neon-violet)]/85">
                    {m.legend.rulesTitle}
                  </p>
                  {!editing && (
                    <div className="flex items-center gap-1">
                      {/* オリジナル ⇔ 編集後 切替 (両方 null でない時のみ表示) */}
                      {topTextScraped !== null && effectiveOverride !== null && (
                        <div
                          role="tablist"
                          aria-label={m.legend.viewSwitchAria}
                          className="inline-flex overflow-hidden rounded-md border border-border/50"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={view === "scraped"}
                            onClick={() => setView("scraped")}
                            title={m.legend.originalTitle}
                            className={
                              "px-1.5 py-0.5 text-[9px] tracking-normal transition-colors " +
                              (view === "scraped"
                                ? "bg-[var(--neon-violet)]/25 text-foreground"
                                : "text-muted-foreground hover:bg-secondary/50")
                            }
                          >
                            {m.legend.original}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={view === "edited"}
                            onClick={() => setView("edited")}
                            title={m.legend.editedTitle}
                            className={
                              "inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-normal transition-colors " +
                              (view === "edited"
                                ? "bg-[var(--neon-cyan)]/25 text-foreground"
                                : "text-muted-foreground hover:bg-secondary/50")
                            }
                          >
                            <span className="text-[var(--neon-cyan)]">★</span>
                            {m.legend.edited}
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // 編集 = override の編集。下敷きは現在表示中のテキスト
                          setDraft(displayed ?? "");
                          setEditing(true);
                        }}
                        aria-label={m.legend.editAria}
                        title={m.legend.editTitle}
                        className="inline-flex h-6 items-center whitespace-nowrap gap-1 rounded-md border border-[var(--neon-violet)]/40 bg-[var(--neon-violet)]/10 px-2 text-[10px] tracking-normal text-[var(--neon-violet)]/90 transition-colors hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/20"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                        {m.common.edit}
                      </button>
                      {/* override クリア (scraped 表示に戻す) */}
                      {effectiveOverride !== null && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await confirm({
                              title: m.legend.clearConfirmTitle,
                              description: m.legend.clearConfirmDescription,
                              confirmText: m.common.delete,
                              cancelText: m.common.cancel,
                              destructive: true,
                            });
                            if (!ok) return;
                            // 楽観的に「クリア済」を即時反映 → 失敗時 revert
                            setOptimisticOverride(null);
                            setView("scraped");
                            const r = await clearScheduleTopTextOverride();
                            if (!r.ok) {
                              setOptimisticOverride(undefined);
                              toast.error(m.legend.clearFailed(r.reason));
                              return;
                            }
                            toast.success(m.legend.clearSuccess);
                            router.refresh();
                          }}
                          aria-label={m.legend.clearAria}
                          title={m.legend.clearTitle}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-300/40 text-rose-300 transition-colors hover:bg-rose-500/15 hover:text-rose-200"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(
                        Math.max(draft.split("\n").length, 4),
                        14,
                      )}
                      className="w-full rounded-md border border-input bg-background/30 p-2 font-sans text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--neon-cyan)]/40"
                      spellCheck={false}
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setDraft("");
                        }}
                        disabled={saving}
                        className="inline-flex h-6 items-center whitespace-nowrap gap-1 rounded-md border border-border/60 px-2 text-[10px] tracking-normal text-muted-foreground transition-colors hover:bg-secondary/40 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" aria-hidden />
                        {m.common.cancel}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          // 編集中の draft を即時 UI に反映 (optimistic) し、
                          // 編集モードを抜けて表示を「編集後」タブに切替。
                          // refresh で prop が追いついたら useEffect が
                          // optimistic を破棄して prop に従う。
                          const text = draft;
                          setOptimisticOverride(text);
                          setView("edited");
                          setEditing(false);
                          setDraft("");
                          setSaving(true);
                          const r = await setScheduleTopTextOverride(text);
                          setSaving(false);
                          if (!r.ok) {
                            // 失敗 → optimistic を破棄して prop 表示に戻す
                            setOptimisticOverride(undefined);
                            toast.error(m.legend.saveFailed(r.reason));
                            return;
                          }
                          toast.success(m.legend.saveSuccess);
                          router.refresh();
                        }}
                        className="inline-flex h-6 items-center whitespace-nowrap gap-1 rounded-md border border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/15 px-2 text-[10px] tracking-normal text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/25 disabled:opacity-50"
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden />
                        )}
                        {m.common.save}
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed">
                    {displayed ?? m.legend.noText}
                  </pre>
                )}
              </div>
            )}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={m.legend.refreshLabel}
            title={m.legend.refreshLabel}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background/30 text-muted-foreground transition-all hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/8 hover:text-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
