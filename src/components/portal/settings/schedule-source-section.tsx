"use client";

import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages } from "@/lib/i18n/client";

/**
 * TODO #66 (2026-05-02): settings-dialog.tsx を機能別 sub-component に
 * 分割した一部。character-sheets URL の入力 UI のみ担当する。
 *
 * 親 (settings-dialog.tsx) が url state を保持し、保存ボタンも親に置く
 * (チャンネル ID と一括で保存するため)。本コンポーネントは controlled
 * input + 補助テキストの presentational role に徹する。
 */
export function ScheduleSourceSection({
  url,
  onUrlChange,
}: {
  url: string;
  onUrlChange: (value: string) => void;
}) {
  const m = useMessages();
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Schedule Source
        </span>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label
            htmlFor="schedule-url"
            className="text-xs text-foreground/80"
          >
            {m.scheduleSource.urlLabel}
          </Label>
          <a
            href="https://character-sheets.appspot.com/schedule/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--neon-cyan)]"
            title={m.scheduleSource.openSiteTitle}
          >
            <Calendar className="h-2.5 w-2.5" aria-hidden />
            {m.scheduleSource.openSite}
          </a>
        </div>
        <Input
          id="schedule-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://character-sheets.appspot.com/schedule/list?key=..."
          className="font-mono text-[12px]"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {m.scheduleSource.formatBefore}{" "}
          <code className="font-mono">schedule/list?key=…</code>{" "}
          {m.scheduleSource.formatAfter}
        </p>
        <details className="group/help">
          <summary className="cursor-pointer text-[10px] text-muted-foreground/80 transition-colors hover:text-foreground/90 list-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1">
              <span className="text-[var(--neon-cyan)]/70 transition-transform group-open/help:rotate-90">
                ▸
              </span>
              {m.scheduleSource.helpSummary}
            </span>
          </summary>
          <ol className="mt-1.5 ml-3.5 flex list-decimal flex-col gap-0.5 text-[10px] text-muted-foreground/80 leading-relaxed">
            <li>
              <a
                href="https://character-sheets.appspot.com/schedule/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 hover:text-[var(--neon-cyan)]"
              >
                character-sheets.appspot.com/schedule/
              </a>
              {" "}{m.scheduleSource.step1Suffix}
            </li>
            <li>{m.scheduleSource.step2}</li>
            <li>
              {m.scheduleSource.step3Before}
              <code className="font-mono">/schedule/list?key=…</code>
              {" "}{m.scheduleSource.step3After}
            </li>
            <li>{m.scheduleSource.step4}</li>
          </ol>
        </details>
        <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
          {m.scheduleSource.delayBefore}{" "}
          <strong>{m.scheduleSource.delayStrong}</strong>{" "}
          {m.scheduleSource.delayAfter}
        </p>
      </div>
    </section>
  );
}
