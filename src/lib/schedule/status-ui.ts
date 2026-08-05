/**
 * 開催ステータスの UI 表現。
 *
 * 「確定」バッジは 3 箇所 (次回開催日カード / 予定表の確定列 sync 経路 /
 * native admin の SessionStatusToggle の trigger) で同一様式を保つ必要が
 * あり、これまで同じクラス文字列を 3 重に書いていた。1 箇所を直して他が
 * 取り残される事故を避けるためここへ集約する (`attendance-ui.ts` と同趣旨の
 * 純定数モジュールなので server / client どちらの境界からも import 可能)。
 */

/**
 * 「確定」バッジのクラス。
 *
 * 2026-08-05: 20 行前後並ぶ予定表の中で確定行が埋没するというユーザー報告を
 * 受けて彩度・輪郭・発光を一段強めた (bg 15%→25% / border 60%→85% /
 * text emerald-300→200)。行側の tint (schedule-list.tsx の `decided`) も
 * 併せて濃くしている。
 */
export const DECISION_BADGE_CLASS =
  "inline-flex h-6 items-center justify-center rounded-md border border-emerald-400/85 bg-emerald-400/25 px-2 text-[10px] font-bold tracking-normal text-emerald-200 shadow-[0_0_14px_-2px_rgba(52,211,153,0.75)]";
