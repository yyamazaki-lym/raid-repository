"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/portal/confirm-dialog";
import type { NativeScheduleRow } from "@/lib/schedule/native-admin-client";
import {
  DEFAULT_NATIVE_SCHEDULE_ID,
  MAX_NATIVE_SCHEDULES,
  NATIVE_SCHEDULE_NAME_MAX,
} from "@/lib/schedule/settings-keys";
import {
  createNativeScheduleAction,
  deleteNativeScheduleAction,
  renameNativeScheduleAction,
  selectNativeScheduleAction,
} from "@/lib/server/native-schedules-actions";
import { useMessages } from "@/lib/i18n/client";

/**
 * 自前スケジュール (native) の一覧と切替 (2026-09-18 段階 1)。
 *
 * 同期式の `ScheduleSourceSection` と対になる節。違いは実体が外部 URL では
 * なく `native_schedules` テーブルの行であることだけで、「一覧を持ち、
 * ラジオで表示中を選ぶ」という操作は揃えてある。
 *
 * 段階 1 の切り分けを `description` で明示する: **予定と出欠だけ**が
 * スケジュール別で、メンバー・既定時刻・定期枠・凡例・日付メモは共通。
 * これを書いておかないと「別PTを作ったのにメンバーが同じ」ことに驚く。
 *
 * 一覧と表示中は親 (settings-dialog) が `adminAux` としてまとめて取得済み
 * のものを受け取り、変更後は `onChanged` で再取得させる (他の native 節と
 * 同じ流儀)。
 */
export function NativeSchedulesSection({
  canEdit,
  schedules,
  activeScheduleId,
  loaded,
  onChanged,
}: {
  canEdit: boolean;
  schedules: NativeScheduleRow[];
  activeScheduleId: string;
  loaded: boolean;
  onChanged: () => void;
}) {
  const m = useMessages();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // 一覧が入れ替わって編集中の行が消えたら、編集 UI も出さない。effect で
  // state を畳むのではなく **描画時に導出**する (state の同期を増やさない)。
  const editingRowId =
    editingId && schedules.some((s) => s.id === editingId) ? editingId : null;

  const onAdd = () => {
    const name = newName.trim();
    if (!name) {
      setFieldError(m.nativeSchedules.nameRequired);
      return;
    }
    if (schedules.length >= MAX_NATIVE_SCHEDULES) {
      setFieldError(m.nativeSchedules.limitReached(MAX_NATIVE_SCHEDULES));
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      const r = await createNativeScheduleAction(name);
      if (!r.ok) {
        setFieldError(r.reason);
        return;
      }
      setNewName("");
      onChanged();
      toast.success(m.nativeSchedules.toastAdded);
    });
  };

  const onSelect = (row: NativeScheduleRow) => {
    if (row.id === activeScheduleId) return;
    startTransition(async () => {
      const r = await selectNativeScheduleAction(row.id);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      onChanged();
      toast.success(m.nativeSchedules.toastSwitched(row.name));
      router.refresh();
    });
  };

  const onCommitRename = (row: NativeScheduleRow) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === row.name) return;
    startTransition(async () => {
      const r = await renameNativeScheduleAction(row.id, name);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      onChanged();
      toast.success(m.nativeSchedules.toastRenamed);
      router.refresh();
    });
  };

  const onRemove = async (row: NativeScheduleRow) => {
    if (row.id === activeScheduleId) {
      toast.error(m.nativeSchedules.activeCannotRemove);
      return;
    }
    if (row.id === DEFAULT_NATIVE_SCHEDULE_ID) {
      toast.error(m.nativeSchedules.defaultCannotRemove);
      return;
    }
    if (
      !(await confirm({
        title: m.nativeSchedules.removeConfirmTitle,
        description: m.nativeSchedules.removeConfirmDescription(row.name),
        confirmText: m.nativeSchedules.removeConfirmButton,
      }))
    )
      return;
    startTransition(async () => {
      const r = await deleteNativeScheduleAction(row.id);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      onChanged();
      toast.success(m.nativeSchedules.toastRemoved);
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <CalendarDays
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
        <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Schedules
        </span>
      </header>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {m.nativeSchedules.description}
      </p>

      {!loaded && (
        <p className="text-[11px] text-muted-foreground/70">
          {m.nativeSchedules.loading}
        </p>
      )}

      {loaded && schedules.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {schedules.map((row) => {
            const isActive = row.id === activeScheduleId;
            return (
              <li
                key={row.id}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                  isActive
                    ? "border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/5"
                    : "border-border/40 bg-background/20"
                }`}
              >
                <input
                  type="radio"
                  name="native-schedule-active"
                  className="h-3 w-3 shrink-0 accent-[var(--neon-cyan)]"
                  checked={isActive}
                  disabled={!canEdit || pending}
                  onChange={() => onSelect(row)}
                  aria-label={m.nativeSchedules.useThis(row.name)}
                />
                {editingRowId === row.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCommitRename(row);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 min-w-0 text-[12px]"
                      maxLength={NATIVE_SCHEDULE_NAME_MAX}
                      aria-label={m.nativeSchedules.renameLabel}
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => onCommitRename(row)}
                      title={m.nativeSchedules.renameSave}
                      aria-label={m.nativeSchedules.renameSave}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setEditingId(null)}
                      title={m.nativeSchedules.renameCancel}
                      aria-label={m.nativeSchedules.renameCancel}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-[12px] text-foreground/90">
                      {row.name}
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-sm border border-[var(--neon-cyan)]/40 px-1 py-px font-mono text-[11px] tracking-[0.12em] text-[var(--neon-cyan)]/90 uppercase">
                        {m.nativeSchedules.activeBadge}
                      </span>
                    )}
                  </span>
                )}
                {canEdit && editingRowId !== row.id && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={pending}
                      onClick={() => {
                        setEditingId(row.id);
                        setEditingName(row.name);
                      }}
                      title={m.nativeSchedules.renameLabel}
                      aria-label={m.nativeSchedules.renameLabel}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={
                        pending ||
                        isActive ||
                        row.id === DEFAULT_NATIVE_SCHEDULE_ID
                      }
                      onClick={() => void onRemove(row)}
                      title={
                        isActive
                          ? m.nativeSchedules.activeCannotRemove
                          : row.id === DEFAULT_NATIVE_SCHEDULE_ID
                            ? m.nativeSchedules.defaultCannotRemove
                            : m.nativeSchedules.removeLabel
                      }
                      aria-label={m.nativeSchedules.removeLabel}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="native-schedule-name"
            className="text-xs text-foreground/80"
          >
            {m.nativeSchedules.addLabel}
          </Label>
          <div className="flex items-start gap-2">
            <Input
              id="native-schedule-name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAdd();
                }
              }}
              maxLength={NATIVE_SCHEDULE_NAME_MAX}
              placeholder={m.nativeSchedules.namePlaceholder}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={
                fieldError ? "native-schedule-name-error" : undefined
              }
              className="min-w-0 text-[12px]"
              disabled={pending}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0 gap-1.5 text-[11px] tracking-normal"
              onClick={onAdd}
              disabled={pending || !newName.trim()}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden />
              )}
              {m.nativeSchedules.addButton}
            </Button>
          </div>
          {fieldError && (
            <p
              id="native-schedule-name-error"
              role="alert"
              className="text-destructive text-[11px] leading-relaxed"
            >
              {fieldError}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            {m.nativeSchedules.deleteHint}
          </p>
        </div>
      )}
    </section>
  );
}
