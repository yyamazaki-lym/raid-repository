"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type RecruitmentTemplate } from "@/lib/recruitment-templates-client";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "./recruitment-templates-popover-body";

/**
 * Header button on the schedule page that exposes saved PT-募集 text
 * templates. Always shows the popover (regardless of count) so the user
 * can always see context — fixes the previous UX where 1 template made
 * the whole button collapse to a direct copy.
 *
 * 2026-07-12 監査 C-1: popover の中身 (DnD 並び替え一式 = @dnd-kit の
 * TOP 経路唯一の静的 import 元) を `recruitment-templates-popover-body.tsx`
 * へ分離し、`next/dynamic({ ssr: false })` で「開いた時だけ」ロードする
 * 別 chunk にした。トリガーボタンは静的なまま常時描画される (レイアウト
 * シフトなし = todos/11.md の禁止事項に非抵触)。hover / focus で preload
 * するため、実際に開く頃には chunk 取得が完了しているのが通常ケース。
 *
 * 2026-07-12 監査 C-3: realtime 購読はここでは行わない。親
 * (schedule-page-body) が `useRealtimeRecruitmentTemplates` を 1 回だけ
 * 呼び、本ボタンと `RecruitmentTopCopyButton` へ live 値を props で配る
 * (従来は両者が同一テーブルを二重購読し、変更毎に全件 refetch が 2 回
 * 走っていた)。
 */

const RecruitmentTemplatesPopoverBody = dynamic(
  () =>
    import("./recruitment-templates-popover-body").then((m) => ({
      default: m.RecruitmentTemplatesPopoverBody,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
        読み込み中…
      </div>
    ),
  },
);

/** hover / focus 時に popover body chunk を先読みして開いた瞬間の待ちを消す。 */
function preloadPopoverBody() {
  void import("./recruitment-templates-popover-body");
}

type Props = {
  templates: RecruitmentTemplate[];
  /** Categories used to look up slugs for the per-category link icons. */
  categories: CategoryOption[];
};

export function RecruitmentTemplatesButton({ templates, categories }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`PT募集文を選択してコピー (${templates.length}件)`}
        title={`PT募集文 ${templates.length}件 — クリックで一覧`}
        onMouseEnter={preloadPopoverBody}
        onFocus={preloadPopoverBody}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
          // Muted base — keeps the header palette quiet. Hover / open
          // states tint cyan so the active state is unambiguous.
          "border-border/60 text-muted-foreground",
          "hover:border-[var(--neon-cyan)]/60 hover:text-foreground",
          "data-[popup-open]:border-[var(--neon-cyan)]/60 data-[popup-open]:bg-[var(--neon-cyan)]/12 data-[popup-open]:text-[var(--neon-cyan)]",
        )}
      >
        <ClipboardCopy className="h-4 w-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="glass-popup w-[max(20rem,min(calc(100vw-1rem),32rem))] gap-1 p-1.5"
      >
        <RecruitmentTemplatesPopoverBody
          templates={templates}
          categories={categories}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Lightweight quick-copy button suitable for embedding inline (e.g.
 * the next-session card). Copies the topmost template directly on
 * click; hovering reveals a floating preview of the body so the user
 * can confirm what they're about to copy without firing first.
 *
 * Mobile (no hover) falls through gracefully — the click still copies
 * and the preview never shows. The button's `title` attribute carries
 * the label as a fallback for keyboard / a11y.
 */
export function RecruitmentTopCopyButton({
  templates,
}: {
  templates: RecruitmentTemplate[];
}) {
  const [hovered, setHovered] = useState(false);
  // Brief "just copied" state — flips the button to emerald + Check
  // icon for ~1.5s as visual confirmation. Toast is also fired but
  // disappears quickly; the button color change is in the user's
  // direct line of sight.
  const [justCopied, setJustCopied] = useState(false);
  if (templates.length === 0) return null;
  const top = templates[0]!;

  // Display label without the category prefix — the schedule page
  // shows the recruitment button in context of "this is the next
  // session's recruitment text", so the category name is implicit
  // and adding it makes the tooltip / toast feel redundant.
  const subLabel = top.label || "通常募集";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(top.body);
      toast.success(`「${subLabel}」をコピーしました`);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1500);
    } catch {
      toast.error("コピー失敗");
    }
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={copy}
        aria-label={`「${subLabel}」を募集文としてコピー`}
        title={`${subLabel} をコピー`}
        className={
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] tracking-normal transition-colors " +
          (justCopied
            ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 shadow-[0_0_10px_-4px_color-mix(in_oklch,oklch(0.78_0.18_155)_50%,transparent)]"
            : "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/15")
        }
      >
        {justCopied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
        )}
        {justCopied ? "コピー済" : "募集"}
      </button>
      {hovered && (
        <div
          role="tooltip"
          className="glass-popup pointer-events-none absolute right-0 top-full z-50 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-md border border-[var(--neon-cyan)]/30 p-2 shadow-[0_8px_24px_-12px_var(--neon-cyan)]"
        >
          {/* Sub-label only — category name is implicit (this is the
              top template; the user picked it as default). */}
          <p className="mb-1 text-[10px] tracking-normal text-[var(--neon-cyan)]">
            ★ {top.label || "通常募集"}
          </p>
          <pre className="max-h-[14rem] overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90">
            {top.body}
          </pre>
        </div>
      )}
    </span>
  );
}
