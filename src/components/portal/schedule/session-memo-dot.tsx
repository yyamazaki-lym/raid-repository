"use client";

/**
 * Tiny purple dot indicator. Parent renders this wherever it wants
 * (e.g. trailing the time text rather than the date), so the visual
 * cue and the click-to-edit affordance can sit in different spots.
 *
 * When given an `onClick`, renders as a button — typically wired to
 * `popoverRef.current?.open()` so clicking the dot opens the same
 * popover that the date label opens. The button gets a hit-target
 * larger than the visual dot (extra padding) so taps work on touch.
 *
 * (session-memo-popover.tsx から分離、C-5)
 */
export function SessionMemoDot({
  count,
  className = "",
  onClick,
  reserveSpace = false,
}: {
  count: number;
  className?: string;
  onClick?: () => void;
  /**
   * 1.9.27: when true, render an invisible h-4 w-4 placeholder for
   * count=0 (used in tabular contexts where memo / video / Logs
   * icons need vertical column alignment across rows). Default false
   * — compact strips (chips) prefer no empty gap.
   */
  reserveSpace?: boolean;
}) {
  const dotClass =
    "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon-violet)] shadow-[0_0_6px_var(--neon-violet)] transition-shadow";
  if (count <= 0) {
    if (!reserveSpace) return null;
    return (
      <span
        aria-hidden
        className={`inline-block h-4 w-4 shrink-0 ${className}`}
      />
    );
  }
  if (!onClick) {
    return (
      <span
        aria-label={`メモ ${count} 件`}
        title={`メモ ${count} 件`}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${className}`}
      >
        <span aria-hidden className={dotClass} />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-memo-dot-trigger
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`メモ ${count} 件 を開く`}
      title={`メモ ${count} 件（クリックで開く）`}
      className={
        "group/memodot inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--neon-violet)]/18 " +
        className
      }
    >
      <span
        aria-hidden
        className={`${dotClass} group-hover/memodot:shadow-[0_0_10px_var(--neon-violet)]`}
      />
    </button>
  );
}
