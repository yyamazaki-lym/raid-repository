"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Cloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  importDiscordNow,
  type ImportNowItem,
} from "@/lib/server/categories-actions";

/**
 * Manual "Import now" trigger.
 *
 * After clicking, shows a toast with the high-level totals and renders a
 * full per-(category, kind) breakdown on the page so the user can see
 * exactly why nothing was imported (e.g. scanned=0 → bot permission
 * issue, duplicates>0 → already up-to-date, failed>0 → DB error).
 */
export function ImportDiscordButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<ImportNowItem[] | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismiss for the result popup. Only attached while items
  // are visible; anchor-button clicks are ignored so re-clicking doesn't
  // collapse the popup that's about to be replaced.
  useEffect(() => {
    if (!items) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current && popupRef.current.contains(target)) return;
      setItems(null);
    };
    // Defer attaching by a tick so the click that triggered the popup
    // doesn't immediately close it.
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [items]);

  const onClick = () => {
    setItems(null);
    startTransition(async () => {
      const result = await importDiscordNow();
      if (!result.ok) {
        toast.error("取り込み失敗: " + (result.reason ?? "unknown"));
        return;
      }
      const summary =
        result.totalInserted > 0
          ? `+${result.totalInserted} 件取り込み`
          : result.totalFailed > 0
            ? `0 件挿入 (失敗 ${result.totalFailed})`
            : result.totalScanned > 0
              ? `0 件挿入 (重複スキップ)`
              : `0 件 (Discord メッセージから URL を検出できず)`;
      toast.success(summary);
      setItems(result.items);
      router.refresh();
    });
  };

  return (
    <div className="relative flex flex-col gap-2">
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
        {pending ? "取り込み中…" : "Discord 取り込み"}
      </button>

      {items && items.length > 0 && (
        <div
          ref={popupRef}
          className="glass-popup relative z-30 w-full max-w-md rounded-md p-3 sm:absolute sm:top-full sm:right-0 sm:mt-2"
        >
          <button
            type="button"
            onClick={() => setItems(null)}
            aria-label="結果を閉じる"
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <p className="mb-2 pr-6 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            取り込み結果
          </p>
          <ul className="flex flex-col gap-1.5 text-[11px]">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <ResultIcon item={it} />
                <div className="flex-1 leading-relaxed">
                  <span className="font-mono text-foreground">
                    {it.category}/{it.kind}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {describeResult(it)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultIcon({ item }: { item: ImportNowItem }) {
  if (!item.ok) {
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden />;
  }
  if (item.skipped === "disabled") {
    return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
  }
  if (item.failed > 0) {
    return (
      <AlertTriangle
        className="mt-0.5 h-3 w-3 shrink-0 text-amber-400"
        aria-hidden
      />
    );
  }
  if (item.inserted > 0) {
    return (
      <CheckCircle2
        className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400"
        aria-hidden
      />
    );
  }
  return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
}

function describeResult(it: ImportNowItem): string {
  if (!it.ok) return `エラー: ${it.reason ?? "unknown"}`;
  if (it.skipped === "disabled") return "一時停止中（編集ダイアログから再開）";
  if (it.scanned === 0)
    return "Discord メッセージから URL を検出できず（チャンネル空、または Bot がアクセス不可）";
  if (it.failed > 0)
    return `scanned ${it.scanned}, 失敗 ${it.failed}${it.reason ? " — " + it.reason : ""}`;
  if (it.inserted > 0)
    return `+${it.inserted} 件 (重複 ${it.duplicates}, scanned ${it.scanned})`;
  return `すべて重複 (scanned ${it.scanned}, 重複 ${it.duplicates})`;
}
