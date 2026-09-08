"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getMaintenanceWindowsAction,
  setMaintenanceWindowsAction,
} from "@/lib/server/maintenance-actions";
import {
  MAINTENANCE_MAX_WINDOWS,
  formatMaintenanceRange,
  type MaintenanceWindow,
} from "@/lib/maintenance-schedule";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { CollapsibleSection } from "./collapsible-section";

/**
 * 公式メンテ / パッチ日程の登録 (W-30、2026-09-07)。
 *
 * 「今夜メンテだった」を防ぐための手入力。`<input type="datetime-local">`
 * の値は `YYYY-MM-DDTHH:mm` で、そのまま保存形式と一致する (パースを
 * 自作しない)。
 *
 * 登録すると、活動予定と時間帯が重なる場合に次回開催カードへ警告が出る。
 */
export function MaintenanceSection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<MaintenanceWindow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getMaintenanceWindowsAction().then((r) => {
      if (cancelled) return;
      setLoaded(true);
      if (r.ok) setRows(r.windows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const patch = (i: number, next: Partial<MaintenanceWindow>) => {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
    setDirty(true);
  };

  const add = () => {
    if (rows.length >= MAINTENANCE_MAX_WINDOWS) {
      toast.error(m.maintenanceSchedule.tooMany(MAINTENANCE_MAX_WINDOWS));
      return;
    }
    setRows((cur) => [...cur, { start: "", end: "", label: "" }]);
    setDirty(true);
  };

  const remove = (i: number) => {
    setRows((cur) => cur.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const save = () => {
    startTransition(async () => {
      const r = await setMaintenanceWindowsAction(rows);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      setDirty(false);
      toast.success(m.maintenanceSchedule.saved);
      router.refresh();
    });
  };

  return (
    <CollapsibleSection
      id="maintenance"
      icon={<Wrench className="h-3.5 w-3.5 text-orange-300" aria-hidden />}
      title={m.maintenanceSchedule.title}
    >
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.maintenanceSchedule.description}
      </p>

      {!loaded ? (
        <p className="text-[11px] text-muted-foreground/80">{m.common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/80">
          {m.maintenanceSchedule.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-secondary/15 px-2.5 py-2 sm:flex-row sm:items-center"
            >
              <Input
                type="datetime-local"
                value={row.start}
                onChange={(e) => patch(i, { start: e.target.value })}
                disabled={pending}
                aria-label={m.maintenanceSchedule.startLabel}
                className="h-7 font-mono text-[11px] sm:w-44"
              />
              <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
                〜
              </span>
              <Input
                type="datetime-local"
                value={row.end}
                onChange={(e) => patch(i, { end: e.target.value })}
                disabled={pending}
                aria-label={m.maintenanceSchedule.endLabel}
                className="h-7 font-mono text-[11px] sm:w-44"
              />
              <Input
                type="text"
                value={row.label ?? ""}
                maxLength={60}
                onChange={(e) => patch(i, { label: e.target.value })}
                disabled={pending}
                aria-label={m.maintenanceSchedule.labelLabel}
                placeholder={m.maintenanceSchedule.labelPlaceholder}
                className="h-7 min-w-0 flex-1 text-[11px]"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={pending}
                aria-label={m.maintenanceSchedule.removeAria}
                className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 保存済みの内容を人が読める形で見せる (datetime-local は
          ブラウザ既定の書式で出るので、確認用に整形版も並べる)。 */}
      {loaded && rows.length > 0 && !dirty && (
        <p className="font-mono text-[12px] leading-relaxed text-muted-foreground/80">
          {rows
            .filter((r) => r.start && r.end)
            .map((r) => formatMaintenanceRange(r, locale))
            .join(" / ")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={pending || !loaded}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <Plus className="h-3 w-3" aria-hidden />
          {m.maintenanceSchedule.add}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={pending || !loaded || !dirty}
          className="gap-1.5 text-[11px] tracking-normal"
        >
          <Save className="h-3 w-3" aria-hidden />
          {m.common.save}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
