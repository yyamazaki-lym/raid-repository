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
  { rawDate, displayDate, memos, onRefresh, children },
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
  // opens, then reposition / close on scroll-resize since fixed
  // coords don't track the trigger automatically.
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
        Math.min(rect.left, document.documentElement.clientWidth - popupWidth - 16),
      );
      const top = rect.bottom + 4;
      setCoords({ top, left });
    };
    place();
    const onResize = () => place();
    const onScroll = () => setOpen(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
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
            }}
            className="glass-popup z-50 rounded-md border border-[var(--neon-violet)]/40 p-3 shadow-[0_8px_32px_-16px_var(--neon-violet)]"
          >
            <header className="mb-2 flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] tracking-[0.2em] text-[var(--neon-violet)]/90 uppercase">
                {displayDate} のメモ
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </header>
            <MemoList
              rawDate={rawDate}
              memos={memos}
              onRefresh={onRefresh}
            />
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
    "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon-violet)] shadow-[0_0_6px_var(--neon-violet)]";
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
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--neon-violet)]/15 " +
        className
      }
    >
      <span aria-hidden className={dotClass} />
    </button>
  );
}

function MemoList({
  rawDate,
  memos,
  onRefresh,
}: {
  rawDate: string;
  memos: ScheduleSessionMemo[];
  onRefresh?: () => Promise<void>;
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

  return (
    <div className="flex flex-col gap-2">
      {memos.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border/40 px-3 py-2 text-center text-[11px] text-muted-foreground">
          まだメモはありません — 下のフォームから追加できます
        </p>
      ) : (
        <ul className="flex max-h-[16rem] flex-col gap-1.5 overflow-y-auto">
          {memos.map((m) => (
            <li
              key={m.id}
              className="rounded-sm border border-border/40 bg-secondary/20 px-2 py-1.5"
            >
              {editingId === m.id ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={editingAuthor}
                    onChange={(e) => setEditingAuthor(e.target.value)}
                    placeholder="名前（任意）"
                    spellCheck={false}
                    className="rounded border border-input bg-background/30 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--neon-violet)]/40"
                  />
                  <textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    className="rounded border border-input bg-background/30 px-2 py-1 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--neon-violet)]/40"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:bg-secondary/60"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(m.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded border border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/10 px-2 py-1 font-mono text-[10px] tracking-widest text-[var(--neon-cyan)] uppercase hover:bg-[var(--neon-cyan)]/15"
                    >
                      <Save className="h-3 w-3" aria-hidden />
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      {m.authorName || "（匿名）"}
                      <span className="ml-1.5 text-[9px] opacity-70">
                        {formatRelativeTime(m.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        aria-label="編集"
                        title="編集"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(m)}
                        aria-label="削除"
                        title="削除"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
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

      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2">
        <div className="flex items-center gap-1 text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          <MessageSquarePlus className="h-3 w-3" aria-hidden />
          新しいメモ
        </div>
        <input
          value={draftAuthor}
          onChange={(e) => setDraftAuthor(e.target.value)}
          placeholder="名前（任意・次回も使用）"
          spellCheck={false}
          className="rounded border border-input bg-background/30 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--neon-violet)]/40"
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={3}
          placeholder="メモ内容…"
          spellCheck={false}
          className="rounded border border-input bg-background/30 px-2 py-1 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--neon-violet)]/40"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submitDraft}
            disabled={busy || draftBody.trim().length === 0}
            className="inline-flex items-center gap-1 rounded border border-[var(--neon-violet)]/50 bg-[var(--neon-violet)]/10 px-2 py-1 font-mono text-[10px] tracking-widest text-[var(--neon-violet)] uppercase transition-colors hover:bg-[var(--neon-violet)]/15 disabled:opacity-60"
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="メモ削除の確認"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Click on backdrop = cancel. Stop here so the parent popover
        // doesn't also close on the same click.
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="glass-popup w-full max-w-sm rounded-md border border-rose-400/45 p-4 shadow-[0_8px_32px_-12px_rgba(244,63,94,0.55)]"
      >
        <header className="mb-2 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-rose-300" aria-hidden />
          <p className="font-mono text-[11px] tracking-[0.22em] text-rose-300 uppercase">
            メモを削除しますか？
          </p>
        </header>
        <p className="mb-3 rounded-sm border border-border/40 bg-secondary/20 px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
          {preview || "（本文なし）"}
        </p>
        <p className="mb-3 text-[10px] text-muted-foreground">
          削除すると元に戻せません。
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-border/50 px-3 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-rose-400/60 bg-rose-500/15 px-3 py-1.5 font-mono text-[10px] tracking-widest text-rose-200 uppercase transition-colors hover:bg-rose-500/25 disabled:opacity-60"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            削除
          </button>
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
