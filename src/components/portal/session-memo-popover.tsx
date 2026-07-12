"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createScheduleMemo,
  deleteScheduleMemo,
  getStoredAuthorName,
  MEMO_AUTHOR_NAME_MAX,
  MEMO_BODY_MAX,
  persistAuthorName,
  updateScheduleMemo,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import {
  addSessionLogsUrl,
  deleteSessionLogsUrl,
} from "@/lib/server/categories-actions";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import { safeHref } from "@/lib/url-safe";
import { DeleteConfirmModal } from "./schedule/session-memo-delete-modal";
import { formatRelativeTime } from "@/lib/schedule/time-formatters";

const EMPTY_SESSION_LOGS: SessionLogEntry[] = [];

/**
 * Click-on-date popover that lets any viewer leave shared memos for a
 * specific session. The realtime fetch lives ONE LEVEL UP at the row
 * (so a single subscription per session row, not one per
 * popover instance), and the row passes `memos` in as a prop.
 *
 * Popover content is rendered through a Portal so the parent's
 * `overflow-hidden` (Card border-radius clipping) doesn't truncate
 * the popover. Position is fixed and computed from the trigger's
 * bounding-rect; it closes on scroll / resize so stale coordinates
 * don't drift away from the trigger.
 */

type Props = {
  rawDate: string;
  /** What date label to show in the popover header. */
  displayDate: string;
  /** Realtime-tracked memo list for `rawDate`. */
  memos: ScheduleSessionMemo[];
  /**
   * Force-refresh callback exposed by `useRealtimeScheduleMemos`.
   * Called after each successful CUD so the UI updates instantly even
   * when the realtime DELETE event is missing `old.raw_date` (DBs that
   * lack `REPLICA IDENTITY FULL` on the table).
   */
  onRefresh?: () => Promise<void>;
  /**
   * Existing `schedule_past_session_logs` rows for this date. The
   * editor lists them with delete + open buttons so users can clean
   * up wrong auto-matches and remove stale manual entries inline.
   * TODO #64 (2.1, 2026-05-02 part5): replaces the legacy
   * `currentLogsUrl: string | null` prop.
   */
  sessionLogs?: SessionLogEntry[];
  /**
   * Session details for upserting the past_session row when manually
   * setting a logs URL for a session that hasn't been snapshotted yet.
   */
  sessionDetails?: {
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  };
  children: React.ReactNode;
  /** React 19: ref を通常 prop で受け取る (旧 forwardRef を置換)。 */
  ref?: React.Ref<SessionMemoPopoverHandle>;
};

/**
 * Imperative handle exposed via the `ref` prop (React 19 では `forwardRef`
 * 不要) so siblings (e.g. the memo-count dot rendered outside this
 * component's wrapper) can open the popover without lifting state into the
 * parent. Keeps the popover self-contained while still allowing remote
 * triggers.
 */
export type SessionMemoPopoverHandle = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

export function SessionMemoPopover({
  rawDate,
  displayDate,
  memos,
  onRefresh,
  sessionLogs = EMPTY_SESSION_LOGS,
  sessionDetails,
  children,
  ref,
}: Props) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
    }),
    [],
  );
  const popupRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // フォーカス管理用の遷移トラッキング (非モーダル dialog)。
  const focusedForOpenRef = useRef(false);
  const wasOpenRef = useRef(false);
  // top / bottom はどちらか一方のみ設定される (下側配置 = top、上側
  // 配置 = bottom アンカーで上方向に伸びる)。maxHeight は配置側で
  // 使える実高さ (px)。
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  // Compute the popup's fixed-position coordinates whenever it
  // opens. On scroll/resize, REPOSITION (track the trigger) instead
  // of closing — the previous "close on scroll" behavior was hostile
  // when users wanted to scroll within the popup (long memo lists)
  // or just shift the page slightly while reading.
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Default: below trigger, left-aligned. Clamp horizontally so
      // the popup never escapes the viewport on small screens.
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const popupWidth = Math.min(448, viewportWidth - 32);
      const left = Math.max(
        16,
        Math.min(rect.left, viewportWidth - popupWidth - 16),
      );
      // トリガーの上下それぞれで使える高さ (4px = トリガーとの隙間、
      // 16px = viewport 端とのマージン)。
      const spaceBelow = viewportHeight - rect.bottom - 4 - 16;
      const spaceAbove = rect.top - 4 - 16;
      // ページ下部の行では下側配置だとヘッダーしか見えない高さまで
      // 潰れて読めない (2026-06-12 報告)。下側に最低限の高さが確保
      // できず、かつ上側のほうが広い場合はトリガーの上に反転配置する。
      const MIN_POPUP_HEIGHT = 320;
      if (spaceBelow < MIN_POPUP_HEIGHT && spaceAbove > spaceBelow) {
        setCoords({
          bottom: viewportHeight - rect.top + 4,
          left,
          maxHeight: spaceAbove,
        });
      } else {
        setCoords({ top: rect.bottom + 4, left, maxHeight: spaceBelow });
      }
    };
    place();
    const onResize = () => place();
    const onScroll = () => place();
    // Capture phase so we hear scrolls on inner scrollable elements
    // too (e.g. the page's own scroll container in some layouts).
    // The popup's own internal scroll fires its own scroll event,
    // but capture-phase callbacks won't reposition it incorrectly
    // because the trigger (wrapperRef) hasn't moved.
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [open]);

  // Click-outside-to-dismiss + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popupRef.current?.contains(t)) return;
      if (wrapperRef.current?.contains(t)) return;
      // The memo dot is rendered OUTSIDE the wrapperRef (parent places
      // it as a sibling so chip/row reading order = date → icons → dot
      // is preserved). Treat dot clicks as "inside" so the 2nd click
      // on the dot can reach the React click handler without being
      // pre-empted by this outside-click handler. Without this guard,
      // mousedown on dot fires → setOpen(false), then click → toggle
      // → setOpen(false → true), netting "popup stays open" (= dot
      // click does nothing visually). Attribute-based check is used
      // because React 19's synthetic e.stopPropagation() does NOT
      // stop the underlying native DOM event from bubbling to this
      // document-level listener, so per-button stopPropagation is
      // unreliable.
      if (t instanceof Element && t.closest("[data-memo-dot-trigger]"))
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // フォーカス導入: 開いたらパネル本体 (role=dialog) へフォーカスを移す。
  // このパネルは document.body へ portal されるため、トリガーから Tab して
  // も DOM 順では届かない。coords が確定 = パネルが mount 済みなので、その
  // タイミングで 1 度だけフォーカスする (スクロール/リサイズでの coords 更新
  // では再フォーカスしない)。トラップは張らない (非モーダル)。
  useEffect(() => {
    if (!open) {
      focusedForOpenRef.current = false;
      return;
    }
    if (focusedForOpenRef.current || !coords) return;
    focusedForOpenRef.current = true;
    popupRef.current?.focus();
  }, [open, coords]);

  // フォーカス復帰: Esc / 閉じる×でパネル内の要素ごと unmount され、フォーカス
  // が <body> に落ちた場合のみトリガーへ戻す。外クリックで別コントロールへ
  // 移った場合 (activeElement が body 以外) はユーザーの操作を尊重して奪わない。
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (
      typeof document !== "undefined" &&
      (document.activeElement === null ||
        document.activeElement === document.body)
    ) {
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <span ref={wrapperRef} className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex cursor-pointer items-center"
        aria-expanded={open}
        aria-label={`${displayDate} のメモを開く`}
      >
        {children}
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            role="dialog"
            aria-label={`${displayDate} のメモ`}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: "min(28rem,calc(100vw - 2rem))",
              // Cap height so the popup never extends past the
              // edge of the viewport. Inner sections handle their
              // own scrolling, and the popup body itself can also
              // scroll when content (form + lots of memos) exceeds
              // this cap.
              maxHeight: coords.maxHeight,
            }}
            className="glass-popup z-50 flex flex-col overflow-hidden rounded-lg border border-[var(--neon-violet)]/35 shadow-[0_12px_40px_-16px_rgba(167,139,250,0.45),0_2px_8px_-2px_rgba(0,0,0,0.4)]"
          >
            {/* Header strip — subtle violet wash that anchors the
                popup with a clear "what is this" affordance, plus
                close X. The thin glow strip below the header (via
                border-b + bg) gives the panel a definite "title bar
                / body" split without a heavy divider. */}
            <header className="flex items-center justify-between gap-2 border-b border-[var(--neon-violet)]/25 bg-[var(--neon-violet)]/8 px-3 py-2">
              <div className="flex items-center gap-2">
                <MessageSquare
                  className="h-3 w-3 text-[var(--neon-violet)]"
                  aria-hidden
                />
                <p className="font-mono text-[10px] tracking-[0.22em] text-[var(--neon-violet)] uppercase">
                  {displayDate}
                </p>
                <span
                  aria-hidden
                  className="font-mono text-[10px] tracking-[0.18em] text-[var(--neon-violet)]/55 uppercase"
                >
                  · memo
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-[var(--neon-violet)]/15 hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <MemoList
                rawDate={rawDate}
                memos={memos}
                onRefresh={onRefresh}
                sessionLogs={sessionLogs}
                sessionDetails={sessionDetails}
              />
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

// SessionMemoDot は C-5 で `@/components/portal/schedule/session-memo-dot` に移動。

function MemoList({
  rawDate,
  memos,
  onRefresh,
  sessionLogs,
  sessionDetails,
}: {
  rawDate: string;
  memos: ScheduleSessionMemo[];
  onRefresh?: () => Promise<void>;
  sessionLogs: SessionLogEntry[];
  sessionDetails?: {
    parsedDate: string;
    startTime: string;
    endTime: string;
    dayOfWeek: string;
  };
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingAuthor, setEditingAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  // Holds the memo currently pending delete-confirmation. `null` =
  // nothing pending. Replaces `window.confirm` (which renders at the
  // top of the viewport in some browsers) with a Portal-rendered
  // overlay centered on screen.
  const [pendingDelete, setPendingDelete] =
    useState<ScheduleSessionMemo | null>(null);
  // TODO #64 (2.1, 2026-05-02 part5): simplified FFLogs editor —
  // existing rows render with delete + open buttons (read-only URL),
  // and a single input + 追加 button appends a new manual entry.
  // Replaces the legacy "single URL with edit-in-place" UI.
  const [newLogsInput, setNewLogsInput] = useState("");
  const [logsBusy, setLogsBusy] = useState(false);

  // TODO #65 (2.1, 2026-05-02 part6): optimistic state. Add / delete
  // surface immediately while the server action runs; reconcile when
  // the parent prop refreshes via `revalidatePath('/')`. The original
  // implementation waited for full RSC re-render (1〜3s on no-store
  // character-sheets fetch), making the popover feel sluggish.
  const [optimisticAdds, setOptimisticAdds] = useState<SessionLogEntry[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Reconcile against the authoritative `sessionLogs` prop whenever it
  // changes: drop optimistic adds whose URL is now in the canonical
  // list, and drop pending deletes whose id is no longer present
  // (= the server side has confirmed the delete).
  useEffect(() => {
    setOptimisticAdds((prev) =>
      prev.filter((entry) => !sessionLogs.some((s) => s.url === entry.url)),
    );
    setPendingDeletes((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (sessionLogs.some((s) => s.id === id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
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
    // Duplicate guard up-front so we don't show an optimistic row that
    // we know the server will reject (UNIQUE constraint).
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
    const r = await addSessionLogsUrl(rawDate, value, sessionDetails);
    setLogsBusy(false);
    if (!r.ok) {
      // Rollback: remove the optimistic row and restore the input so
      // the user can edit and retry.
      setOptimisticAdds((prev) => prev.filter((e) => e.id !== tempId));
      setNewLogsInput(value);
      toast.error("Logs URL 追加失敗: " + r.reason);
      return;
    }
    // 2026-07-12: 同日の動画へ橋渡しされた件数を toast に出す (動画カード
    // の FFLogs バッジに即反映されることを実機で確認しやすくする)。
    toast.success(
      r.bridgedVideos
        ? `Logs URL を追加しました (同日の動画 ${r.bridgedVideos} 件にバッジ表示)`
        : "Logs URL を追加しました",
    );
    // Reconciliation happens when `sessionLogs` prop updates from the
    // server's `revalidatePath('/')` re-render — the useEffect above
    // drops the matching optimistic row.
  };

  const handleDeleteLogs = async (id: string) => {
    // Optimistic-only row (still pending insert): just remove locally.
    if (id.startsWith("__optimistic-")) {
      setOptimisticAdds((prev) => prev.filter((e) => e.id !== id));
      return;
    }
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setLogsBusy(true);
    const r = await deleteSessionLogsUrl(id);
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

  // Compose state for adding a new memo. Author name initialized
  // from localStorage so returning users don't retype their name.
  const [draftBody, setDraftBody] = useState("");
  const [draftAuthor, setDraftAuthor] = useState("");
  useEffect(() => {
    setDraftAuthor(getStoredAuthorName());
  }, []);

  const submitDraft = async () => {
    const body = draftBody.trim();
    const authorName = draftAuthor.trim();
    if (!body) {
      toast.error("メモ本文を入力してください");
      return;
    }
    setBusy(true);
    const result = await createScheduleMemo({ rawDate, body, authorName });
    setBusy(false);
    if (!result.ok) {
      toast.error("追加失敗: " + result.reason);
      return;
    }
    persistAuthorName(authorName);
    setDraftBody("");
    toast.success("メモを追加しました");
    // Defense-in-depth: realtime should also fire, but force-refresh
    // immediately so the UI is correct even when realtime delivery
    // fails / is delayed.
    if (onRefresh) void onRefresh();
  };

  const startEdit = (m: ScheduleSessionMemo) => {
    setEditingId(m.id);
    setEditingBody(m.body);
    setEditingAuthor(m.authorName);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody("");
    setEditingAuthor("");
  };
  const saveEdit = async (id: string) => {
    const body = editingBody.trim();
    const authorName = editingAuthor.trim();
    if (!body) {
      toast.error("本文を入力してください");
      return;
    }
    setBusy(true);
    const result = await updateScheduleMemo(id, { body, authorName });
    setBusy(false);
    if (!result.ok) {
      toast.error("更新失敗: " + result.reason);
      return;
    }
    cancelEdit();
    toast.success("更新しました");
    if (onRefresh) void onRefresh();
  };
  const requestDelete = (m: ScheduleSessionMemo) => setPendingDelete(m);
  const cancelDelete = () => setPendingDelete(null);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const m = pendingDelete;
    setBusy(true);
    const result = await deleteScheduleMemo(m.id);
    setBusy(false);
    setPendingDelete(null);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
    // Critical for DELETE — realtime DELETE events may be missing
    // `old.raw_date` if the table lacks REPLICA IDENTITY FULL, which
    // means the realtime handler can't tell the deletion was for our
    // date. Force-refresh guarantees the UI updates regardless.
    if (onRefresh) void onRefresh();
  };

  // Shared input styling — consistent focus ring + neutral border so
  // every input/textarea looks like one control family.
  const inputClass =
    "rounded-md border border-input/70 bg-background/40 px-2.5 py-1.5 text-[12px] leading-relaxed transition-colors focus:border-[var(--neon-violet)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--neon-violet)]/30";

  return (
    <div className="flex flex-col gap-2.5">
      {memos.length === 0 ? (
        <p className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border/40 bg-secondary/10 px-3 py-3 text-center text-[11px] text-muted-foreground">
          <MessageSquare className="h-3 w-3 opacity-60" aria-hidden />
          まだメモはありません
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pr-0.5">
          {memos.map((m) => (
            <li
              key={m.id}
              className="group rounded-md border border-border/40 bg-secondary/15 px-2.5 py-2 transition-colors hover:border-[var(--neon-violet)]/30 hover:bg-secondary/25"
            >
              {editingId === m.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={editingAuthor}
                    onChange={(e) => setEditingAuthor(e.target.value)}
                    placeholder="名前（任意）"
                    aria-label="投稿者名"
                    spellCheck={false}
                    maxLength={MEMO_AUTHOR_NAME_MAX}
                    className={inputClass}
                  />
                  <textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    aria-label="メモ本文"
                    spellCheck={false}
                    maxLength={MEMO_BODY_MAX}
                    className={inputClass}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] tracking-normal text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(m.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/10 px-2.5 py-1.5 text-[10px] tracking-normal text-[var(--neon-cyan)] transition-colors hover:border-[var(--neon-cyan)]/70 hover:bg-[var(--neon-cyan)]/18 disabled:opacity-50"
                    >
                      <Save className="h-3 w-3" aria-hidden />
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground/85">
                        {m.authorName || (
                          <span className="text-muted-foreground/70">
                            匿名
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[9px] tracking-wide text-muted-foreground/65">
                        {formatRelativeTime(m.createdAt)}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        aria-label="編集"
                        title="編集"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(m)}
                        aria-label="削除"
                        title="削除"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-200"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                    {m.body}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        <div className="flex items-center gap-1.5 text-[10px] tracking-normal text-muted-foreground">
          <MessageSquarePlus
            className="h-3 w-3 text-[var(--neon-violet)]/80"
            aria-hidden
          />
          新規メモ
        </div>
        <input
          value={draftAuthor}
          onChange={(e) => setDraftAuthor(e.target.value)}
          placeholder="名前（任意・次回も使用）"
          aria-label="投稿者名"
          spellCheck={false}
          maxLength={MEMO_AUTHOR_NAME_MAX}
          className={inputClass}
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={3}
          placeholder="メモ内容…"
          aria-label="メモ本文"
          spellCheck={false}
          maxLength={MEMO_BODY_MAX}
          className={inputClass}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitDraft}
            disabled={busy || draftBody.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--neon-violet)]/50 bg-[var(--neon-violet)]/10 px-3 py-1.5 text-[10px] tracking-normal text-[var(--neon-violet)] transition-colors hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/18 disabled:opacity-50"
          >
            <Send className="h-3 w-3" aria-hidden />
            投稿
          </button>
        </div>
      </div>

      {/* FFLogs URL editor — placed at the bottom of the popover so it
          doesn't compete with memo reading. TODO #64 (2.1, 2026-05-02
          part5): now backed by the `schedule_past_session_logs` child
          table so each date can hold multiple URLs. Existing rows are
          listed with open + × buttons (delete only, no edit-in-place),
          and a single input + 追加 button appends new manual entries. */}
      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          <BarChart3
            className="h-3 w-3 text-amber-300/85"
            aria-hidden
          />
          FFLogs URL
          {displayedLogs.length > 0 && (
            <span
              aria-hidden
              className="font-mono text-[10px] tracking-[0.18em] text-amber-300/70"
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
            aria-label="FFLogs URL"
            type="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            className={inputClass + " flex-1"}
          />
          <button
            type="button"
            onClick={() => void handleAddLogs()}
            disabled={logsBusy || newLogsInput.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/45 bg-amber-400/10 px-3 py-1.5 text-[10px] tracking-normal text-amber-200 transition-colors hover:border-amber-400/70 hover:bg-amber-400/18 disabled:opacity-50"
          >
            <Save className="h-3 w-3" aria-hidden />
            追加
          </button>
        </div>
      </div>
      {/* Centered delete-confirmation modal. Portal'd to document.body
          so the parent popover's clipping / coordinate frame doesn't
          affect placement. `inset-0` + flex center → reliably centered
          regardless of scroll position. Replaces `window.confirm`
          which renders at the top of the viewport in some browsers. */}
      {pendingDelete &&
        typeof document !== "undefined" &&
        createPortal(
          <DeleteConfirmModal
            memo={pendingDelete}
            busy={busy}
            onCancel={cancelDelete}
            onConfirm={confirmDelete}
          />,
          document.body,
        )}
    </div>
  );
}

// DeleteConfirmModal は C-5 で
// `@/components/portal/schedule/session-memo-delete-modal` に、
// formatRelativeTime は `@/lib/schedule/time-formatters` に移動。
