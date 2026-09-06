"use client";

import { Languages } from "lucide-react";
import { LocaleSwitcher } from "@/components/portal/locale-switcher";
import { useMessages } from "@/lib/i18n/client";

/**
 * 設定ダイアログの「表示言語」(2026-09-06)。他のセクションと違い
 * **ブラウザごと** の設定 (cookie) なので、共有設定ではないことを説明文に
 * 明記する。admin 権限は要らないので canEdit で隠さない。
 */
export function LocaleSection() {
  const m = useMessages();
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <Languages className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
            {m.settings.languageTitle}
          </h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {m.settings.languageDescription}
          </p>
        </div>
        <LocaleSwitcher className="shrink-0" />
      </div>
    </section>
  );
}
