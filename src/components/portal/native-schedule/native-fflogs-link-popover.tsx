"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addNativeSessionLogsUrl,
  deleteNativeSessionLogsUrl,
} from "@/lib/server/categories-actions";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import { safeHref } from "@/lib/url-safe";
import { useConfirm } from "@/components/portal/confirm-dialog";

/**
 * 2.9 (2026-06-10) TODO #73 follow-up: native スケジュール版の FFLogs URL
 * manual link popover。schedule-list の SessionRow の date cell で、
 * `mode === 'native' && isAdmin && status === 'DECISION' && nativeSessionId`
 * 5 条件 AND の時だけ mount される `+` icon trigger を提供する。
 *
 * sync 側の `session-memo-popover.tsx` の FFLogs URL editor block
 * (L722-813) を縮約コピーし、native 用に調整:
 * - 対象テーブル: `schedule_past_session_logs` → `native_schedule_session_logs`
 * - 親 row 識別子: `raw_date` (sync) → `native_session_id` UUID (native)
 * - parent row placeholder INSERT は不要 (DECISION 化済の session に対してしか
 *   trigger UI が出ないため、parent `native_schedule_sessions` 行は必ず存在)
 *
 * 既存 auto-link 経路 (`linkReportsToNativeSessions()` from
 * [src/lib/server/fflogs.ts](src/lib/server/fflogs.ts)) は cleanup で
 * `source='auto'` のみ wipe するので、本 popover から追加された
 * `source='manual'` 行は cron 再走でも温存される。
 *
 * popover 構造は TODO #72 教訓踏襲:
 *   - `<Popover open={open} onOpenChange={setOpen}>` controlled
 *   - `{open && <PopoverContent finalFocus={false}>}` で close 時 DOM 残留を回避
 *
 * 削除確認は共通 `useConfirm()` (ConfirmDialog) を使用 (総合レビュー F-4 で
 * window.confirm から移行)。
 *
 * optimistic state パターンは sync 側と同型: add → 即時表示 + server action
 * 発火 + revalidatePath 後の sessionLogs prop 更新で reconcile、delete →
 * pendingDeletes Set に追加して即時非表示 + server action 発火。
 */

const HTTP_RE = /^https?:\/\//i;
const FFLOGS_REPORT_RE = /fflogs\.com\/reports\//i;

type Props = {
  /** native_schedule_sessions.id (uuid) */
  sessionId: string;
  /** 表示日 (rawDate の date 部分)。aria-label / popover header に使用。 */
  displayDate: string;
  /**
   * 現在の entries (auto + manual 両方含む)。schedule-list の SessionRow から
   * `sessionLogsByDate[rawDate]` を drill。revalidatePath('/') 後の parent
   * 再 render でこの prop が更新される → optimistic state を reconcile。
   */
  sessionLogs: SessionLogEntry[];
};

export function NativeFflogsLinkPopover({
  sessionId,
  displayDate,
  sessionLogs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newLogsInput, setNewLogsInput] = useState("");
  const [logsBusy, setLogsBusy] = useState(false);
  const confirm = useConfirm();

  // Optimistic state (sync 側と同パターン)。
  const [optimisticAdds, setOptimisticAdds] = useState<SessionLogEntry[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // 親の sessionLogs prop が revalidatePath 経由で更新されたら optimistic
  // state を reconcile (sync 側 session-memo-popover の useEffect と同型)。
  useEffect(() => {
    const realUrls = new Set(sessionLogs.map((s) => s.url));
    setOptimisticAdds((prev) => prev.filter((e) => !realUrls.has(e.url)));
    const realIds = new Set(sessionLogs.map((s) => s.id));
    setPendingDeletes((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (realIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [sessionLogs]);

  const displayedLogs = useMemo(
    () => [
      ...sessionLogs.filter((s) => !pendingDeletes.has(s.id)),
      ...optimisticAdds,
    ],
    [sessionLogs, optimisticAdds, pendingDeletes],
  );

  const handleAddLogs = async () => {
    const value = newLogsInput.trim();
    if (!value) return;
    // Client-side validate (server side でも同じガード、UX のため二重化)。
    if (!HTTP_RE.test(value)) {
      toast.error("FFLogs URL は http:// か https:// で始めてください");
      return;
    }
    if (!FFLOGS_REPORT_RE.test(value)) {
      toast.error(
        "FFLogs レポート URL を入力してください (例: https://www.fflogs.com/reports/abc123)",
      );
      return;
    }
    // UNIQUE 衝突を up-front guard (server もガード、UX のため二重化)。
    if (
      sessionLogs.some((s) => s.url === value) ||
      optimisticAdds.some((e) => e.url === value)
    ) {
      toast.error("同じ URL が既に紐付いています");
      return;
    }
    const tempId = `__optimistic-${Date.now()}-${Math.random()}`;
    const tempEntry: SessionLogEntry = {
      id: tempId,
      url: value,
      source: "manual",
    };
    setOptimisticAdds((prev) => [...prev, tempEntry]);
    setNewLogsInput("");
    setLogsBusy(true);
    const r = await addNativeSessionLogsUrl(sessionId, value);
    setLogsBusy(false);
    if (!r.ok) {
      setOptimisticAdds((prev) => prev.filter((e) => e.id !== tempId));
      setNewLogsInput(value);
      toast.error("Logs URL 追加失敗: " + r.reason);
      return;
    }
    // 2026-07-12: sync 側 (session-memo-popover) と同じく橋渡し件数を表示。
    toast.success(
      r.bridgedVideos
        ? `Logs URL を追加しました (同日の動画 ${r.bridgedVideos} 件にバッジ表示)`
        : "Logs URL を追加しました",
    );
  };

  const handleDeleteLogs = async (id: string) => {
    // Optimistic-only row (still pending insert): remove locally only.
    if (id.startsWith("__optimistic-")) {
      setOptimisticAdds((prev) => prev.filter((e) => e.id !== id));
      return;
    }
    const ok = await confirm({
      title: "この URL を削除しますか？",
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setLogsBusy(true);
    const r = await deleteNativeSessionLogsUrl(id);
    setLogsBusy(false);
    if (!r.ok) {
      setPendingDeletes((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error("Logs URL 削除失敗: " + r.reason);
      return;
    }
    toast.success(
      r.unbridgedVideos
        ? `Logs URL を削除しました (同日の動画 ${r.unbridgedVideos} 件のバッジも解除)`
        : "Logs URL を削除しました",
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-300/70 transition-all hover:bg-amber-400/15 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 active:scale-95"
        aria-label={`${displayDate} に FFLogs URL を追加 / 編集`}
        title="FFLogs URL を追加 / 編集 (admin)"
      >
        <Plus className="h-3 w-3" aria-hidden />
      </PopoverTrigger>
      {open && (
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="glass-popup w-80 max-w-[88vw] p-0"
          finalFocus={false}
        >
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <BarChart3
                className="h-3.5 w-3.5 text-amber-300/85"
                aria-hidden
              />
              <span className="min-w-0 truncate text-[9px] font-medium tracking-normal text-muted-foreground">
                {displayDate} の FFLogs URL
              </span>
              {displayedLogs.length > 0 && (
                <span
                  aria-hidden
                  className="font-mono text-[9px] tracking-[0.18em] text-amber-300/70"
                >
                  · {displayedLogs.length} 件
                </span>
              )}
            </div>

            {displayedLogs.length > 0 && (
              <ul className="flex flex-col gap-1">
                {displayedLogs.map((entry) => {
                  const safe = safeHref(entry.url);
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center gap-1 rounded border border-border/40 bg-background/30 px-2 py-1"
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85"
                        title={entry.url}
                      >
                        {entry.url}
                      </span>
                      <span
                        aria-hidden
                        className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/70 uppercase"
                      >
                        {entry.source}
                      </span>
                      {safe && (
                        <a
                          href={safe}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-amber-300/85 transition-colors hover:bg-amber-400/15 hover:text-amber-200"
                          title="新タブで開く"
                        >
                          <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                          開く
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteLogs(entry.id)}
                        disabled={logsBusy}
                        aria-label="この URL を削除"
                        title="削除"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-400/15 hover:text-rose-200 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center gap-1.5">
              <input
                value={newLogsInput}
                onChange={(e) => setNewLogsInput(e.target.value)}
                placeholder="https://www.fflogs.com/reports/abc123..."
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                className="h-7 flex-1 rounded border border-border/40 bg-background/30 px-2 font-mono text-[11px] text-foreground/90 transition-colors focus:border-amber-300/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAddLogs()}
                disabled={logsBusy || newLogsInput.trim().length === 0}
                className="inline-flex h-7 items-center whitespace-nowrap gap-1 rounded-md border border-amber-400/45 bg-amber-400/10 px-2.5 text-[10px] tracking-normal text-amber-200 transition-colors hover:border-amber-400/70 hover:bg-amber-400/18 disabled:opacity-50"
              >
                <Save className="h-3 w-3" aria-hidden />
                追加
              </button>
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
