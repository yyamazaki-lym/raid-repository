"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { notifyNativeScheduleSessionAction } from "@/lib/server/native-schedule-actions";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useMessages } from "@/lib/i18n/client";

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
  const m = useMessages();
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, startTransition] = useTransition();

  const handleClick = async () => {
    if (
      !(await confirm({
        title: m.discordNotify.confirmTitle,
        description: m.discordNotify.confirmDescription(displayDate),
        confirmText: m.discordNotify.confirmButton,
        cancelText: m.common.cancel,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const r = await notifyNativeScheduleSessionAction(sessionId);
      if (!r.ok) {
        toast.error(m.discordNotify.errFailed(r.reason));
        return;
      }
      toast.success(m.discordNotify.toastSent(displayDate));
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      aria-label={m.discordNotify.ariaLabel(displayDate)}
      title={m.discordNotify.title}
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
