/**
 * 行ごとの出欠サマリーチップ (UI-9、2026-09-07)。
 *
 * 予定表は「1 列 = 1 人」なので行を見れば 8 人分の記号は並ぶが、
 * 「何人 OK で誰が未回答か」は 8 列を目で追う必要があった
 * (調査ノート第 4 回 8-3 UI-9)。行のアイコン列に内訳を 1 つ添える。
 *
 * ## 出す情報を絞る
 *
 * チップに出すのは **参加見込みの人数 / 対象人数** と **未回答の数**だけ。
 * 5 種類の記号を全部並べると行が横に伸びて、表そのものより読みにくく
 * なる。内訳と未回答者の名前は `title` (hover) に入れる — 誰が未回答かは
 * 催促するときにだけ必要な情報で、常時見せると監視感が出る
 * (W-27 の既読管理で「誰が未読かは管理者のみ」にしたのと同じ考え)。
 *
 * 色は 3 段階 (`attendanceStage`):
 *   full = 成立 / waiting = 未回答が残っている / short = 人数不足
 * 未回答が残っている間は「足りない」を赤で出さない (まだ埋まる余地がある)。
 *
 * ## 人数だけにする (2026-09-07 / L-16 2026-09-09 実機報告)
 *
 * 2026-09-07 の指摘: 「PC なら良いがスマホだとおそらく長くなりすぎる。
 * **参加人数と確定が分かれば良い**」。まず `sm` 未満だけ `+n?` を外した。
 *
 * L-16 (2026-09-09): 「参加人数合算で未入力者は +1? のように出さなくても
 * 良いと思う。除外。」→ **どの幅でも出さない**。未回答が残っていることは
 * 琥珀色のトーンが示し、人数と名前は hover の `title` (と `aria-label`) に
 * 残してあるので、情報自体は失われない。あわせて幅を詰めた
 * (68px → 52px。`sm` 未満は 40px のまま)。
 *
 * ## 出す行 (2026-09-08、L-2)
 *
 * upcoming 行だけに出す。PAST 詳細ログの行では**描かない** (呼び出し側の
 * `schedule-list.tsx` が `!isPast` で外す)。過去行は回答が確定していて同じ行に
 * 1 人 1 列で記号が並ぶため内訳が重複し、幅だけを食っていた。縦揃えのための
 * `reserveSpace` は table 単位でしか要らず、PAST は upcoming とは別 table
 * なので、プレースホルダごと落として列を詰められる。
 *
 * ⚠ **幅は縮めても「固定」のまま**にする。`w-auto` / `min-w-*` にすると幅が
 * 行ごと (その行に未回答が居るか) で変わり、アイコン列が `mx-auto` で
 * 中央寄せされているせいで メモ / 動画 / Logs のアイコンが行ごとに半分ずつ
 * ずれる。プレースホルダ (上の reserveSpace) と**同じ幅の対**を保つこと。
 * 文字を小さくして幅を稼ぐのも不可 — `text-[11px]` は
 * `scripts/check-font-sizes.mjs` の下限そのもの。
 */
"use client";

import { useLocale, useMessages } from "@/lib/i18n/client";
import { getAttendanceLabel } from "@/lib/schedule/attendance-ui";
import {
  attendanceStage,
  availableCount,
  summarizeAttendance,
} from "@/lib/schedule/attendance-summary";

/**
 * 揃える人数。8 人レイド固定なので 8。ロスターが 9 人以上 (補欠込み) の
 * ときに「9 人揃わないと成立しない」と出さないよう上限として使う。
 */
const RAID_PARTY_SIZE = 8;

export function AttendanceSummaryChip({
  users,
  attendances,
  reserveSpace = false,
}: {
  users: ReadonlyArray<{ userId: string; name: string }>;
  attendances: Readonly<Record<string, string>>;
  /** 値が無い行でも幅だけ残して縦揃えを保つ (他のアイコン列と同じ方針)。 */
  reserveSpace?: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const summary = summarizeAttendance(users, attendances);
  if (summary.total === 0) {
    return reserveSpace ? (
      <span aria-hidden className="inline-block w-[2.5rem] shrink-0 sm:w-[4.25rem]" />
    ) : null;
  }

  const required = Math.min(RAID_PARTY_SIZE, summary.total);
  const stage = attendanceStage(summary, required);
  const tone =
    stage === "full"
      ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
      : stage === "waiting"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-border/50 text-muted-foreground";

  // hover に内訳と未回答者。記号のラベルは表示言語つきで引く。
  const parts = [
    summary.ok > 0 ? `${getAttendanceLabel("◯", locale) ?? "◯"} ${summary.ok}` : null,
    summary.late > 0 ? `${getAttendanceLabel("⏰", locale) ?? "⏰"} ${summary.late}` : null,
    // カスタム凡例の 昼 / 夜 / 早 (時間帯つきの参加可)。参加見込みには
    // 入っているので、内訳にも出さないと数が合わないように見える。
    summary.partial > 0 ? m.attendanceSummary.partial(summary.partial) : null,
    summary.undecided > 0
      ? `${getAttendanceLabel("△", locale) ?? "△"} ${summary.undecided}`
      : null,
    summary.no > 0 ? `${getAttendanceLabel("×", locale) ?? "×"} ${summary.no}` : null,
    summary.other > 0 ? m.attendanceSummary.other(summary.other) : null,
    summary.unanswered > 0 ? m.attendanceSummary.unanswered(summary.unanswered) : null,
  ].filter(Boolean);
  const title =
    parts.join(" / ") +
    (summary.unansweredNames.length > 0
      ? `\n${m.attendanceSummary.unansweredNames(summary.unansweredNames.join("、"))}`
      : "");

  return (
    <span
      title={title}
      aria-label={title.replace(/\n/g, " ")}
      className={
        "inline-flex w-[2.5rem] shrink-0 items-center justify-center gap-1 rounded-sm border px-1 py-0.5 font-mono text-[11px] tabular-nums sm:w-[3.25rem] " +
        tone
      }
    >
      {/* L-16 (2026-09-09): `+n?` は出さない (上の docstring 参照)。
          未回答の人数と名前は title / aria-label に残っている。 */}
      {m.attendanceSummary.chip(availableCount(summary), required)}
    </span>
  );
}
