"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  Cloud,
  Loader2,
  Database,
  Camera,
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
  snapshotScheduleNow,
  type ScheduleSnapshotResult,
} from "@/lib/server/categories-actions";

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
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] =
    useState<ScheduleHistoryImportResult | null>(null);
  const [counting, startCount] = useTransition();
  const [storedInfo, setStoredInfo] = useState<{
    ok: boolean;
    count: number;
    recentRows: { rawDate: string; parsedDate: string; source: string | null }[];
    reason?: string;
  } | null>(null);
  const [deletingRow, startDeleteRow] = useTransition();
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
        toast.error("取り込み失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      toast.success(
        r.inserted > 0
          ? `${r.inserted} 件の過去日程を追加`
          : r.parsed > 0
            ? "新規分なし（すべて取り込み済み）"
            : "通知メッセージ未検出",
      );
      router.refresh();
    });
  };

  const onCount = () => {
    setStoredInfo(null);
    startCount(async () => {
      const r = await countStoredPastSessions();
      setStoredInfo(r);
      if (!r.ok) toast.error("件数取得失敗: " + (r.reason ?? "原因不明"));
    });
  };

  const onDeleteStoredRow = async (rawDate: string) => {
    if (
      !(await confirm({
        title: "過去日程を削除",
        description: `削除しますか？\n${rawDate}\n\n過去日程からこの日が消えます。Discord 取り込みを再実行しても、この raw_date のメッセージが Discord 100 件に残っていれば再度 insert されます。`,
        confirmText: "削除",
        destructive: true,
      }))
    ) {
      return;
    }
    startDeleteRow(async () => {
      const r = await deleteStoredPastSession(rawDate);
      if (!r.ok) {
        toast.error("削除失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      toast.success(`削除しました: ${rawDate}`);
      const refreshed = await countStoredPastSessions();
      setStoredInfo(refreshed);
      router.refresh();
    });
  };

  const onSnapshot = () => {
    setSnapshotResult(null);
    startSnapshot(async () => {
      const r = await snapshotScheduleNow();
      setSnapshotResult(r);
      if (!r.ok) {
        toast.error("スナップショット失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      const baseMsg =
        r.scanned > 0
          ? `${r.scanned} 件保存（新規 ${r.inserted} / 更新 ${r.updated}）`
          : "保存対象のセッションなし";
      toast.success(
        r.cleanedCandidates > 0
          ? `${baseMsg} / 候補日 cleanup ${r.cleanedCandidates}`
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
          スケジュール通知チャンネル ID（任意）
        </Label>
        <Input
          id="discord-schedule-channel"
          inputMode="numeric"
          value={channelId}
          onChange={(e) => onChannelIdChange(e.target.value)}
          placeholder="例: 1234567890123456789"
          className="font-mono text-[12px]"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          日次の活動予定通知が投稿されているチャンネル ID。設定すると
          「<strong>本日YYYY/MM/DD(曜) HH:MM~HH:MM</strong>」形式のメッセージから過去の開催日を取得できます。
        </p>
        <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
          Bot がこのチャンネルにアクセスできる必要があります（View
          Channels + Read Message History）。
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
                ? "チャンネル ID を入力してください（先に保存）"
                : "Discord 履歴から過去日程を取り込み"
            }
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Cloud className="h-3.5 w-3.5" aria-hidden />
            )}
            {importing ? "取り込み中…" : "Discord 履歴から取り込み"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSnapshot}
            disabled={snapshotting}
            className="gap-1.5 text-[11px] tracking-normal"
            title="現在の出席状況を即時スナップショット（自動: 毎日21:50 JST）"
          >
            {snapshotting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Camera className="h-3.5 w-3.5" aria-hidden />
            )}
            {snapshotting ? "保存中…" : "出席状況を即時保存"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCount}
            disabled={counting}
            className="gap-1.5 text-[11px] tracking-normal"
            title="schedule_past_sessions の現在の保存件数を確認（デバッグ用）"
          >
            {counting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Database className="h-3.5 w-3.5" aria-hidden />
            )}
            DB の保存件数
          </Button>
        </div>
        {importResult && (
          <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
            <button
              type="button"
              onClick={() => setImportResult(null)}
              aria-label="取り込み結果を閉じる"
              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
            {importResult.ok ? (
              <>
                <p>
                  scanned {importResult.scanned} / 検出{" "}
                  {importResult.parsed} / 新規 {importResult.inserted} /
                  重複 {importResult.duplicates}
                  {(importResult.skippedFuture ?? 0) > 0 &&
                    ` / 未来日時 skip ${importResult.skippedFuture}`}
                  {(importResult.cleanedFuture ?? 0) > 0 &&
                    ` / 未来日時 cleanup ${importResult.cleanedFuture}`}
                </p>
                <p className="text-muted-foreground text-[10px]">
                  Discord は最新 100 件まで取得します（必要なら時間をおいて再実行）。未来日時の通知メッセージは過去日程に混ざらないよう自動で除外・クリーンアップされます。
                </p>
              </>
            ) : (
              <p className="text-rose-300">
                エラー: {importResult.reason ?? "原因不明"}
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
            aria-label="スナップショット結果を閉じる"
            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
          {snapshotResult.ok ? (
            <>
              <p>
                対象 {snapshotResult.scanned} 件 / 新規{" "}
                <strong>{snapshotResult.inserted}</strong> / 更新{" "}
                <strong>{snapshotResult.updated}</strong>
                {snapshotResult.cleanedCandidates > 0 && (
                  <>
                    {" "}
                    / 候補日 cleanup{" "}
                    <strong>{snapshotResult.cleanedCandidates}</strong>
                  </>
                )}
              </p>
              <p className="text-muted-foreground text-[10px]">
                character-sheets の DECISION (確定) 行のみを出席情報込みで保存します。
                CANDIDATE 行は対象外、過去 snapshot に混入していた CANDIDATE 行は自動 cleanup されます。
              </p>
            </>
          ) : (
            <p className="text-rose-300">
              エラー: {snapshotResult.reason ?? "原因不明"}
            </p>
          )}
        </div>
      )}
      {storedInfo && (
        <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
          <button
            type="button"
            onClick={() => setStoredInfo(null)}
            aria-label="保存件数表示を閉じる"
            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
          {storedInfo.ok ? (
            <>
              <p>
                DB 保存件数: <strong>{storedInfo.count}</strong>
              </p>
              {storedInfo.recentRows.length > 0 && (
                <ul className="font-mono text-[10px] text-muted-foreground">
                  <li className="mb-0.5">
                    直近 {storedInfo.recentRows.length} 件（新しい順
                    / 削除可）:
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
                        aria-label={`${row.rawDate} を削除`}
                        title={`この行を schedule_past_sessions から削除`}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                      >
                        <X className="h-3 w-3" aria-hidden />
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
                この件数はスケジュールページの「過去」にマージされる候補数です。実際は開催されていない日が混ざっていれば × ボタンで個別削除できます。0 なら保存されていない or SELECT が RLS で拒否されています。
              </p>
            </>
          ) : (
            <p className="text-rose-300">
              エラー: {storedInfo.reason ?? "原因不明"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
