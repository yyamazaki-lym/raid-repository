import { classifyAttendanceSymbol } from "./attendance-summary";
import {
  attendanceMismatch,
  mismatchWeight,
  type AttendanceMismatch,
} from "./attendance-actuals";

/**
 * 出席サマリー (W-19、2026-09-08) の集計ロジック。
 *
 * W-6 で保存した「実際に映っていた pull 数」と、○×△ の回答を突き合わせて
 *   - メンバーごとの「参加と答えた回数 / 実際に参加した回数 / ズレの内訳」
 *   - 日付つきのズレ一覧
 * を作る。DB に触らないので単体で検証できる
 * (`scripts/check-attendance-history.mjs`)。
 *
 * ## 何を作らないか (調査ノート 6-2)
 *
 * **公開ランキングと連続記録 (streak) は作らない。** 8 人の固定で出席率を
 * 並べて公開すると個人攻撃になりやすく、streak は「休めない空気」を作る。
 * 出すのは本人の履歴と幹部向けの集計だけ (可視範囲の適用は呼び出し側)。
 *
 * ## 突合できない日を分母に入れない
 *
 * ログが 1 pull も無い日 (`dayPulls === 0`) は「来ていない」ではなく
 * **「分からない」**。分母に入れると、ログ担当が休んだ日が全員の欠席に
 * 化ける。`noLog` として別に数え、画面にも件数を出す。
 *
 * ⚠ **pull はあるのに参加者が 1 人も紐づいていない日も同じ扱い**
 * (`unmatched`)。対応表が空、または参加者名の取得が効いていない (W-6 の
 * 既知の不確実性) ときにこうなる。ここを素通しすると、**参加可と答えた
 * 全員が「不在」に化ける** — dev preview で実際にそう見えた
 * (突合表を入れた直後、まだ 1 行も保存されていない状態)。
 *
 * 有志練習 (W-18 の `isOptional`) と中止 (`CANCELLED`) の日も外す。
 */

export type HistorySessionInput = {
  /** JST 暦日 ("YYYY-MM-DD")。fflogs_fights.session_date と同じ値。 */
  sessionDate: string;
  /** 表示用の日付ラベル (native の raw_date)。 */
  rawDate: string;
  status: "CANDIDATE" | "DECISION" | "CANCELLED";
  /** W-18: 有志練習 (任意参加) の日は集計から外す。 */
  isOptional: boolean;
  /** その日の総 pull 数 (0 = ログが無い → 突合できない)。 */
  dayPulls: number;
  /** メンバーキー → 回答記号。 */
  symbols: Readonly<Record<string, string | undefined>>;
  /** メンバーキー → その日に映った pull 数 (合計)。 */
  pullsBy: Readonly<Record<string, number>>;
};

export type HistoryMemberInput = {
  discordUserId: string;
  displayName: string;
};

export type MemberHistoryRow = {
  discordUserId: string;
  displayName: string;
  /** 突合できた日の数 (分母)。 */
  sessions: number;
  /** そのうち「参加する」と答えた日の数。 */
  saidYes: number;
  /** そのうち実際に映っていた日の数。 */
  attended: number;
  /** ズレの合計件数。 */
  mismatches: number;
};

export type MismatchEntry = {
  sessionDate: string;
  rawDate: string;
  discordUserId: string;
  displayName: string;
  kind: AttendanceMismatch;
  /** 回答記号 (未回答は null)。 */
  symbol: string | null;
  pulls: number;
  dayPulls: number;
};

export type AttendanceHistory = {
  rows: MemberHistoryRow[];
  /** 新しい日から、同じ日はズレの重い順。 */
  mismatches: MismatchEntry[];
  /** 突合できた日の数。 */
  sessions: number;
  /** ログが無くて突合できなかった日の数。 */
  noLog: number;
  /**
   * pull はあるのに参加者が 1 人も紐づいていない日の数。
   * 対応表が空 / 参加者名の取得が効いていないときにここが増える。
   */
  unmatched: number;
  /** 有志練習 / 中止で外した日の数。 */
  excluded: number;
  /**
   * 回答のスナップショットが無くて集計に入れられなかった日の数
   * (L-14、2026-09-09)。
   *
   * 同期式のときだけ 0 より大きくなり得る。character-sheets のスナップショット
   * から作られた日 (`schedule_past_sessions.attendances`) しか回答を持たず、
   * Discord の投稿だけから作られた日は回答が無い。「全員不在」ではなく
   * **分からない**ので、外した数を出して黙って母数を減らさない。
   * この関数は該当日を受け取らないので、値は呼び出し側が入れる。
   */
  noAttendanceData: number;
};

/**
 * 対象セッションとメンバーから履歴を作る。
 *
 * `members` の並びをそのまま行の並びに使う (呼び出し側が sort_order で
 * 並べる)。可視範囲 (本人だけ / 全員) の絞り込みも呼び出し側の責務。
 */
export function summarizeAttendanceHistory({
  sessions,
  members,
}: {
  sessions: ReadonlyArray<HistorySessionInput>;
  members: ReadonlyArray<HistoryMemberInput>;
}): AttendanceHistory {
  const rows = new Map<string, MemberHistoryRow>();
  for (const mem of members) {
    rows.set(mem.discordUserId, {
      discordUserId: mem.discordUserId,
      displayName: mem.displayName,
      sessions: 0,
      saidYes: 0,
      attended: 0,
      mismatches: 0,
    });
  }
  const mismatches: MismatchEntry[] = [];
  let counted = 0;
  let noLog = 0;
  let unmatched = 0;
  let excluded = 0;

  for (const s of sessions) {
    if (s.status === "CANCELLED" || s.isOptional) {
      excluded += 1;
      continue;
    }
    if (s.dayPulls <= 0) {
      noLog += 1;
      continue;
    }
    // 参加者が 1 人も紐づいていない日は「全員不在」ではなく「分からない」。
    // 判定は**メンバー全員**ではなく `pullsBy` 全体で行う — 本人だけを
    // 渡された (非 admin の) 呼び出しでも、その日に誰かが映っていれば
    // 突合できるため。
    if (!Object.values(s.pullsBy).some((n) => (n ?? 0) > 0)) {
      unmatched += 1;
      continue;
    }
    counted += 1;
    for (const mem of members) {
      const row = rows.get(mem.discordUserId);
      if (!row) continue;
      const symbol = s.symbols[mem.discordUserId] ?? null;
      const pulls = s.pullsBy[mem.discordUserId] ?? 0;
      row.sessions += 1;
      const kind = classifyAttendanceSymbol(symbol);
      if (kind === "ok" || kind === "late" || kind === "partial") {
        row.saidYes += 1;
      }
      if (pulls > 0) row.attended += 1;
      const mismatch = attendanceMismatch({
        symbol,
        pulls,
        dayPulls: s.dayPulls,
      });
      if (mismatch) {
        row.mismatches += 1;
        mismatches.push({
          sessionDate: s.sessionDate,
          rawDate: s.rawDate,
          discordUserId: mem.discordUserId,
          displayName: mem.displayName,
          kind: mismatch,
          symbol,
          pulls,
          dayPulls: s.dayPulls,
        });
      }
    }
  }

  mismatches.sort(
    (a, b) =>
      b.sessionDate.localeCompare(a.sessionDate) ||
      mismatchWeight(b.kind) - mismatchWeight(a.kind) ||
      a.displayName.localeCompare(b.displayName, "ja"),
  );

  return {
    rows: [...rows.values()],
    mismatches,
    sessions: counted,
    // 呼び出し側が上書きする (この関数は該当日を受け取らない)。
    noAttendanceData: 0,
    noLog,
    unmatched,
    excluded,
  };
}
