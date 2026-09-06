import type { Locale } from "@/lib/i18n/locales";

/**
 * 表示言語の国旗 (2026-09-07)。絵文字の国旗は Windows で「JP」「GB」の文字に
 * 化けるので、小さな inline SVG で描く。日本 = 日章旗、英語 = ユニオンジャック。
 * 比率 3:2、角丸 + 薄い枠で暗い背景に馴染ませる。
 */
export function LocaleFlag({
  locale,
  className = "h-3.5 w-[21px]",
}: {
  locale: Locale;
  className?: string;
}) {
  if (locale === "ja") {
    return (
      <svg viewBox="0 0 60 40" className={className} aria-hidden role="img">
        <rect width="60" height="40" rx="3" fill="#ffffff" />
        <circle cx="30" cy="20" r="12" fill="#bc002d" />
        <rect
          width="59"
          height="39"
          x="0.5"
          y="0.5"
          rx="3"
          fill="none"
          stroke="rgba(0,0,0,0.25)"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden role="img">
      <defs>
        <clipPath id="rr-flag-uk">
          <rect width="60" height="40" rx="3" />
        </clipPath>
      </defs>
      <g clipPath="url(#rr-flag-uk)">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#ffffff" strokeWidth="8" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" strokeWidth="3" />
        <path d="M30 0V40M0 20H60" stroke="#ffffff" strokeWidth="12" />
        <path d="M30 0V40M0 20H60" stroke="#c8102e" strokeWidth="7" />
      </g>
      <rect
        width="59"
        height="39"
        x="0.5"
        y="0.5"
        rx="3"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
      />
    </svg>
  );
}
