"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Timer, X } from "lucide-react";
import { toast } from "sonner";
import {
  backfillVideoDurations,
  type DurationBackfillResult,
} from "@/lib/server/categories-actions";

/**
 * One-shot scan that walks every video link with NULL `duration_seconds`
 * and tries to fetch the YouTube duration. Useful for groups that have
 * existing video links from before this feature shipped — running once
 * gives them populated cumulative practice-time totals on each card.
 *
 * Idempotent: re-running is a no-op once everything fetchable has been
 * filled. Non-YouTube videos are reported separately so the user knows
 * "skippedNonYoutube" entries still need manual entry (or just stay NULL
 * and don't contribute to the practice-time total — which is fine).
 */
export function BackfillDurationsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DurationBackfillResult | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!result) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current && popupRef.current.contains(target)) return;
      setResult(null);
    };
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [result]);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await backfillVideoDurations();
      if (!r.ok) {
        toast.error("動画時間取得失敗: " + (r.reason ?? "unknown"));
        return;
      }
      const summary =
        r.filled > 0
          ? `${r.filled} 件の動画時間を取得`
          : r.scanned === 0
            ? "未取得の動画なし"
            : `更新なし (YouTube 以外: ${r.skippedNonYoutube}, 失敗: ${r.failed})`;
      toast.success(summary);
      setResult(r);
      router.refresh();
    });
  };

  return (
    <div className="relative flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/40 bg-violet-400/8 px-3 py-1.5 font-mono text-[11px] tracking-widest text-violet-200 uppercase transition-colors hover:border-violet-400/60 hover:bg-violet-400/12 disabled:opacity-60"
        title="既存の動画リンクから YouTube の時間を取得して累計練習時間を算出します"
        aria-label="既存動画から動画時間を再取得"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Timer className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? "取得中…" : "動画時間を再取得"}
      </button>

      {result && (
        <div
          ref={popupRef}
          className="glass-popup relative z-30 w-full max-w-md rounded-md p-3 sm:absolute sm:top-full sm:right-0 sm:mt-2"
        >
          <button
            type="button"
            onClick={() => setResult(null)}
            aria-label="結果を閉じる"
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            動画時間 — 取得結果
          </p>
          <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-emerald-300">取得</span>
              <span className="font-mono text-foreground">{result.filled}</span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-zinc-400">YouTube 以外</span>
              <span className="font-mono text-foreground">
                {result.skippedNonYoutube}
              </span>
              <span className="text-muted-foreground">件 (NULL のまま)</span>
            </li>
            {result.failed > 0 && (
              <li className="flex items-baseline gap-2">
                <span className="font-mono text-rose-300">失敗</span>
                <span className="font-mono text-foreground">{result.failed}</span>
                <span className="text-muted-foreground">件</span>
              </li>
            )}
            <li className="mt-1 text-[10px] text-muted-foreground">
              対象: {result.scanned} 件（duration_seconds が NULL のもの）
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
