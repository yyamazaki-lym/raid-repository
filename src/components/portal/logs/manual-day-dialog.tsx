/**
 * 練習ログ: 手動の記録のダイアログ (2026-11-08)。
 *
 * ACT が使えず FFLogs にログが無い日の分を、日の要約 (区間ごとの pull・討伐・
 * 最良の残%、練習時間、メモ) で足す。何に入る / 入らないかは
 * `@/lib/practice-log-manual` の docstring。保存は admin だけ
 * (`practice-log-manual-actions.ts`)。
 *
 * 区間の選択肢は呼び出し側 (`logs-view.tsx`) が作る: 零式はログに出てきた層
 * (encounter)、絶は観測したフェーズ + 1 (手動の日に初めて着いたフェーズ)、
 * どちらも「不明」を含む。
 */
"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useMessages } from "@/lib/i18n/client";
import type { ManualDay } from "@/lib/practice-log-manual";
import { jstYmdString } from "@/lib/jst-date";
import {
  deleteManualPracticeDayAction,
  saveManualPracticeDayAction,
} from "@/lib/server/practice-log-manual-actions";

/** 区間の選択肢 1 つ。`key` は select の値。 */
export type ManualSegmentChoice = {
  key: string;
  label: string;
  encounterId: number | null;
  phase: number | null;
};

/** 「不明」の選択肢のキー。 */
export const UNKNOWN_SEGMENT_KEY = "-";

type DraftRow = { id: number; key: string; pulls: string; kills: string; best: string };

/** 編集中の手動の記録 (入力欄の文字列のまま持つ)。 */
export type ManualDayDraft = {
  /** 既存の記録の ID (null = 新しく足す)。 */
  id: string | null;
  date: string;
  rows: DraftRow[];
  minutes: string;
  note: string;
  /** 日付欄の上限 (JST の今日)。下書きを作るとき (イベントの中) に決める。 */
  maxDate: string;
};

let rowSeq = 0;
const newRow = (key: string): DraftRow => ({ id: ++rowSeq, key, pulls: "", kills: "", best: "" });

/** 新しい記録の下書き。区間は先頭の選択肢 (最深の区間) で 1 行。 */
export function newManualDraft(date: string, choices: ReadonlyArray<ManualSegmentChoice>): ManualDayDraft {
  return {
    id: null,
    date,
    rows: [newRow(choices[0]?.key ?? UNKNOWN_SEGMENT_KEY)],
    minutes: "",
    note: "",
    maxDate: jstYmdString(new Date()),
  };
}

/** 既存の記録を下書きに。選択肢に無い区間 (層の対応が変わった) は「不明」に落とす。 */
export function draftFromManualDay(
  day: ManualDay,
  choices: ReadonlyArray<ManualSegmentChoice>,
): ManualDayDraft {
  return {
    id: day.id,
    date: day.date,
    rows: day.segments.map((s) => {
      const choice = choices.find((c) => c.encounterId === s.encounterId && c.phase === s.phase);
      return {
        id: ++rowSeq,
        key: choice?.key ?? UNKNOWN_SEGMENT_KEY,
        pulls: String(s.pulls),
        kills: s.kills > 0 ? String(s.kills) : "",
        best: s.bestPercentage === null ? "" : String(s.bestPercentage),
      };
    }),
    minutes: day.logMinutes === null ? "" : String(day.logMinutes),
    note: day.note ?? "",
    maxDate: jstYmdString(new Date()),
  };
}

/** 空欄は null、数でなければ NaN。 */
function num(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export function ManualDayDialog({
  draft,
  categoryId,
  choices,
  segmentKind,
  onChange,
  onSaved,
}: {
  draft: ManualDayDraft | null;
  categoryId: string;
  /** 区間の選択肢 (「不明」を含む)。1 つだけなら区間の列を出さない。 */
  choices: ReadonlyArray<ManualSegmentChoice>;
  /** 区間の呼び名 (層 / フェーズ)。区間の無いコンテンツでは null。 */
  segmentKind: "floor" | "phase" | null;
  onChange: (next: ManualDayDraft | null) => void;
  onSaved: () => void;
}) {
  const m = useMessages();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const showSegments = choices.length > 1;
  const labelOf = (key: string) =>
    choices.find((c) => c.key === key)?.label ?? m.logsManual.segmentUnknown;

  const patchRow = (id: number, patch: Partial<DraftRow>) => {
    if (!draft) return;
    onChange({ ...draft, rows: draft.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  };
  const totalPulls = (draft?.rows ?? []).reduce((acc, r) => {
    const n = num(r.pulls);
    return acc + (n !== null && Number.isFinite(n) ? n : 0);
  }, 0);

  const save = async () => {
    if (!draft) return;
    const segments = [];
    for (const r of draft.rows) {
      const pulls = num(r.pulls);
      const kills = num(r.kills);
      const best = num(r.best);
      if ([pulls, kills, best].some((v) => v !== null && !Number.isFinite(v))) {
        toast.error(m.logsManual.errNumber);
        return;
      }
      // pull 数の空欄の行は捨てる (足しかけて使わなかった行)。
      if (pulls === null || pulls === 0) continue;
      const choice = choices.find((c) => c.key === r.key);
      segments.push({
        encounterId: choice?.encounterId ?? null,
        phase: choice?.phase ?? null,
        pulls,
        kills: kills ?? 0,
        bestPercentage: best,
      });
    }
    if (segments.length === 0) {
      toast.error(m.logsManual.errNoPulls);
      return;
    }
    const minutes = num(draft.minutes);
    if (minutes !== null && !Number.isFinite(minutes)) {
      toast.error(m.logsManual.errNumber);
      return;
    }
    setBusy(true);
    const r = await saveManualPracticeDayAction({
      id: draft.id,
      categoryId,
      date: draft.date,
      segments,
      logMinutes: minutes,
      note: draft.note,
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(m.logs.saveFailed(r.reason));
      return;
    }
    toast.success(m.logsManual.toastSaved);
    onSaved();
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await confirm({
      title: m.logsManual.deleteConfirmTitle(draft.date),
      description: m.logsManual.deleteConfirmDescription,
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await deleteManualPracticeDayAction({ id: draft.id, categoryId });
    setBusy(false);
    if (!r.ok) {
      toast.error(m.logs.saveFailed(r.reason));
      return;
    }
    toast.success(m.logsManual.toastDeleted);
    onSaved();
  };

  const segmentHeader =
    segmentKind === "floor"
      ? m.logsManual.segmentFloor
      : segmentKind === "phase"
        ? m.logsManual.segmentPhase
        : null;

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onChange(null);
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft?.id ? m.logsManual.titleEdit : m.logsManual.titleNew}</DialogTitle>
          <DialogDescription>{m.logsManual.desc}</DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-date">{m.logsManual.dateLabel}</Label>
              <Input
                id="manual-date"
                type="date"
                value={draft.date}
                max={draft.maxDate}
                onChange={(e) => onChange({ ...draft, date: e.target.value })}
                className="w-fit"
              />
            </div>
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">{m.logsManual.segmentsLabel}</legend>
              {/* 列の見出し。375px 幅でも 1 行に収まるよう、数の欄は固定幅。 */}
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground" aria-hidden>
                {showSegments && <span className="min-w-0 flex-1">{segmentHeader}</span>}
                <span className="w-14 text-right">{m.logsManual.pullsLabel}</span>
                <span className="w-12 text-right">{m.logsManual.killsLabel}</span>
                <span className="w-[4.25rem] text-right">{m.logsManual.bestLabel}</span>
                <span className="w-6" />
              </div>
              {draft.rows.map((r) => (
                <div key={r.id} className="flex items-center gap-1.5">
                  {showSegments && (
                    <select
                      value={r.key}
                      onChange={(e) => patchRow(r.id, { key: e.target.value })}
                      aria-label={segmentHeader ?? m.logsManual.segmentsLabel}
                      className="h-8 min-w-0 flex-1 rounded-sm border border-border/60 bg-background/60 px-1.5 text-[12px]"
                    >
                      {choices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <Input
                    inputMode="numeric"
                    value={r.pulls}
                    onChange={(e) => patchRow(r.id, { pulls: e.target.value })}
                    aria-label={`${labelOf(r.key)} ${m.logsManual.pullsLabel}`}
                    className="h-8 w-14 px-1.5 text-right font-mono text-[12px] tabular-nums"
                  />
                  <Input
                    inputMode="numeric"
                    value={r.kills}
                    placeholder="0"
                    onChange={(e) => patchRow(r.id, { kills: e.target.value })}
                    aria-label={`${labelOf(r.key)} ${m.logsManual.killsLabel}`}
                    className="h-8 w-12 px-1.5 text-right font-mono text-[12px] tabular-nums"
                  />
                  <Input
                    inputMode="decimal"
                    value={r.best}
                    placeholder={m.logsManual.bestPlaceholder}
                    onChange={(e) => patchRow(r.id, { best: e.target.value })}
                    aria-label={`${labelOf(r.key)} ${m.logsManual.bestLabel}`}
                    className="h-8 w-[4.25rem] px-1.5 text-right font-mono text-[12px] tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...draft, rows: draft.rows.filter((x) => x.id !== r.id) })
                    }
                    disabled={draft.rows.length <= 1}
                    aria-label={m.logsManual.removeSegment(labelOf(r.key))}
                    title={m.logsManual.removeSegment(labelOf(r.key))}
                    className="tap-target relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-rose-200 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                {showSegments ? (
                  <button
                    type="button"
                    onClick={() => {
                      // まだ使っていない区間を優先して足す。
                      const used = new Set(draft.rows.map((x) => x.key));
                      const next = choices.find((c) => !used.has(c.key)) ?? choices[0];
                      onChange({ ...draft, rows: [...draft.rows, newRow(next?.key ?? UNKNOWN_SEGMENT_KEY)] });
                    }}
                    disabled={draft.rows.length >= choices.length}
                    className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    {m.logsManual.addSegment}
                  </button>
                ) : (
                  <span />
                )}
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {m.logsManual.totalPulls(totalPulls)}
                </span>
              </div>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-minutes">{m.logsManual.minutesLabel}</Label>
              <Input
                id="manual-minutes"
                inputMode="numeric"
                value={draft.minutes}
                onChange={(e) => onChange({ ...draft, minutes: e.target.value })}
                className="w-28 font-mono tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">{m.logsManual.minutesHint}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-note">{m.logsManual.noteLabel}</Label>
              <Input
                id="manual-note"
                value={draft.note}
                maxLength={200}
                placeholder={m.logsManual.notePlaceholder}
                onChange={(e) => onChange({ ...draft, note: e.target.value })}
              />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {draft?.id ? (
            <Button
              type="button"
              variant="ghost"
              onClick={remove}
              disabled={busy}
              className="text-rose-300 hover:text-rose-200"
            >
              {m.logsManual.delete}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onChange(null)} disabled={busy}>
              {m.common.cancel}
            </Button>
            <Button type="button" onClick={save} disabled={busy}>
              {busy ? m.logsManual.saving : m.common.save}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
