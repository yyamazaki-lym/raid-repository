"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importDiscordNow } from "@/lib/server/categories-actions";

/**
 * Manual "Import now" trigger for the Discord cron pipeline.
 *
 * Calls the same core function that the daily Vercel Cron uses, via a
 * Server Action. No client-side credentials needed: DISCORD_BOT_TOKEN and
 * Supabase server creds stay on the server.
 *
 * On completion the button toasts a summary (例: "今 +3 件取り込み") and
 * `router.refresh()` so the new rows appear immediately.
 */
export function ImportDiscordButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const onClick = () => {
    setDone(false);
    startTransition(async () => {
      const result = await importDiscordNow();
      if (!result.ok) {
        toast.error("取り込み失敗: " + (result.reason ?? "unknown"));
        return;
      }
      if (result.totalInserted === 0) {
        toast.success("新着なし (重複スキップ)");
      } else {
        const breakdown = result.byCategory
          .filter((b) => b.inserted > 0)
          .map((b) => `${b.category}/${b.kind}: +${b.inserted}`)
          .join("、");
        toast.success(
          `+${result.totalInserted} 件取り込み (${breakdown || "—"})`,
        );
      }
      router.refresh();
      setDone(true);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground disabled:opacity-60"
      aria-label="Discord から手動取り込み"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Cloud className="h-3.5 w-3.5" aria-hidden />
      )}
      {pending ? "取り込み中…" : done ? "再実行" : "Discord 取り込み"}
    </button>
  );
}
