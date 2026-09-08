"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import {
  getLootWindowWeeksAction,
  setLootWindowWeeksAction,
} from "@/lib/server/loot-window-actions";
import { LOOT_WINDOW_WEEKS_DEFAULT } from "@/lib/loot-window-keys";
import { useMessages } from "@/lib/i18n/client";
import {
  CollapsibleSection,
  SectionBadge,
} from "./collapsible-section";

/**
 * 週制限の消化ウィンドウ設定 (W-33 ②、2026-09-07)。
 *
 * 8.0「白銀のワンダラー」(2027-01) でアラガントームストーンが **2 週管理**
 * になり、前週分を遡って取得できるようになります (調査ノート第 4 回 5-2)。
 * ロット管理の消化チェックは「今週だけ開いている」前提だったので、開ける
 * 週数を設定にして 8.0 で切り替えられるようにしました。
 *
 * 既定は 1 (7.x の挙動)。コードに「8.0 以降なら 2」と焼き込まないのは、
 * 仕様が実機で確認できるのが 2027-01 以降になるためです。
 */
export function LootWindowSection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [weeks, setWeeks] = useState(LOOT_WINDOW_WEEKS_DEFAULT);

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getLootWindowWeeksAction().then((r) => {
      if (cancelled) return;
      setLoaded(true);
      if (r.ok) setWeeks(r.weeks);
    });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const save = (next: number) => {
    if (next === weeks) return;
    const prev = weeks;
    setWeeks(next);
    startTransition(async () => {
      const r = await setLootWindowWeeksAction(next);
      if (!r.ok) {
        setWeeks(prev);
        toast.error(r.reason);
        return;
      }
      toast.success(m.lootWindow.saved(next));
      router.refresh();
    });
  };

  return (
    <CollapsibleSection
      id="loot-window"
      icon={
        <CalendarRange className="h-3.5 w-3.5 text-amber-300" aria-hidden />
      }
      title={m.lootWindow.title}
      // 2026-09-08 実機要望「右端にも現状の設定を表示してほしい」。
      // 「今週だけ / 今週 + 前週」は**開かずに知りたい運用状態**で、
      // ロット画面で前週の行が出るかどうかがこれで決まる。
      badge={
        <SectionBadge state={!loaded ? "loading" : weeks > 1 ? "on" : "off"}>
          {!loaded
            ? "…"
            : weeks === 1
              ? m.lootWindow.oneWeek
              : m.lootWindow.twoWeeks}
        </SectionBadge>
      }
    >
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.lootWindow.description}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {[1, 2].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => save(n)}
            disabled={pending || !loaded}
            aria-pressed={weeks === n}
            className={
              "rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors disabled:opacity-50 " +
              (weeks === n
                ? "border-amber-400/60 bg-amber-400/12 text-amber-200"
                : "border-border/40 bg-background/30 text-muted-foreground hover:text-foreground")
            }
          >
            {n === 1 ? m.lootWindow.oneWeek : m.lootWindow.twoWeeks}
          </button>
        ))}
        {!loaded && (
          <span className="text-[12px] text-muted-foreground/80">
            {m.common.loading}
          </span>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        {weeks === 1 ? m.lootWindow.oneWeekHint : m.lootWindow.twoWeeksHint}
      </p>
    </CollapsibleSection>
  );
}
