import { normalizeName } from "./attendance-reminder-core";

/**
 * 同期式の出欠スナップショットをメンバーキーに直す (L-14、2026-09-09)。
 *
 * ## なぜ要るのか
 *
 * 実機報告「出席サマリーは同期式の場合使えないか」。自前作成式は
 * `native_schedule_attendances` (メンバーキー → 記号) を持つが、同期式には
 * それが無く、代わりに `schedule_past_sessions.attendances`
 * (`{"名前": "◯", ...}`) がある。集計 (`summarizeAttendanceHistory`) は
 * **メンバーキー**で回答と実績を突き合わせるので、名前をキーに直す層が要る。
 *
 * ⚠ **`@/` エイリアスを使わない** (相対 import だけ)。
 * `scripts/check-attendance-sync-symbols.mjs` が単体でコンパイルして
 * 走らせられるようにするため。
 *
 * ## 方針
 *
 * - 名前の一致は `normalizeName` (全角/半角・空白・大文字小文字を吸収)。
 *   催促や W-6 の突合と同じキーを使う
 * - ⚠ **同じキーに 2 人当たったらどちらにも解決しない。** 取り違えるより
 *   未解決の方がまし (W-6 と同じ判断)
 * - ⚠ **スナップショットが無い日は「全員不在」にしない。** Discord の投稿
 *   だけから作られた日は回答が分からないので、集計から外して数を返す
 *   (`noAttendanceData`)。黙って母数を減らすと「休んだ」ことにされる
 */

/** 名前 → メンバーキーの対応表 (重複した名前は null = 未解決)。 */
export function buildMemberKeyByName(
  members: ReadonlyArray<{ discordUserId: string; displayName: string | null }>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const mem of members) {
    const key = normalizeName(mem.displayName ?? "");
    if (!key) continue;
    out.set(key, out.has(key) ? null : mem.discordUserId);
  }
  return out;
}

/**
 * 1 日ぶんのスナップショットをメンバーキー → 記号に直す。
 *
 * スナップショットが無い (null / オブジェクトでない) 場合は `null` を返す。
 * 呼び出し側はその日を集計から外して数える。
 */
export function syncSymbolsFromSnapshot(
  snapshot: unknown,
  keyByName: ReadonlyMap<string, string | null>,
): Record<string, string> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [rawName, symbol] of Object.entries(
    snapshot as Record<string, unknown>,
  )) {
    if (typeof symbol !== "string") continue;
    const id = keyByName.get(normalizeName(rawName));
    // 未登録の名前 (退会者など) と、重複して未解決の名前は落とす。
    if (!id) continue;
    out[id] = symbol;
  }
  return out;
}
