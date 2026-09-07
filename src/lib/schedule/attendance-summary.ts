/**
 * セッション 1 件の出欠サマリー (UI-9、2026-09-07)。
 *
 * 予定表は「1 列 = 1 人」の表で、行を見れば 8 人分の記号が並ぶ。ただし
 * **数える作業が人に残っていた** — 「今日は何人 OK で、誰が未回答か」は
 * 8 列を目で追う必要があり、列が多い日や画面が狭い端末では特に読みにくい。
 * 調査ノート第 4 回 8-3 UI-9 の「popover を開かずに人数と未回答者が
 * 見える」に合わせ、行ごとの内訳をここで数える。
 *
 * ## 記号の分類
 *
 * 記号は character-sheets 側の凡例で**自由に編集できる**ので、既知のもの
 * だけを分類し、知らない記号は `other` にまとめる (勝手に「参加可」に
 * 寄せると人数を偽ることになる)。分類の対応は `attendance-ui.ts` の
 * `ATT_LABEL_DICT` と同じ並び。
 *
 * 未回答の判定は催促と同じ `isUnanswered` を使う (全角ハイフン・半角・
 * 長音・空白のゆらぎを 1 箇所で吸収するため)。
 *
 * 検証: `node scripts/check-attendance-summary.mjs`
 */

import { isUnanswered } from "./attendance-reminder-core";

export type AttendanceSummary = {
  /** 参加可 (◯ / ○)。 */
  ok: number;
  /** 遅刻 (⏰)。参加はするので `ok` とは別に数える。 */
  late: number;
  /** 未定 (△)。 */
  undecided: number;
  /** 不可 (×)。 */
  no: number;
  /** 未回答 (－ / 空)。 */
  unanswered: number;
  /** 上記以外の記号 (凡例をカスタムした固定の「全 / 昼 / 夜 / 早」など)。 */
  other: number;
  /** 回答した人数 (未回答以外)。 */
  answered: number;
  /** 対象人数。 */
  total: number;
  /** 未回答の人の表示名 (催促の宛先が誰かを hover で出すため)。 */
  unansweredNames: string[];
};

/** 「参加可」として数える記号。半角/全角の同義記号を両方入れる。 */
const OK_SYMBOLS = new Set(["◯", "○"]);
const LATE_SYMBOLS = new Set(["⏰"]);
const UNDECIDED_SYMBOLS = new Set(["△"]);
const NO_SYMBOLS = new Set(["×"]);

/**
 * 1 セッションの内訳を数える。
 *
 * `members` は表に出ている人の一覧 (`userId` と表示名)。`attendances` は
 * `userId → 記号`。表に無い人 (退団済みで行だけ残っている等) は数えない
 * — 分母が表と食い違うと「7/8」の 8 が何の 8 なのか分からなくなる。
 */
export function summarizeAttendance(
  members: ReadonlyArray<{ userId: string; name: string }>,
  attendances: Readonly<Record<string, string>>,
): AttendanceSummary {
  const out: AttendanceSummary = {
    ok: 0,
    late: 0,
    undecided: 0,
    no: 0,
    unanswered: 0,
    other: 0,
    answered: 0,
    total: members.length,
    unansweredNames: [],
  };
  for (const member of members) {
    const raw = attendances[member.userId];
    if (isUnanswered(raw)) {
      out.unanswered += 1;
      out.unansweredNames.push(member.name);
      continue;
    }
    const symbol = (raw ?? "").trim();
    out.answered += 1;
    if (OK_SYMBOLS.has(symbol)) out.ok += 1;
    else if (LATE_SYMBOLS.has(symbol)) out.late += 1;
    else if (UNDECIDED_SYMBOLS.has(symbol)) out.undecided += 1;
    else if (NO_SYMBOLS.has(symbol)) out.no += 1;
    else out.other += 1;
  }
  return out;
}

/**
 * 参加できる見込みの人数 (参加可 + 遅刻)。
 *
 * 遅刻を足すのは、8 人揃うかの判断では「遅れて来る人」も頭数に入るため
 * (W-13 で遅刻を構造化したときと同じ扱い)。未定は入れない。
 */
export function availableCount(summary: AttendanceSummary): number {
  return summary.ok + summary.late;
}

/**
 * 行の見た目を決める段階。
 *
 *   - `full`     … 全員が参加可 / 遅刻 (成立)
 *   - `waiting`  … 未回答が残っている (催促の対象)
 *   - `short`    … 全員回答済みだが人数が足りない (中止の検討)
 *
 * 「未回答が残っている」を「人数不足」より優先する。まだ回答が来ていない
 * 段階で「足りない」と赤く出すと、実際には埋まる日に中止の判断を促して
 * しまう (調査ノート 6-2 の「完全自動中止は余地を潰す」と同じ考え)。
 */
export function attendanceStage(
  summary: AttendanceSummary,
  required: number,
): "full" | "waiting" | "short" {
  if (summary.total > 0 && availableCount(summary) >= required) return "full";
  if (summary.unanswered > 0) return "waiting";
  return "short";
}
