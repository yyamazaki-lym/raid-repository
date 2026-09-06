"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  Cloud,
  Loader2,
  Database,
  Camera,
  EyeOff,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useConfirm } from "@/components/portal/confirm-dialog";
import {
  countStoredPastSessions,
  deleteStoredPastSession,
  importPastScheduleFromDiscord,
  listExcludedPastSessions,
  restoreExcludedPastSession,
  snapshotScheduleNow,
  type ScheduleSnapshotResult,
} from "@/lib/server/categories-actions";
import { useMessages } from "@/lib/i18n/client";

// Inline copy of the Server Action result type — we can't re-export the
// type from a "use server" module on the client side, and the shape is
// stable.
type ScheduleHistoryImportResult = {
  ok: boolean;
  reason?: string;
  scanned: number;
  parsed: number;
  inserted: number;
  duplicates: number;
  /** Of `parsed`, how many were skipped because parsed_date is in the future. */
  skippedFuture?: number;
  /** Pre-existing future-dated rows deleted during this import as cleanup. */
  cleanedFuture?: number;
};

/**
 * TODO #66 (2026-05-02): settings-dialog.tsx 分割の一部。
 * Discord 通知チャンネル ID + 過去日程の取り込み / スナップショット /
 * 件数確認 / 個別削除を担当。
 *
 * channelId は親 (settings-dialog) が保持 — フッターの「保存」ボタンが
 * URL と一緒に保存するため。本コンポーネントは import / snapshot / count
 * 系の state を自前で持ち、open 時に importResult をリセットする。
 */
export function PastSessionsSection({
  open,
  channelId,
  onChannelIdChange,
}: {
  open: boolean;
  channelId: string;
  onChannelIdChange: (value: string) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const m = useMessages();
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] =
    useState<ScheduleHistoryImportResult | null>(null);
  const [counting, startCount] = useTransition();
  const [storedInfo, setStoredInfo] = useState<{
    ok: boolean;
    count: number;
    recentRows: {
      rawDate: string;
      parsedDate: string;
      source: string | null;
      /** 2.9 (2026-08-24): 過去ログから除外中なら timestamp、通常は null。 */
      excludedAt: string | null;
    }[];
    reason?: string;
  } | null>(null);
  const [deletingRow, startDeleteRow] = useTransition();
  // 2.9 (2026-08-24): 過去ログから除外中 (excluded_at) の日付一覧 + 解除。
  // 除外操作自体はトップの過去ログのゴミ箱アイコン
  // (`PastSessionRemoveButton`) 側で、ここは確認と解除だけを担当する。
  const [loadingExcluded, startLoadExcluded] = useTransition();
  const [restoring, startRestore] = useTransition();
  const [excludedInfo, setExcludedInfo] = useState<{
    ok: boolean;
    reason?: string;
    rows: {
      rawDate: string;
      parsedDate: string;
      source: string | null;
      excludedAt: string;
    }[];
  } | null>(null);
  const [snapshotting, startSnapshot] = useTransition();
  const [snapshotResult, setSnapshotResult] =
    useState<ScheduleSnapshotResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setImportResult(null);
  }, [open]);

  const onImport = () => {
    setImportResult(null);
    startImport(async () => {
      const r = await importPastScheduleFromDiscord();
      setImportResult(r);
      if (!r.ok) {
        toast.error(
          m.pastSessions.toastImportFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
        return;
      }
      toast.success(
        r.inserted > 0
          ? m.pastSessions.toastImported(r.inserted)
          : r.parsed > 0
            ? m.pastSessions.toastNoNew
            : m.pastSessions.toastNoMessages,
      );
      router.refresh();
    });
  };

  const onCount = () => {
    setStoredInfo(null);
    startCount(async () => {
      const r = await countStoredPastSessions();
      setStoredInfo(r);
      if (!r.ok)
        toast.error(
          m.pastSessions.toastCountFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
    });
  };

  const onDeleteStoredRow = async (rawDate: string) => {
    if (
      !(await confirm({
        title: m.pastSessions.confirmDeleteTitle,
        description: m.pastSessions.confirmDeleteDescription(rawDate),
        confirmText: m.common.delete,
        destructive: true,
      }))
    ) {
      return;
    }
    startDeleteRow(async () => {
      const r = await deleteStoredPastSession(rawDate);
      if (!r.ok) {
        toast.error(
          m.pastSessions.toastDeleteFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
        return;
      }
      toast.success(m.pastSessions.toastDeleted(rawDate));
      const refreshed = await countStoredPastSessions();
      setStoredInfo(refreshed);
      router.refresh();
    });
  };

  const onLoadExcluded = () => {
    setExcludedInfo(null);
    startLoadExcluded(async () => {
      const r = await listExcludedPastSessions();
      setExcludedInfo(r);
      if (!r.ok)
        toast.error(
          m.pastSessions.toastExcludedFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
      else if (r.rows.length === 0)
        toast.success(m.pastSessions.toastNoExcluded);
    });
  };

  const onRestoreExcluded = async (rawDate: string) => {
    if (
      !(await confirm({
        title: m.pastSessions.confirmRestoreTitle,
        description: m.pastSessions.confirmRestoreDescription(rawDate),
        confirmText: m.pastSessions.confirmRestoreButton,
      }))
    ) {
      return;
    }
    startRestore(async () => {
      const r = await restoreExcludedPastSession(rawDate);
      if (!r.ok) {
        toast.error(
          m.pastSessions.toastRestoreFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
        return;
      }
      toast.success(m.pastSessions.toastRestored(rawDate));
      const refreshed = await listExcludedPastSessions();
      setExcludedInfo(refreshed);
      router.refresh();
    });
  };

  const onSnapshot = () => {
    setSnapshotResult(null);
    startSnapshot(async () => {
      const r = await snapshotScheduleNow();
      setSnapshotResult(r);
      if (!r.ok) {
        toast.error(
          m.pastSessions.toastSnapshotFailed(
            r.reason ?? m.pastSessions.unknownReason,
          ),
        );
        return;
      }
      const baseMsg =
        r.scanned > 0
          ? m.pastSessions.toastSnapshotSaved(r.scanned, r.inserted, r.updated)
          : m.pastSessions.toastSnapshotNone;
      toast.success(
        r.cleanedCandidates > 0
          ? m.pastSessions.toastSnapshotCleanup(baseMsg, r.cleanedCandidates)
          : baseMsg,
      );
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Past Sessions from Discord
        </span>
      </header>

      <div className="flex flex-col gap-2">
        <Label
          htmlFor="discord-schedule-channel"
          className="text-xs text-foreground/80"
        >
          {m.pastSessions.channelLabel}
        </Label>
        <Input
          id="discord-schedule-channel"
          inputMode="numeric"
          value={channelId}
          onChange={(e) => onChannelIdChange(e.target.value)}
          placeholder={m.pastSessions.channelPlaceholder}
          className="font-mono text-[12px]"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {m.pastSessions.channelHelpBefore}
          <strong>{m.pastSessions.channelHelpStrong}</strong>
          {m.pastSessions.channelHelpAfter}
        </p>
        <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
          {m.pastSessions.botAccessNote}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onImport}
            disabled={importing || !channelId.trim()}
            className="gap-1.5 text-[11px] tracking-normal"
            title={
              !channelId.trim()
                ? m.pastSessions.importTitleNeedChannel
                : m.pastSessions.importTitle
            }
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Cloud className="h-3.5 w-3.5" aria-hidden />
            )}
            {importing ? m.pastSessions.importing : m.pastSessions.importButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSnapshot}
            disabled={snapshotting}
            className="gap-1.5 text-[11px] tracking-normal"
            title={m.pastSessions.snapshotTitle}
          >
            {snapshotting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Camera className="h-3.5 w-3.5" aria-hidden />
            )}
            {snapshotting
              ? m.pastSessions.snapshotting
              : m.pastSessions.snapshotButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCount}
            disabled={counting}
            className="gap-1.5 text-[11px] tracking-normal"
            title={m.pastSessions.countTitle}
          >
            {counting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Database className="h-3.5 w-3.5" aria-hidden />
            )}
            {m.pastSessions.countButton}
          </Button>
          {/* 2.9 (2026-08-24): 過去ログのゴミ箱アイコンで「実施しなかった日」
              として外した日付の確認 / 解除。除外は行削除ではなくマーカーなので
              いつでも元に戻せる。 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLoadExcluded}
            disabled={loadingExcluded}
            className="gap-1.5 text-[11px] tracking-normal"
            title={m.pastSessions.excludedTitle}
          >
            {loadingExcluded ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            )}
            {m.pastSessions.excludedButton}
          </Button>
        </div>
        {importResult && (
          <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
            <button
              type="button"
              onClick={() => setImportResult(null)}
              aria-label={m.pastSessions.closeImportResultAria}
              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
            {importResult.ok ? (
              <>
                <p>
                  {m.pastSessions.importSummary(importResult)}
                  {(importResult.skippedFuture ?? 0) > 0 &&
                    m.pastSessions.importSkippedFuture(
                      importResult.skippedFuture ?? 0,
                    )}
                  {(importResult.cleanedFuture ?? 0) > 0 &&
                    m.pastSessions.importCleanedFuture(
                      importResult.cleanedFuture ?? 0,
                    )}
                </p>
                <p className="text-muted-foreground text-[10px]">
                  {m.pastSessions.importNote}
                </p>
              </>
            ) : (
              <p className="text-rose-300">
                {m.pastSessions.errorPrefix(
                  importResult.reason ?? m.pastSessions.unknownReason,
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {snapshotResult && (
        <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
          <button
            type="button"
            onClick={() => setSnapshotResult(null)}
            aria-label={m.pastSessions.closeSnapshotResultAria}
            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
          {snapshotResult.ok ? (
            <>
              <p>
                {m.pastSessions.snapshotTarget(snapshotResult.scanned)}{" "}
                <strong>{snapshotResult.inserted}</strong>{" "}
                {m.pastSessions.snapshotUpdated}{" "}
                <strong>{snapshotResult.updated}</strong>
                {snapshotResult.cleanedCandidates > 0 && (
                  <>
                    {" "}
                    {m.pastSessions.snapshotCleanup}{" "}
                    <strong>{snapshotResult.cleanedCandidates}</strong>
                  </>
                )}
              </p>
              <p className="text-muted-foreground text-[10px]">
                {m.pastSessions.snapshotNote}
              </p>
            </>
          ) : (
            <p className="text-rose-300">
              {m.pastSessions.errorPrefix(
                snapshotResult.reason ?? m.pastSessions.unknownReason,
              )}
            </p>
          )}
        </div>
      )}
      {excludedInfo && (
        <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
          <button
            type="button"
            onClick={() => setExcludedInfo(null)}
            aria-label={m.pastSessions.closeExcludedAria}
            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
          {excludedInfo.ok ? (
            <>
              <p>
                {m.pastSessions.excludedCountBefore}{" "}
                <strong>{excludedInfo.rows.length}</strong>{" "}
                {m.pastSessions.excludedCountAfter}
              </p>
              {excludedInfo.rows.length > 0 && (
                <ul className="font-mono text-[10px] text-muted-foreground">
                  {excludedInfo.rows.map((row) => (
                    <li
                      key={row.rawDate}
                      className="flex items-center gap-1.5 break-words py-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => onRestoreExcluded(row.rawDate)}
                        disabled={restoring}
                        aria-label={m.pastSessions.restoreAria(row.rawDate)}
                        title={m.pastSessions.restoreTitle}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--neon-cyan)]/20 hover:text-[var(--neon-cyan)] disabled:opacity-40"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden />
                      </button>
                      <span className="text-muted-foreground/70">
                        [{row.source ?? "?"}]
                      </span>
                      <span>{row.rawDate}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-muted-foreground text-[10px]">
                {m.pastSessions.excludedNote}
              </p>
            </>
          ) : (
            <p className="text-rose-300">
              {m.pastSessions.errorPrefix(
                excludedInfo.reason ?? m.pastSessions.unknownReason,
              )}
            </p>
          )}
        </div>
      )}
      {storedInfo && (
        <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
          <button
            type="button"
            onClick={() => setStoredInfo(null)}
            aria-label={m.pastSessions.closeCountAria}
            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
          {storedInfo.ok ? (
            <>
              <p>
                {m.pastSessions.storedCount} <strong>{storedInfo.count}</strong>
              </p>
              {storedInfo.recentRows.length > 0 && (
                <ul className="font-mono text-[10px] text-muted-foreground">
                  <li className="mb-0.5">
                    {m.pastSessions.recentRows(storedInfo.recentRows.length)}
                  </li>
                  {storedInfo.recentRows.map((row, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-1.5 break-words py-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => onDeleteStoredRow(row.rawDate)}
                        disabled={deletingRow}
                        aria-label={m.pastSessions.deleteRowAria(row.rawDate)}
                        title={m.pastSessions.deleteRowTitle}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                      <span className="text-muted-foreground/70">
                        [{row.source ?? "?"}]
                      </span>
                      <span>{row.rawDate}</span>
                      {row.excludedAt && (
                        <span className="text-amber-300/80">
                          {m.pastSessions.excludedBadge}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-muted-foreground text-[10px]">
                {m.pastSessions.storedNote}
              </p>
            </>
          ) : (
            <p className="text-rose-300">
              {m.pastSessions.errorPrefix(
                storedInfo.reason ?? m.pastSessions.unknownReason,
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
