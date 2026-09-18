"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/portal/confirm-dialog";
import {
  getRegisteredSchedulesFromDb,
  getScheduleUrlFromDb,
} from "@/lib/schedule-url-store";
import {
  MAX_REGISTERED_SCHEDULES,
  newScheduleId,
  scheduleFallbackLabel,
  withActiveSchedule,
  type RegisteredSchedule,
} from "@/lib/schedule/registered-schedules";
import {
  fetchScheduleNameAction,
  saveRegisteredSchedulesAction,
  selectScheduleUrlAction,
} from "@/lib/server/categories-actions";
import { httpUrlError } from "@/lib/url-validation";
import { useMessages } from "@/lib/i18n/client";

/**
 * 同期式 (character-sheets / デイコード) スケジュールの登録と切替。
 *
 * TODO #66 (2026-05-02) で settings-dialog.tsx から切り出した節。
 * 2026-09-18 実機要望で **複数登録 + 切替 + 名前表示**に作り替えた:
 *
 * - 登録リストは `app_settings.schedule_urls`、表示中は従来どおり
 *   `app_settings.schedule_url` (形式は `registered-schedules.ts`)
 * - 名前は登録時に元ページの `<h1 id="title">` から自動取得し、取れない
 *   ときは URL の key を出す。鉛筆ボタンで手入力に上書きできる
 * - 保存はこの節の中で完結する即時保存 (mode 節と同じ)。親ダイアログの
 *   「保存」ボタンは Discord チャンネル ID 専用になった
 *
 * 切替が `schedule_url` の差し替えで済むのが設計の要で、TOP 描画・cron・
 * snapshot・Discord 通知は全てこのキーを読むため追加改修が要らない。
 */
export function ScheduleSourceSection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const m = useMessages();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [entries, setEntries] = useState<RegisteredSchedule[]>([]);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // 開いた時に一覧 + 表示中 URL を読む。旧構成 (schedule_url だけ) の固定
  // では一覧が空なので、表示中 URL を先頭に補って出す (DB へはこの時点で
  // は書かない — 開いただけで共有設定が変わらないように)。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [list, current] = await Promise.all([
        getRegisteredSchedulesFromDb(),
        getScheduleUrlFromDb(),
      ]);
      if (cancelled) return;
      setEntries(withActiveSchedule(list, current));
      setActiveUrl(current);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** 一覧を保存し、server が正規化した結果で state を置き換える。 */
  const persist = async (next: RegisteredSchedule[]): Promise<boolean> => {
    const result = await saveRegisteredSchedulesAction(next);
    if (!result.ok) {
      toast.error(result.reason);
      return false;
    }
    setEntries(result.list);
    return true;
  };

  const onAdd = () => {
    const url = newUrl.trim();
    const err = httpUrlError(url);
    if (!url || err) {
      setFieldError(err ?? m.scheduleSource.urlRequired);
      return;
    }
    if (entries.some((s) => s.url === url)) {
      setFieldError(m.scheduleSource.duplicate);
      return;
    }
    if (entries.length >= MAX_REGISTERED_SCHEDULES) {
      setFieldError(m.scheduleSource.limitReached(MAX_REGISTERED_SCHEDULES));
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      // 名前が取れなくても登録は進める (URL は正しいのに元サイトが一時的に
      // 落ちているだけ、ということがあるため)。「key が存在しない」と判定
      // できたときだけ登録前に止める。
      const named = await fetchScheduleNameAction(url);
      if (!named.ok && named.notFound) {
        setFieldError(named.reason);
        return;
      }
      const next: RegisteredSchedule[] = [
        ...entries,
        { id: newScheduleId(), url, name: named.ok ? named.name : null },
      ];
      if (!(await persist(next))) return;
      setNewUrl("");
      // 1 件目は自動で表示対象にする (登録しただけでは何も変わらないのは
      // 初回設定で分かりにくいため)。
      if (!activeUrl) {
        const selected = await selectScheduleUrlAction(url);
        if (selected.ok) {
          setActiveUrl(url);
          router.refresh();
        }
      }
      toast.success(m.scheduleSource.toastAdded);
    });
  };

  const onSelect = (entry: RegisteredSchedule) => {
    if (entry.url === activeUrl) return;
    startTransition(async () => {
      const result = await selectScheduleUrlAction(entry.url);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      setActiveUrl(entry.url);
      toast.success(
        m.scheduleSource.toastSwitched(
          entry.name ?? scheduleFallbackLabel(entry.url),
        ),
      );
      router.refresh();
    });
  };

  const onRemove = async (entry: RegisteredSchedule) => {
    if (entry.url === activeUrl) {
      toast.error(m.scheduleSource.activeCannotRemove);
      return;
    }
    const label = entry.name ?? scheduleFallbackLabel(entry.url);
    if (
      !(await confirm({
        title: m.scheduleSource.removeConfirmTitle,
        description: m.scheduleSource.removeConfirmDescription(label),
        confirmText: m.scheduleSource.removeConfirmButton,
      }))
    )
      return;
    startTransition(async () => {
      if (!(await persist(entries.filter((s) => s.id !== entry.id)))) return;
      toast.success(m.scheduleSource.toastRemoved);
    });
  };

  const onRefetchName = (entry: RegisteredSchedule) => {
    startTransition(async () => {
      const named = await fetchScheduleNameAction(entry.url);
      if (!named.ok) {
        toast.error(named.reason);
        return;
      }
      if (!named.name) {
        toast.error(m.scheduleSource.nameNotFound);
        return;
      }
      const fetchedName = named.name;
      if (
        !(await persist(
          entries.map((s) =>
            s.id === entry.id ? { ...s, name: fetchedName } : s,
          ),
        ))
      )
        return;
      toast.success(m.scheduleSource.toastNameFetched(fetchedName));
    });
  };

  const onStartRename = (entry: RegisteredSchedule) => {
    setEditingId(entry.id);
    setEditingName(entry.name ?? "");
  };

  const onCommitRename = (entry: RegisteredSchedule) => {
    const name = editingName.trim();
    setEditingId(null);
    if ((entry.name ?? "") === name) return;
    startTransition(async () => {
      if (
        !(await persist(
          entries.map((s) =>
            s.id === entry.id ? { ...s, name: name || null } : s,
          ),
        ))
      )
        return;
      toast.success(m.scheduleSource.toastRenamed);
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
          Schedule Source
        </span>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-foreground/80">
            {m.scheduleSource.listLabel}
          </span>
          <a
            href="https://character-sheets.appspot.com/schedule/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--neon-cyan)]"
            title={m.scheduleSource.openSiteTitle}
          >
            <Calendar className="h-2.5 w-2.5" aria-hidden />
            {m.scheduleSource.openSite}
          </a>
        </div>

        {!loaded && (
          <p className="text-muted-foreground/70 text-[12px]">
            {m.scheduleSource.loading}
          </p>
        )}

        {loaded && entries.length === 0 && (
          <p className="text-muted-foreground/80 text-[12px] leading-relaxed">
            {m.scheduleSource.emptyHint}
          </p>
        )}

        {loaded && entries.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {entries.map((entry) => {
              const isActive = entry.url === activeUrl;
              const label = entry.name ?? scheduleFallbackLabel(entry.url);
              return (
                <li
                  key={entry.id}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                    isActive
                      ? "border-[var(--neon-cyan)]/45 bg-[var(--neon-cyan)]/5"
                      : "border-border/40 bg-background/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-source-active"
                    className="mt-1 h-3 w-3 shrink-0 accent-[var(--neon-cyan)]"
                    checked={isActive}
                    disabled={!canEdit || pending}
                    onChange={() => onSelect(entry)}
                    aria-label={m.scheduleSource.useThis(label)}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {editingId === entry.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onCommitRename(entry);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-7 text-[12px]"
                          maxLength={80}
                          aria-label={m.scheduleSource.renameLabel}
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => onCommitRename(entry)}
                          title={m.scheduleSource.renameSave}
                          aria-label={m.scheduleSource.renameSave}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setEditingId(null)}
                          title={m.scheduleSource.renameCancel}
                          aria-label={m.scheduleSource.renameCancel}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-[12px] ${
                            entry.name
                              ? "text-foreground/90"
                              : "text-muted-foreground/80 italic"
                          }`}
                        >
                          {entry.name ?? m.scheduleSource.unnamed}
                        </span>
                        {isActive && (
                          <span className="shrink-0 rounded-sm border border-[var(--neon-cyan)]/40 px-1 py-px font-mono text-[11px] tracking-[0.12em] text-[var(--neon-cyan)]/90 uppercase">
                            {m.scheduleSource.activeBadge}
                          </span>
                        )}
                      </div>
                    )}
                    <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                      {scheduleFallbackLabel(entry.url)}
                    </span>
                  </div>
                  {canEdit && editingId !== entry.id && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={pending}
                        onClick={() => onStartRename(entry)}
                        title={m.scheduleSource.renameLabel}
                        aria-label={m.scheduleSource.renameLabel}
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={pending}
                        onClick={() => onRefetchName(entry)}
                        title={m.scheduleSource.refetchName}
                        aria-label={m.scheduleSource.refetchName}
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={pending || isActive}
                        onClick={() => void onRemove(entry)}
                        title={
                          isActive
                            ? m.scheduleSource.activeCannotRemove
                            : m.scheduleSource.removeLabel
                        }
                        aria-label={m.scheduleSource.removeLabel}
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
          <div className="flex flex-col gap-1.5 pt-1">
            <Label htmlFor="schedule-url" className="text-xs text-foreground/80">
              {m.scheduleSource.urlLabel}
            </Label>
            <div className="flex items-start gap-2">
              <Input
                id="schedule-url"
                type="url"
                inputMode="url"
                value={newUrl}
                onChange={(e) => {
                  setNewUrl(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                onBlur={() => setFieldError(httpUrlError(newUrl))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                  }
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "schedule-url-error" : undefined}
                placeholder="https://character-sheets.appspot.com/schedule/list?key=..."
                // min-w-0: flex 子の既定 min-width:auto だと placeholder の
                // 長さぶん縮まず、ダイアログが横スクロールする (実測)。
                className="min-w-0 font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0 gap-1.5 text-[11px] tracking-normal"
                onClick={onAdd}
                disabled={pending || !newUrl.trim()}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                {m.scheduleSource.addButton}
              </Button>
            </div>
            {fieldError && (
              <p
                id="schedule-url-error"
                role="alert"
                className="text-destructive text-[11px] leading-relaxed"
              >
                {fieldError}
              </p>
            )}
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.scheduleSource.formatBefore}{" "}
              <code className="font-mono">schedule/list?key=…</code>{" "}
              {m.scheduleSource.formatAfter}
            </p>
          </div>
        )}

        <details className="group/help">
          <summary className="cursor-pointer text-[12px] text-muted-foreground/80 transition-colors hover:text-foreground/90 list-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1">
              <span className="text-[var(--neon-cyan)]/70 transition-transform group-open/help:rotate-90">
                ▸
              </span>
              {m.scheduleSource.helpSummary}
            </span>
          </summary>
          <ol className="mt-1.5 ml-3.5 flex list-decimal flex-col gap-0.5 text-[12px] text-muted-foreground/80 leading-relaxed">
            <li>
              <a
                href="https://character-sheets.appspot.com/schedule/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 hover:text-[var(--neon-cyan)]"
              >
                character-sheets.appspot.com/schedule/
              </a>
              {" "}{m.scheduleSource.step1Suffix}
            </li>
            <li>{m.scheduleSource.step2}</li>
            <li>
              {m.scheduleSource.step3Before}
              <code className="font-mono">/schedule/list?key=…</code>
              {" "}{m.scheduleSource.step3After}
            </li>
            <li>{m.scheduleSource.step4}</li>
          </ol>
        </details>
        <p className="text-muted-foreground/80 text-[12px] leading-relaxed">
          {m.scheduleSource.delayBefore}{" "}
          <strong>{m.scheduleSource.delayStrong}</strong>{" "}
          {m.scheduleSource.delayAfter}
        </p>
      </div>
    </section>
  );
}
