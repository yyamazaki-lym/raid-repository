"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  persistAuthorName,
  updateScheduleMemo,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import { setSessionLogsUrl } from "@/lib/server/categories-actions";

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
   * Currently-set FFLogs URL for this date (from `schedule_past_sessions
   * .logs_url` OR a matching video's `logs_url`). Used to pre-fill the
   * manual-entry input — the API's v1 endpoint only returns Public
   * reports, so Unlisted / Private logs need to be bound by hand.
   */
  currentLogsUrl?: string | null;
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
};

/**
 * Imperative handle exposed via `forwardRef` so siblings (e.g. the
 * memo-count dot rendered outside this component's wrapper) can open
 * the popover without lifting state into the parent. Keeps the
 * popover self-contained while still allowing remote triggers.
 */
export type SessionMemoPopoverHandle = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

export const SessionMemoPopover = forwardRef<
  SessionMemoPopoverHandle,
  Props
>(function SessionMemoPopover(
  {
    rawDate,
    displayDate,
    memos,
    onRefresh,
    currentLogsUrl,
    sessionDetails,
    children,
  },
  handleRef,
) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(
    handleRef,
    () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
    }),
    [],
  );
  const popupRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

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
      const popupWidth = Math.min(
        448,
        document.documentElement.clientWidth - 32,
      );
      const left = Math.max(
        16,
        Math.min(
          rect.left,
          document.documentElement.clientWidth - popupWidth - 16,
        ),
      );
      const top = rect.bottom + 4;
      setCoords({ top, left });
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

  return (
    <span ref={wrapperRef} className="inline-flex">
      <button
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
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: "min(28rem,calc(100vw - 2rem))",
              // Cap height so the popup never extends past the
              // bottom of the viewport. Inner sections handle their
              // own scrolling, and the popup body itself can also
              // scroll when content (form + lots of memos) exceeds
              // this cap.
              maxHeight: `calc(100vh - ${coords.top + 16}px)`,
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
                currentLogsUrl={currentLogsUrl ?? null}
                sessionDetails={sessionDetails}
              />
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
});

/**
 * Tiny purple dot indicator. Parent renders this wherever it wants
 * (e.g. trailing the time text rather than the date), so the visual
 * cue and the click-to-edit affordance can sit in different spots.
 *
 * When given an `onClick`, renders as a button — typically wired to
 * `popoverRef.current?.open()` so clicking the dot opens the same
 * popover that the date label opens. The button gets a hit-target
 * larger than the visual dot (extra padding) so taps work on touch.
 */
export function SessionMemoDot({
  count,
  className = "",
  onClick,
}: {
  count: number;
  className?: string;
  onClick?: () => void;
}) {
  if (count <= 0) return null;
  const dotClass =
    "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon-violet)] shadow-[0_0_6px_var(--neon-violet)] transition-shadow";
  if (!onClick) {
    return (
      <span
        aria-label={`メモ ${count} 件`}
        title={`メモ ${count} 件`}
        className={`inline-flex items-center ${dotClass} ${className}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`メモ ${count} 件 を開く`}
      title={`メモ ${count} 件（クリックで開く）`}
      className={
        "group/memodot inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--neon-violet)]/18 " +
        className
      }
    >
      <span
        aria-hidden
        className={`${dotClass} group-hover/memodot:shadow-[0_0_10px_var(--neon-violet)]`}
      />
    </button>
  );
}

function MemoList({
  rawDate,
  memos,
  onRefresh,
  currentLogsUrl,
  sessionDetails,
}: {
  rawDate: string;
  memos: ScheduleSessionMemo[];
  onRefresh?: () => Promise<void>;
  currentLogsUrl: string | null;
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
  // FFLogs URL editor state. Pre-filled from prop so users see the
  // currently-bound URL on open. Editable in-place; save / clear
  // buttons commit via the server action.
  const [logsUrlInput, setLogsUrlInput] = useState(currentLogsUrl ?? "");
  const [logsBusy, setLogsBusy] = useState(false);
  // Re-sync local input when the prop changes (e.g. another tab edited
  // it, or after our own save returns and parent re-fetches).
  useEffect(() => {
    setLogsUrlInput(currentLogsUrl ?? "");
  }, [currentLogsUrl]);

  const saveLogsUrl = async (next: string | null) => {
    setLogsBusy(true);
    const r = await setSessionLogsUrl(rawDate, next, sessionDetails);
    setLogsBusy(false);
    if (!r.ok) {
      toast.error("Logs URL 保存失敗: " + r.reason);
      return;
    }
    toast.success(next ? "Logs URL を保存しました" : "Logs URL をクリアしました");
    // Page-level state (sessionLogsByDate map) only refreshes via
    // server revalidation. The action calls `revalidatePath('/')`
    // which re-renders the schedule on the next nav/click. Local
    // input stays in sync via the useEffect above when the prop
    // updates after refresh.
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
                    spellCheck={false}
                    className={inputClass}
                  />
                  <textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    className={inputClass}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(m.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/10 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase transition-colors hover:border-[var(--neon-cyan)]/70 hover:bg-[var(--neon-cyan)]/18 disabled:opacity-50"
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

      {/* FFLogs URL editor. The v1 API only returns Public reports,
          so Unlisted / Private logs need to be bound here by hand.
          Position: between memos and new-memo form, so it's
          visible without scrolling but doesn't crowd the memo
          reading area. */}
      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
            <BarChart3
              className="h-3 w-3 text-amber-300/85"
              aria-hidden
            />
            FFLogs URL
          </div>
          {currentLogsUrl && (
            <a
              href={currentLogsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-amber-300/85 underline decoration-dotted underline-offset-2 hover:text-amber-300"
              title="現在の URL を新タブで開く"
            >
              <ExternalLink className="h-2.5 w-2.5" aria-hidden />
              現在の URL を開く
            </a>
          )}
        </div>
        <input
          value={logsUrlInput}
          onChange={(e) => setLogsUrlInput(e.target.value)}
          placeholder="https://www.fflogs.com/reports/abc123..."
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          className={inputClass}
        />
        <div className="flex justify-end gap-1.5">
          {currentLogsUrl && (
            <button
              type="button"
              onClick={() => {
                setLogsUrlInput("");
                void saveLogsUrl(null);
              }}
              disabled={logsBusy}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:bg-secondary/60 hover:text-rose-200 disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
              クリア
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveLogsUrl(logsUrlInput.trim() || null)}
            disabled={
              logsBusy ||
              logsUrlInput.trim() === (currentLogsUrl ?? "").trim()
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/45 bg-amber-400/10 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-amber-200 uppercase transition-colors hover:border-amber-400/70 hover:bg-amber-400/18 disabled:opacity-50"
          >
            <Save className="h-3 w-3" aria-hidden />
            保存
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
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
          spellCheck={false}
          className={inputClass}
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={3}
          placeholder="メモ内容…"
          spellCheck={false}
          className={inputClass}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitDraft}
            disabled={busy || draftBody.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--neon-violet)]/50 bg-[var(--neon-violet)]/10 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-[var(--neon-violet)] uppercase transition-colors hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/18 disabled:opacity-50"
          >
            <Send className="h-3 w-3" aria-hidden />
            投稿
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

/**
 * Centered modal asking the user to confirm a memo deletion. Esc to
 * cancel, click-on-backdrop to cancel. Stops mousedown propagation on
 * the panel itself so the parent popover's outside-click handler
 * doesn't close the popover behind the modal.
 */
function DeleteConfirmModal({
  memo,
  busy,
  onCancel,
  onConfirm,
}: {
  memo: ScheduleSessionMemo;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Truncate the memo body for the prompt — long memos shouldn't blow
  // out the modal, but a short preview confirms which one is being
  // deleted. 120 chars is enough for context without dominating.
  const preview =
    memo.body.length > 120 ? memo.body.slice(0, 120) + "…" : memo.body;

  return (
    // Transparent click-catcher — keeps the rest of the page fully
    // visible (no dim / blur), but still allows click-outside to
    // cancel and prevents accidental interaction with content
    // underneath while the dialog is up.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="メモ削除の確認"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="glass-popup w-full max-w-sm rounded-lg border border-rose-400/55 shadow-[0_16px_48px_-12px_rgba(244,63,94,0.4),0_4px_16px_-4px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2 rounded-t-lg border-b border-rose-400/25 bg-rose-500/10 px-4 py-2.5">
          <Trash2 className="h-3.5 w-3.5 text-rose-300" aria-hidden />
          <p className="font-mono text-[11px] tracking-[0.22em] text-rose-200 uppercase">
            メモを削除
          </p>
        </header>
        <div className="px-4 py-3">
          <p className="mb-2.5 rounded-md border border-border/40 bg-secondary/20 px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            {preview || (
              <span className="text-muted-foreground/70">（本文なし）</span>
            )}
          </p>
          <p className="mb-3 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              aria-hidden
              className="inline-block h-1 w-1 rounded-full bg-rose-400/70"
            />
            この操作は元に戻せません
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/55 bg-rose-500/15 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-rose-100 uppercase transition-colors hover:border-rose-400/80 hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick "5分前 / 2時間前 / 3日前 / YYYY-MM-DD" formatter for the memo
 * timestamp. Long-form date once it gets old enough that relative
 * units stop being meaningful.
 */
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.round(diffMs / 3_600_000);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.round(diffMs / 86_400_000);
  if (day < 7) return `${day}日前`;
  // Older — absolute date.
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}
