/**
 * メンバーを削除するときに残る関連データ (2026-10-01 監査 F-4、純モジュール)。
 *
 * メンバー行 (`native_schedule_members`) に FK で CASCADE するのは
 * `native_schedule_member_jobs` / `native_schedule_attendances` だけで、
 * 下の表は `discord_user_id` を FK 無しで持つ。schema のコメントにある
 * とおり**意図した設計** (「メンバー行を消しても履歴を壊さない」) なので、
 * 既定は残す。削除ダイアログで件数を見せ、管理者が選んだときだけ消す。
 *
 * - `delete`: その人だけの記録 (既読・週制限チェック・オンボーディング・
 *   出席の実績・自分用の注釈) → 行ごと消す
 * - `detach`: 固定で共有している記録 (チームの注釈・日付メモ) → 行は残し、
 *   書いた人の ID だけ外す (NULL)。日付メモは author_name が残るので
 *   誰が書いたかは読める。NULL の日付メモは「編集は admin だけ / 削除は
 *   ログイン済みなら誰でも」になる (schema 7a-2、L-18)
 *
 * `@/` を import しない純モジュール (scripts/check-member-data.mjs)。
 */

export type MemberDataTarget = {
  /** 画面の項目名と件数の鍵。 */
  id:
    | "linkReads"
    | "lootWeekly"
    | "onboarding"
    | "attendanceActuals"
    | "selfNotes"
    | "teamNotesAuthor"
    | "memoAuthor";
  table: string;
  column: string;
  action: "delete" | "detach";
  /** 追加の絞り込み (列 = 値)。 */
  filter?: { column: string; value: string };
};

export const MEMBER_DATA_TARGETS: readonly MemberDataTarget[] = [
  { id: "linkReads", table: "category_link_reads", column: "discord_user_id", action: "delete" },
  { id: "lootWeekly", table: "loot_weekly_checks", column: "discord_user_id", action: "delete" },
  { id: "onboarding", table: "category_onboarding_steps", column: "discord_user_id", action: "delete" },
  { id: "attendanceActuals", table: "fflogs_attendance_actuals", column: "discord_user_id", action: "delete" },
  // 自分用の注釈は scope='self' の行だけが discord_user_id を持つ。
  { id: "selfNotes", table: "fflogs_pull_notes", column: "discord_user_id", action: "delete", filter: { column: "scope", value: "self" } },
  { id: "teamNotesAuthor", table: "fflogs_pull_notes", column: "created_by_id", action: "detach", filter: { column: "scope", value: "team" } },
  { id: "memoAuthor", table: "schedule_session_memos", column: "author_user_id", action: "detach" },
];

export type MemberDataCounts = Record<MemberDataTarget["id"], number>;

/** メンバーキー (Discord ID かローカルキー)。native-schedule-actions と同じ形。 */
export const MEMBER_DATA_KEY_RE = /^(?:\d{17,20}|local_[A-Za-z0-9_-]{3,32})$/;

/** 消す / ID を外す対象の合計件数。0 なら 2 段目の確認は出さない。 */
export function memberDataTotal(counts: Partial<MemberDataCounts>): number {
  let n = 0;
  for (const t of MEMBER_DATA_TARGETS) n += Math.max(0, counts[t.id] ?? 0);
  return n;
}
