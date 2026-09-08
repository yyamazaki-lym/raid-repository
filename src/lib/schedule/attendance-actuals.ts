import { normalizeName } from "./attendance-reminder-core";
import { classifyAttendanceSymbol } from "./attendance-summary";

/**
 * 出席の自動突合 (W-6、2026-09-08) の純粋ロジック。
 *
 * FFLogs のログに映っていた人と、○×△ の回答を突き合わせる。DB / fetch に
 * 触らないので単体で検証できる (`scripts/check-attendance-actuals.mjs`)。
 *
 * ## 保存しないもの
 *
 * **キャラクター名は突合結果に残さない** (ユーザー判断 2026-09-08「突合結果
 * だけ持たせる」)。名前を pull 行の隣に置くと `fflogs_fights.death_events`
 * (ジョブ名のみで意図的に名前を持たない) と結合できてしまい、「誰が落ちたか」
 * を復元できる状態になる。この関数群は名前を**入力として受け取り、メンバー
 * キーに変換して返す**役割で、名前は呼び出し側 (同期処理) のメモリから出ない。
 *
 * ## 名前の一致
 *
 * `fflogs_character_name` → `display_name` の順に試す。表示名をキャラ名と
 * 同じにしている固定では対応表の入力が要らない、という運用上の近道のため。
 * 比較は催促と同じ `normalizeName` (全角英数の半角化 + 空白除去 + 小文字化)。
 *
 * ⚠ **同じ正規化キーに複数メンバーが当たる場合は、どちらにも解決しない。**
 * 取り違えて出席を記録する方が、未解決として admin に見せるより悪い。
 */

/** ログから拾った参加者 1 人ぶん (名前と、その日に映った pull 数)。 */
export type ActualParticipant = {
  name: string;
  pulls: number;
};

/** 対応表の 1 行。 */
export type MemberNameRef = {
  discordUserId: string;
  displayName: string;
  /** `native_schedule_members.fflogs_character_name` (未設定は null)。 */
  characterName: string | null;
};

export type ResolvedParticipants = {
  /** 対応表で解決できた分 (名前は落としてメンバーキーだけ)。 */
  matched: Array<{ discordUserId: string; pulls: number }>;
  /** 解決できなかった名前 (admin に見せて対応表を埋めてもらう)。 */
  unresolved: ActualParticipant[];
};

/**
 * 参加者名をメンバーキーに解決する。
 *
 * 同じメンバーに複数の名前が当たった場合 (キャラ名と表示名の両方が別々の
 * エントリーで一致した等) は pull 数を足す — 「その日に映った pull 数」は
 * 人単位の値なので、名前単位で 2 行に割れてはいけない。
 */
export function resolveParticipants(
  participants: ReadonlyArray<ActualParticipant>,
  members: ReadonlyArray<MemberNameRef>,
): ResolvedParticipants {
  // 正規化キー → メンバーキー。曖昧 (複数メンバーが同じキー) は null を
  // 入れて「解決しない」印にする。
  const byKey = new Map<string, string | null>();
  const put = (raw: string | null | undefined, userId: string) => {
    const key = normalizeName((raw ?? "").trim());
    if (!key) return;
    const prev = byKey.get(key);
    if (prev === undefined) byKey.set(key, userId);
    else if (prev !== userId) byKey.set(key, null);
  };
  // キャラ名を先に入れる (同じキーを表示名が後から曖昧化するのを避けたい
  // ので、両方を同じ Map に入れて「別メンバーなら曖昧」で統一する)。
  for (const mem of members) put(mem.characterName, mem.discordUserId);
  for (const mem of members) put(mem.displayName, mem.discordUserId);

  const pullsBy = new Map<string, number>();
  const unresolved: ActualParticipant[] = [];
  for (const p of participants) {
    const key = normalizeName((p.name ?? "").trim());
    const pulls = Number.isFinite(p.pulls) ? Math.max(0, Math.trunc(p.pulls)) : 0;
    if (!key || pulls <= 0) continue;
    const userId = key ? byKey.get(key) : undefined;
    if (userId) {
      pullsBy.set(userId, (pullsBy.get(userId) ?? 0) + pulls);
    } else {
      unresolved.push({ name: p.name.trim(), pulls });
    }
  }
  return {
    matched: [...pullsBy.entries()].map(([discordUserId, pulls]) => ({
      discordUserId,
      pulls,
    })),
    unresolved,
  };
}

/**
 * 回答と実績のズレ。
 *
 *   - `null`                 … ズレなし (回答どおり) / 判定できない
 *   - `absent-though-yes`    … 参加可の回答だったが映っていない
 *   - `partial-though-yes`   … 参加可の回答だが、その日のごく一部しか映っていない
 *   - `present-though-no`    … 不可の回答だが映っている
 *   - `present-though-other` … 未定 / 未回答 / 辞書外の回答で映っている
 *
 * 「未定なのに参加」を `present-though-no` と分けるのは、**責める向きが
 * 違う**ため。× で参加は「予定が変わって来られた」で歓迎される話、
 * ○ で不在は確認したい話、△ で参加は回答の更新漏れである。
 *
 * ⚠ 辞書外の記号 (`other`) は「参加可かどうか不明」なので、映っていない
 * ときに `absent-though-yes` を出さない。知らない記号を参加可に寄せると
 * ズレを捏造する (`attendance-summary.ts` と同じ方針)。
 */
export type AttendanceMismatch =
  | "absent-though-yes"
  | "partial-though-yes"
  | "present-though-no"
  | "present-though-other";

/**
 * 1 人 1 日ぶんのズレを判定する。
 *
 * @param symbol      その日のその人の回答記号 (未回答は null / "" / "－")
 * @param pulls       その日にその人が映っていた pull 数 (0 = 不在)
 * @param dayPulls    その日の総 pull 数 (部分参加の判定に使う。0 なら判定しない)
 * @param partialRatio 「ごく一部」とみなす上限の比 (既定 0.25)
 */
export function attendanceMismatch({
  symbol,
  pulls,
  dayPulls,
  partialRatio = 0.25,
}: {
  symbol: string | null | undefined;
  pulls: number;
  dayPulls: number;
  partialRatio?: number;
}): AttendanceMismatch | null {
  const kind = classifyAttendanceSymbol(symbol);
  const present = pulls > 0;
  // 参加すると答えた側 (参加可 / 遅刻 / 時間帯つき参加可)。
  const saidYes = kind === "ok" || kind === "late" || kind === "partial";
  if (saidYes) {
    if (!present) return "absent-though-yes";
    // 遅刻 / 時間帯つきの回答は「一部しか出ない」と申告済みなので、
    // 部分参加をズレとして出さない (申告どおり)。
    if (
      kind === "ok" &&
      dayPulls > 0 &&
      pulls / dayPulls <= partialRatio &&
      pulls < dayPulls
    ) {
      return "partial-though-yes";
    }
    return null;
  }
  if (!present) return null;
  if (kind === "no") return "present-though-no";
  // 未定 / 未回答 / 辞書外 — いずれも「映っているのに回答が参加でない」。
  return "present-though-other";
}

/** ズレの重さ (一覧の並び順に使う。大きいほど先に見せる)。 */
export function mismatchWeight(m: AttendanceMismatch): number {
  switch (m) {
    case "absent-though-yes":
      return 3;
    case "present-though-other":
      return 2;
    case "partial-though-yes":
      return 1;
    case "present-though-no":
      return 0;
  }
}
