"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";
import {
  backfillFirstClearFromExistingVideos,
  type BackfillResult,
} from "@/lib/server/categories-actions";

/**
 * One-shot scan that walks every category's existing video links and
 * fills in `first_clear_at` from the earliest title containing a clear
 * keyword. Useful for groups that already imported many videos before
 * this feature shipped — running this once gives them populated badges
 * for past content. Idempotent: re-running is a no-op once everything
 * that can be detected has been filled.
 */
export function BackfillFirstClearButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BackfillResult | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await backfillFirstClearFromExistingVideos();
      if (!r.ok) {
        toast.error("スキャン失敗: " + (r.reason ?? "unknown"));
        return;
      }
      const summary =
        r.filled > 0
          ? `${r.filled} カテゴリーに初クリア日時を設定`
          : r.alreadySet > 0 && r.noMatch === 0
            ? "すべて設定済み"
            : `更新なし（クリア動画なし: ${r.noMatch}, 設定済み: ${r.alreadySet}）`;
      toast.success(summary);
      setResult(r);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/8 px-3 py-1.5 font-mono text-[11px] tracking-widest text-amber-200 uppercase transition-colors hover:border-amber-400/60 hover:bg-amber-400/12 disabled:opacity-60"
        title="既存の動画タイトルを再スキャンして初クリア日時を埋めます（既存値は上書きしません）"
        aria-label="既存動画から初クリア日時を再スキャン"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Trophy className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? "スキャン中…" : "クリア日時を再スキャン"}
      </button>

      {result && result.filled > 0 && (
        <div className="glass-popup w-full max-w-md rounded-md p-3 sm:absolute sm:right-0 sm:mt-12">
          <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            初クリア日時 — 設定結果
          </p>
          <ul className="flex flex-col gap-1.5 text-[11px]">
            {result.filledDetails.map((d, i) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed">
                <Trophy className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />
                <div className="flex-1">
                  <span className="font-mono text-foreground">{d.slug}</span>
                  <span className="ml-2 text-amber-200">
                    {formatShort(d.isoDate)}
                  </span>
                  <p className="mt-0.5 text-muted-foreground/80 break-words">
                    {d.videoTitle}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">
            設定済み {result.alreadySet} ／ 該当なし {result.noMatch}
          </p>
        </div>
      )}
    </div>
  );
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}
