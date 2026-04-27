"use client";

import { useEffect, useRef, useState } from "react";
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
  fetchScheduleMemosByDate,
  getStoredAuthorName,
  persistAuthorName,
  updateScheduleMemo,
  useRealtimeScheduleMemos,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";

/**
 * Click-on-date popover that lets any viewer leave shared memos for a
 * specific session. Memos persist server-side and live-sync via the
 * realtime hook so all logged-in viewers see updates immediately.
 *
 * Trigger is whatever the parent renders as `children` — typically
 * the date span/chip from the schedule. Clicking the trigger opens
 * the popover; clicking outside or pressing Esc closes it.
 *
 * Identity model
 * ---------------
 * The app has no auth system. The author-name field is informational
 * only — a returning user's name is remembered via localStorage so
 * they don't have to re-type each session. Any viewer can edit /
 * delete any memo (matches the "open RLS" trust model elsewhere).
 */

type Props = {
  rawDate: string;
  /** What date label to show in the popover header. */
  displayDate: string;
  children: React.ReactNode;
};

export function SessionMemoPopover({ rawDate, displayDate, children }: Props) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<ScheduleSessionMemo[]>([]);
  const memos = useRealtimeScheduleMemos(rawDate, initial);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  // Lazy-load memos when first opened. Realtime subscription takes
  // over after that for live updates.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const m = await fetchScheduleMemosByDate(rawDate);
      if (!cancelled) setInitial(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rawDate]);

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
    <span ref={wrapperRef} className="relative inline-flex">
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
        {/* Tiny indicator that memos exist for this date. Shown only
            when memos are present so empty dates stay quiet. */}
        {memos.length > 0 && (
          <span
            aria-hidden
            className="ml-0.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon-violet)] shadow-[0_0_6px_var(--neon-violet)]"
          />
        )}
      </button>
      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label={`${displayDate} のメモ`}
          className="glass-popup absolute left-0 top-full z-40 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-md border border-[var(--neon-violet)]/40 p-3 shadow-[0_8px_32px_-16px_var(--neon-violet)]"
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
          <MemoList rawDate={rawDate} memos={memos} />
        </div>
      )}
    </span>
  );
}

function MemoList({
  rawDate,
  memos,
}: {
  rawDate: string;
  memos: ScheduleSessionMemo[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingAuthor, setEditingAuthor] = useState("");
  const [busy, setBusy] = useState(false);

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
  };
  const onDelete = async (m: ScheduleSessionMemo) => {
    if (!window.confirm("このメモを削除しますか？")) return;
    const result = await deleteScheduleMemo(m.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success("削除しました");
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
                        onClick={() => onDelete(m)}
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

