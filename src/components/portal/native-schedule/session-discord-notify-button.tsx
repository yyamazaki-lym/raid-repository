"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { notifyNativeScheduleSessionAction } from "@/lib/server/native-schedule-actions";
import { useConfirm } from "@/components/portal/confirm-dialog";

/**
 * TODO #2 phase 3 (2026-05-08): native セッションを Discord に手動通知する admin button。
 *
 * 配置: `schedule-list.tsx` 確定セル内、`SessionStatusToggle` の隣。
 * 表示条件 (5 条件 AND):
 *   `mode === "native"` && `isAdmin` && `status === "DECISION"` && `!isPast` && `nativeSessionId`
 *
 * 動作: confirm dialog → server action `notifyNativeScheduleSessionAction` (admin gate +
 * dispatch with `respectToggle=false, respectDedup=false`) → toast。手動経路は
 * ON/OFF と無関係、何度でも再送可能。
 */

export function SessionDiscordNotifyButton({
  sessionId,
  displayDate,
}: {
  sessionId: string;
  displayDate: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, startTransition] = useTransition();

  const handleClick = async () => {
    if (
      !(await confirm({
        title: "Discord に通知",
        description: `「${displayDate}」を Discord に通知します。よろしいですか？`,
        confirmText: "通知",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const r = await notifyNativeScheduleSessionAction(sessionId);
      if (!r.ok) {
        toast.error(`Discord 通知失敗: ${r.reason}`);
        return;
      }
      toast.success(`「${displayDate}」を Discord に通知しました`);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      aria-label={`${displayDate} を Discord に通知`}
      title="Discord に通知"
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:scale-110 hover:text-[var(--neon-cyan)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60 active:scale-95 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Bell className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
