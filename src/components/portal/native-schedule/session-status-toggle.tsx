"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setNativeScheduleSessionStatusAction } from "@/lib/server/native-schedule-actions";
import { DECISION_BADGE_CLASS } from "@/lib/schedule/status-ui";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/**
 * TODO #2 phase 2-B: native スケジュールの session status を admin が切替えるための
 * dropdown menu。確定列の中身 (`decided ? 確定 badge : ·`) を trigger に置換する。
 *
 * - CANDIDATE → 候補 (default)
 * - DECISION → 確定 (cyan badge)
 * - CANCELLED → 中止 (一覧から除外。`fetchNativeSchedule()` の filter で次回 fetch
 *   から消える。本セッションでは復帰 UI は実装しない、phase 2-C で settings に追加予定)
 */

type Status = "CANDIDATE" | "DECISION" | "CANCELLED";

/** 表示言語に応じた status ラベル (辞書 `sessionStatus` から組む)。 */
function statusLabels(m: Messages): Record<Status, string> {
  return {
    CANDIDATE: m.sessionStatus.candidate,
    DECISION: m.sessionStatus.decision,
    CANCELLED: m.sessionStatus.cancelled,
  };
}

type Props = {
  sessionId: string;
  /**
   * native-fetch.ts は CANCELLED 行を除外して返すため UI 上は CANDIDATE | DECISION
   * のみ到達するが、型上は将来的な拡張余地として 3 値許容しておく。
   */
  currentStatus: Status;
  /** 表示日。toast 文言で使用。 */
  displayDate: string;
};

export function SessionStatusToggle({
  sessionId,
  currentStatus,
  displayDate,
}: Props) {
  const m = useMessages();
  const STATUS_LABEL = statusLabels(m);
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const handleChange = (next: string) => {
    if (next === currentStatus) return;
    if (next !== "CANDIDATE" && next !== "DECISION" && next !== "CANCELLED") {
      return;
    }
    const nextStatus = next as Status;

    startTransition(async () => {
      const result = await setNativeScheduleSessionStatusAction(
        sessionId,
        nextStatus,
      );
      if (!result.ok) {
        toast.error(m.sessionStatus.errUpdate(result.reason));
        return;
      }
      if (nextStatus === "CANCELLED") {
        toast.success(m.sessionStatus.toastCancelled(displayDate));
      } else {
        toast.success(
          m.sessionStatus.toastChanged(displayDate, STATUS_LABEL[nextStatus]),
        );
      }
      router.refresh();
    });
  };

  // trigger 表示は sync 経路の確定列と同じ見た目を踏襲。CANDIDATE = `·`、DECISION = 確定 badge。
  const triggerLabel =
    currentStatus === "DECISION" ? (
      <span className={DECISION_BADGE_CLASS}>
        {m.sessionStatus.decision}
      </span>
    ) : (
      <span className="inline-flex h-6 items-center justify-center px-2 font-mono text-muted-foreground/60">
        ·
      </span>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        aria-label={m.sessionStatus.ariaLabel(displayDate, STATUS_LABEL[currentStatus])}
        title={m.sessionStatus.title(STATUS_LABEL[currentStatus])}
        className="inline-flex items-center justify-center rounded-md transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 active:scale-95 disabled:opacity-50"
      >
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={4} className="glass-popup min-w-44">
        <DropdownMenuRadioGroup value={currentStatus} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="CANDIDATE" className="text-xs">
            <span className="font-mono text-muted-foreground">·</span>
            <span>{m.sessionStatus.candidate}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="DECISION" className="text-xs">
            <span className="font-mono text-emerald-300">●</span>
            <span>{m.sessionStatus.decision}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="CANCELLED" className="text-xs text-rose-300">
            <span className="font-mono">×</span>
            <span>{m.sessionStatus.cancelled}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
