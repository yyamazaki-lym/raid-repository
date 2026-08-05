"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { setNativeScheduleSessionStatusAction } from "@/lib/server/native-schedule-actions";
import type { NativeCancelledSessionRow } from "@/lib/schedule/native-admin-client";
import { useConfirm } from "@/components/portal/confirm-dialog";

/**
 * TODO #2 phase 2-C (2026-05-07): native スケジュールの CANCELLED 行を一覧
 * + 復帰させる section。
 *
 * - status='CANCELLED' の sessions のみ表示 (`fetchNativeScheduleAdminAux`
 *   で別経路 SELECT 済)
 * - 各行に「CANDIDATE に戻す」「DECISION に戻す」button →
 *   `setNativeScheduleSessionStatusAction(id, status)` を呼ぶ
 * - confirm() で確認、成功で onChanged + router.refresh() を発火
 *   (schedule-list 側に再表示される)
 *
 * 削除 (`deleteNativeScheduleSessionAction`) はトップ側 `SessionStatusToggle`
 * に集約されているのでここでは扱わない。CANCELLED → DECISION/CANDIDATE の
 * 復帰のみ。
 */

const DOW_RE = /^[一-龯ぁ-んァ-ヴ]+$/;

function formatDateLabel(parsedDate: string, dayOfWeek: string, rawDate: string): string {
  // parsed_date は ISO だが UI には raw_date (元表記) のほうが分かりやすい。
  // 念のため raw_date が空なら parsed_date + (曜日) で fallback。
  if (rawDate.trim()) return rawDate;
  const dow = DOW_RE.test(dayOfWeek) ? `(${dayOfWeek})` : dayOfWeek;
  return `${parsedDate} ${dow}`;
}

export function NativeCancelledSessionsSection({
  canEdit,
  cancelledSessions,
  loaded,
  onChanged,
}: {
  canEdit: boolean;
  cancelledSessions: NativeCancelledSessionRow[];
  loaded: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  // spinner を「押したボタン」にだけ出すための識別子 (`${id}:${next}`)。
  // pending boolean だけだと隣のボタンの icon まで spinner に変わる。
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const onRestore = async (
    s: NativeCancelledSessionRow,
    next: "CANDIDATE" | "DECISION",
  ) => {
    const label = formatDateLabel(s.parsed_date, s.day_of_week, s.raw_date);
    const nextLabel = next === "DECISION" ? "確定 (DECISION)" : "候補 (CANDIDATE)";
    if (
      !(await confirm({
        title: "ステータスを戻す",
        description: `「${label}」を ${nextLabel} に戻します。よろしいですか？`,
        confirmText: "戻す",
      }))
    )
      return;
    setPendingKey(`${s.id}:${next}`);
    startTransition(async () => {
      try {
        const r = await setNativeScheduleSessionStatusAction(s.id, next);
        if (!r.ok) {
          toast.error(r.reason);
          return;
        }
        toast.success(`「${label}」を ${nextLabel} に戻しました`);
        onChanged();
        router.refresh();
      } finally {
        setPendingKey(null);
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Schedule Cancelled Sessions
        </span>
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        キャンセル済みの候補日。スケジュール表からは非表示ですが、ここから候補または確定に戻すと再びスケジュール表に出現します。
      </p>

      {!loaded ? (
        <div className="text-[11px] text-muted-foreground italic">
          読み込み中…
        </div>
      ) : cancelledSessions.length === 0 ? (
        <div className="rounded-md border border-border/30 px-3 py-2 text-[11px] text-muted-foreground">
          キャンセル済みの候補日はありません。
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {cancelledSessions.map((s) => {
            const label = formatDateLabel(s.parsed_date, s.day_of_week, s.raw_date);
            return (
              <li
                key={s.id}
                className="flex flex-col gap-1.5 rounded-md border border-border/30 bg-secondary/20 px-3 py-2 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xs text-foreground">{label}</span>
                  {/* 時刻は nowrap で「21:00 / 〜24:00」への分断を防ぎ、
                      自由記述 note は break-words で枠内に折り返す。 */}
                  <span className="font-mono text-[10px] break-words text-muted-foreground/70">
                    <span className="whitespace-nowrap">
                      {s.start_time}〜{s.end_time}
                    </span>
                    {s.note ? ` · ${s.note}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || pending}
                    onClick={() => onRestore(s, "CANDIDATE")}
                    className="h-7 gap-1 px-2 text-[10px]"
                  >
                    {pending && pendingKey === `${s.id}:CANDIDATE` ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw className="h-3 w-3" aria-hidden />
                    )}
                    候補に戻す
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canEdit || pending}
                    onClick={() => onRestore(s, "DECISION")}
                    className="h-7 gap-1 px-2 text-[10px]"
                  >
                    {pending && pendingKey === `${s.id}:DECISION` ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                    )}
                    確定に戻す
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
