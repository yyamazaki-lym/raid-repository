import { jstYmdString } from "@/lib/jst-date";

/**
 * Quick "5分前 / 2時間前 / 3日前 / YYYY-MM-DD" formatter for the memo
 * timestamp. Long-form date once it gets old enough that relative
 * units stop being meaningful. (session-memo-popover.tsx から分離、C-5)
 */
export function formatRelativeTime(
  iso: string,
  locale: "ja" | "en" = "ja",
): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const en = locale === "en";
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return en ? "just now" : "たった今";
  if (min < 60) return en ? `${min}m ago` : `${min}分前`;
  const hr = Math.round(diffMs / 3_600_000);
  if (hr < 24) return en ? `${hr}h ago` : `${hr}時間前`;
  const day = Math.round(diffMs / 86_400_000);
  if (day < 7) return en ? `${day}d ago` : `${day}日前`;
  // Older — absolute date。アプリ全体が JST 暦日基準なので、閲覧者の local TZ
  // ではなく jstYmdString で組み立てる (非 JST 環境での 1 日ずれを防ぐ)。
  return jstYmdString(d);
}
