/**
 * 技名の言語解決 — XIVAPI v2 の `Action` シートを ID で引く
 * (2026-09-06、L-7 で ja / en の両対応に、2026-09-08)。
 * 純関数のみ (server 側の fetch は `server/xivapi-action-names.ts`)。
 *
 * FFLogs の Summary table が返す致命技の名前 (`ability.name`) は
 * **アップロードしたクライアントの言語**で、日本語固定でも英語で入ることが
 * 多い。同じ要素にゲーム内 action ID (`ability.guid`) が付いているので、
 * これをキーに XIVAPI (ゲームデータのダンプを配信している公開 API) から
 * 表示言語の名前を引く。
 *
 * ## 言語ごとに「引く価値がある」の判定が逆になる
 *
 * ⚠ ja を引くのは名前が **ASCII だけ**のとき (= 英語で入っている)。
 * en を引くのは名前に **非 ASCII が混じる**とき (= 日本語等で入っている)。
 * 同じ言語で既に入っているものを引き直しても表示は変わらないので、
 * ここで弾いて XIVAPI への要求を減らす。
 *
 * - ID が無い死亡 (DoT など) はそのまま。
 * - 解決できなくても元の名前で表示は続く
 *   (この機能は装飾であって依存先ではない)。
 */

import type { StoredDeathEvent } from "./fflogs-fight-detail";

export const XIVAPI_ACTION_SHEET_URL = "https://v2.xivapi.com/api/sheet/Action";

/** 1 リクエストで引く行数の上限 (URL 長と応答サイズの妥協点)。 */
export const XIVAPI_ROWS_PER_REQUEST = 50;

/** 解決する言語。表示言語 (`@/lib/i18n`) と同じ 2 値。 */
export type ActionNameLang = "ja" | "en";

/**
 * その言語を引く価値があるか。
 *
 * - `ja`: 名前が ASCII だけ (英語で入っている) なら引く
 * - `en`: 名前に非 ASCII が混じる (日本語等で入っている) なら引く
 */
export function needsLookup(
  name: string | null | undefined,
  lang: ActionNameLang,
): boolean {
  if (!name) return false;
  const asciiOnly = /^[ -~]+$/.test(name);
  return lang === "ja" ? asciiOnly : !asciiOnly;
}

/** `rows=1,2,3&fields=Name&language=ja` の形の URL を作る (重複除去 / 昇順)。 */
export function buildActionSheetUrl(
  ids: readonly number[],
  lang: ActionNameLang = "ja",
): string {
  const rows = [...new Set(ids)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .join(",");
  return `${XIVAPI_ACTION_SHEET_URL}?rows=${rows}&fields=Name&language=${lang}`;
}

/**
 * XIVAPI v2 の応答 `{ rows: [{ row_id, fields: { Name } }] }` を
 * `ID → 名前` に直す。空文字の名前 (未使用行) は捨てる。
 */
export function parseActionSheetRows(json: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!json || typeof json !== "object") return out;
  const rows = (json as Record<string, unknown>)["rows"];
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r["row_id"] === "number" ? r["row_id"] : null;
    const fields = r["fields"];
    const name =
      fields && typeof fields === "object"
        ? (fields as Record<string, unknown>)["Name"]
        : null;
    if (id === null || typeof name !== "string") continue;
    const trimmed = name.trim();
    if (trimmed === "") continue;
    out.set(id, trimmed);
  }
  return out;
}

/** その言語の名前を引くべき死亡イベントの action ID (重複除去、出現順)。 */
export function collectLookupIds(
  events: ReadonlyArray<Pick<StoredDeathEvent, "id" | "ability" | "ja" | "en">>,
  lang: ActionNameLang = "ja",
): number[] {
  const seen = new Set<number>();
  for (const e of events) {
    if (localizedName(e, lang)) continue;
    if (typeof e.id !== "number" || !Number.isInteger(e.id) || e.id <= 0) continue;
    if (!needsLookup(e.ability, lang)) continue;
    seen.add(e.id);
  }
  return [...seen];
}

/** その言語で既に入っている名前 (無ければ null)。 */
function localizedName(
  e: Pick<StoredDeathEvent, "ja" | "en">,
  lang: ActionNameLang,
): string | null {
  const v = lang === "ja" ? e.ja : e.en;
  return v && v !== "" ? v : null;
}

/** 配列を `size` 件ずつに切る。 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 解決結果を死亡イベントへ書き戻す (in place)。書き換えた件数を返す。
 *
 * 元の名前と同じ文字列は入れない (保存を無駄に太らせないため)。
 */
export function applyResolvedNames(
  events: Array<Pick<StoredDeathEvent, "id" | "ability" | "ja" | "en">>,
  names: ReadonlyMap<number, string>,
  lang: ActionNameLang = "ja",
): number {
  let n = 0;
  for (const e of events) {
    if (localizedName(e, lang) || typeof e.id !== "number") continue;
    const resolved = names.get(e.id);
    if (!resolved || resolved === e.ability) continue;
    if (lang === "ja") e.ja = resolved;
    else e.en = resolved;
    n += 1;
  }
  return n;
}
