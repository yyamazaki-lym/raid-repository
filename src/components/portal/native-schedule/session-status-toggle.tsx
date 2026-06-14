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

const STATUS_LABEL: Record<Status, string> = {
  CANDIDATE: "候補",
  DECISION: "確定",
  CANCELLED: "中止 (一覧から除外)",
};

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
        toast.error(`status 更新に失敗しました: ${result.reason}`);
        return;
      }
      if (nextStatus === "CANCELLED") {
        toast.success(
          `${displayDate} を中止しました (一覧からは非表示になります)`,
        );
      } else {
        toast.success(
          `${displayDate} のステータスを「${STATUS_LABEL[nextStatus]}」に変更しました`,
        );
      }
      router.refresh();
    });
  };

  // trigger 表示は sync 経路の確定列と同じ見た目を踏襲。CANDIDATE = `·`、DECISION = 確定 badge。
  const triggerLabel =
    currentStatus === "DECISION" ? (
      <span className="inline-flex h-6 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-400/15 px-2 text-[10px] font-bold tracking-normal text-emerald-300 shadow-[0_0_12px_-3px_rgb(52_211_153)]">
        確定
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
        aria-label={`${displayDate} のステータスを変更 (現在: ${STATUS_LABEL[currentStatus]})`}
        title={`ステータス: ${STATUS_LABEL[currentStatus]} (クリックで変更)`}
        className="inline-flex items-center justify-center rounded-md transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 active:scale-95 disabled:opacity-50"
      >
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={4} className="glass-popup min-w-44">
        <DropdownMenuRadioGroup value={currentStatus} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="CANDIDATE" className="text-xs">
            <span className="font-mono text-muted-foreground">·</span>
            <span>候補</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="DECISION" className="text-xs">
            <span className="font-mono text-emerald-300">●</span>
            <span>確定</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="CANCELLED" className="text-xs text-rose-300">
            <span className="font-mono">×</span>
            <span>中止 (一覧から除外)</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
