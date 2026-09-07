/**
 * 練習ログ: 動画リンク (1 レポート N 動画) の表示ヘルパー。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。DayRow (管理バーの
 * チップ) と PullRow (pull ごとの動画リンク) の両方から使うため、部品では
 * なく共有モジュールとして独立させている。分割の経緯と依存の向きは
 * `./README.md` を参照。
 */

import { formatClock } from "@/lib/fflogs-url";
import { type ReportVideoLink } from "@/lib/supabase/fflogs-fights";

/**
 * 動画オフセットのダイアログが編集している対象 (2026-09-07)。
 * `id === null` = このレポートに動画を 1 本追加する。
 */
export type OffsetTarget = {
  id: string | null;
  reportCode: string;
  videoUrl: string;
  offset: string;
  label: string;
};

/** 動画チップの表示名。`label` 未設定なら「動画 1」のような連番を使う。 */
export function videoName(link: ReportVideoLink, fallback: string): string {
  return link.label?.trim() || fallback;
}

/**
 * チップに添えるオフセット表記 (`+0:56` / `-1:20`)。動画ごとに別の値が
 * 入っていることが一覧で分かるようにするため、符号を必ず出す。
 */
export function formatSignedOffset(seconds: number): string {
  return `${seconds < 0 ? "-" : "+"}${formatClock(Math.abs(seconds))}`;
}
