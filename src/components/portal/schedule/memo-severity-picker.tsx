/**
 * 日付メモの重要度バッジと選択 UI (UI-3、2026-09-07)。
 *
 * 調査ノート第 4 回 8-3 UI-3 の注意書き「ラベルは色 + アイコン + 文字を
 * 必須に」に従い、**色・記号・文字の 3 つ**を必ず出す。赤緑の色覚多様性で
 * 読めない / モノクロで消える状態を作らないため。
 *
 * 判定と配色は `@/lib/memo-severity` (純関数 +
 * `scripts/check-memo-severity.mjs`)。
 */
"use client";

import { useMessages } from "@/lib/i18n/client";
import {
  MEMO_SEVERITIES,
  memoSeverityMark,
  memoSeverityToneClass,
  type MemoSeverity,
} from "@/lib/memo-severity";

/** 一覧に出すバッジ。未設定 (`none`) は何も出さない。 */
export function MemoSeverityBadge({ severity }: { severity: MemoSeverity }) {
  const m = useMessages();
  if (severity === "none") return null;
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] tracking-normal " +
        memoSeverityToneClass(severity)
      }
      title={m.memoSeverity.title(m.memoSeverity.labels[severity])}
    >
      <span aria-hidden className="font-mono">
        {memoSeverityMark(severity)}
      </span>
      {m.memoSeverity.labels[severity]}
    </span>
  );
}

/** 投稿 / 編集時の選択。4 値を横並びのトグルで出す。 */
export function MemoSeverityPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: MemoSeverity;
  onChange: (v: MemoSeverity) => void;
  disabled?: boolean;
}) {
  const m = useMessages();
  return (
    <div
      role="radiogroup"
      aria-label={m.memoSeverity.pickerAria}
      className="flex flex-wrap items-center gap-1"
    >
      {MEMO_SEVERITIES.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={
              "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] tracking-normal transition-colors disabled:opacity-50 " +
              (active
                ? memoSeverityToneClass(s)
                : "border-border/40 text-muted-foreground/70 hover:border-border/70 hover:text-foreground/80")
            }
          >
            {s !== "none" && (
              <span aria-hidden className="font-mono">
                {memoSeverityMark(s)}
              </span>
            )}
            {m.memoSeverity.labels[s]}
          </button>
        );
      })}
    </div>
  );
}
