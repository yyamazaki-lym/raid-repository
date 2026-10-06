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

/**
 * シートでの旧名 (2026-10-06、`native_schedule_members.schedule_aliases`)。
 *
 * 同期式のスナップショットは、その日にシートにあった名前を鍵に回答を保存する。
 * シートを切り替える・名前を変えると、変える前の日の回答が今のメンバーに
 * 結びつかず「未回答」になっていた (本番: 9/11 まで「Lym」「makiton」、
 * 9/18 から「Lym.sln」「.makiton」)。メンバーに旧名を持たせ、旧名でも照合する。
 */
export const MAX_SCHEDULE_ALIASES = 5;
export const MAX_SCHEDULE_ALIAS_LENGTH = 40;

/** 旧名の入力が範囲外だった理由 (文言は呼び出し側: 画面は辞書、サーバーは理由文)。 */
export type ScheduleAliasError = "too-long" | "control" | "too-many";

/**
 * 旧名の一覧を整える (前後の空白を落とし、空と重複 (正規化して同じもの) を
 * 除く)。数・長さ・制御文字が範囲外なら理由のコードを返す。
 */
export function normalizeScheduleAliases(
  list: ReadonlyArray<string>,
): { ok: true; aliases: string[] } | { ok: false; error: ScheduleAliasError } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    if (v.length > MAX_SCHEDULE_ALIAS_LENGTH) return { ok: false, error: "too-long" };
    // 制御文字 (schema の CHECK と同じ)。
    if ([...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
      return { ok: false, error: "control" };
    }
    const key = normalizeName(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  if (out.length > MAX_SCHEDULE_ALIASES) return { ok: false, error: "too-many" };
  return { ok: true, aliases: out };
}

/** 画面の入力 (カンマ・読点・改行区切り) を旧名の一覧に分ける。 */
export function splitScheduleAliasInput(text: string): string[] {
  return (text ?? "").split(/[,、，\n]/);
}

/**
 * 名前 → メンバーキーの対応表 (重複した名前は null = 未解決)。
 *
 * 2026-10-06: 旧名 (`scheduleAliases`) も載せる。表示名が優先で、旧名が
 * 別のメンバーの表示名と同じなら旧名の方を載せない (今の名前の照合を
 * 壊さない)。旧名どうしが 2 人に当たったら未解決にする。
 */
export function buildMemberKeyByName(
  members: ReadonlyArray<{
    discordUserId: string;
    displayName: string | null;
    scheduleAliases?: ReadonlyArray<string> | null;
  }>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const mem of members) {
    const key = normalizeName(mem.displayName ?? "");
    if (!key) continue;
    out.set(key, out.has(key) ? null : mem.discordUserId);
  }
  const displayKeys = new Set(out.keys());
  for (const mem of members) {
    for (const alias of mem.scheduleAliases ?? []) {
      const key = normalizeName(alias ?? "");
      if (!key || displayKeys.has(key)) continue;
      const prev = out.get(key);
      out.set(key, prev === undefined || prev === mem.discordUserId ? mem.discordUserId : null);
    }
  }
  return out;
}

/**
 * 保存済みの回答の名前 → 今のシートの userId を引く関数 (2026-10-06、
 * 過去ログの表示用)。
 *
 * まず今のシートの名前と完全一致 (従来どおり)。無ければ、その名前を旧名に
 * 持つメンバーの表示名でシートの人を探す (正規化して比較)。メンバーの表示名
 * がシートの名前と同じ前提 (同期式の Members の使い方)。どこにも当たらない・
 * 2 人に当たる名前は undefined (表示しない)。
 */
export function buildSheetUserResolver(
  sheetUsers: ReadonlyArray<{ userId: string; name: string }>,
  members: ReadonlyArray<{
    displayName: string | null;
    scheduleAliases?: ReadonlyArray<string> | null;
  }>,
): (name: string) => string | undefined {
  const exact = new Map(sheetUsers.map((u) => [u.name, u.userId]));
  const byNormalized = new Map<string, string | null>();
  for (const u of sheetUsers) {
    const key = normalizeName(u.name);
    if (!key) continue;
    byNormalized.set(key, byNormalized.has(key) ? null : u.userId);
  }
  const keyByName = buildMemberKeyByName(
    members.map((m, i) => ({
      discordUserId: String(i),
      displayName: m.displayName,
      scheduleAliases: m.scheduleAliases,
    })),
  );
  return (name: string) => {
    const hit = exact.get(name);
    if (hit) return hit;
    const key = normalizeName(name ?? "");
    const memberIndex = key ? keyByName.get(key) : undefined;
    if (memberIndex === undefined || memberIndex === null) return undefined;
    const display = normalizeName(members[Number(memberIndex)]?.displayName ?? "");
    // 旧名で当たったメンバーの今の表示名でシートの人を探す。
    if (!display || display === key) return undefined;
    return byNormalized.get(display) ?? undefined;
  };
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
