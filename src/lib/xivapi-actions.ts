/**
 * 技名の日本語化 — XIVAPI v2 の `Action` シートを ID で引く (2026-09-06)。
 * 純関数のみ (server 側の fetch は `server/xivapi-action-names.ts`)。
 *
 * FFLogs の Summary table が返す致命技の名前 (`ability.name`) は英語で、
 * 練習ログの「ワイプ原因」がそのまま英語表示になっていた。同じ要素に
 * ゲーム内 action ID (`ability.guid`) が付いているので、これをキーに
 * XIVAPI (ゲームデータのダンプを配信している公開 API) から日本語名を引く。
 *
 * - 名前が既に非 ASCII (アップロード者の言語で翻訳済み等) なら引かない。
 * - ID が無い死亡 (DoT など) はそのまま。
 * - 解決できなくても英語名で表示は続く (この機能は装飾であって依存先ではない)。
 */

import type { StoredDeathEvent } from "./fflogs-fight-detail";

export const XIVAPI_ACTION_SHEET_URL = "https://v2.xivapi.com/api/sheet/Action";

/** 1 リクエストで引く行数の上限 (URL 長と応答サイズの妥協点)。 */
export const XIVAPI_ROWS_PER_REQUEST = 50;

/** FFLogs が返した名前が ASCII だけなら日本語を引く価値がある。 */
export function needsJapaneseLookup(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^[ -~]+$/.test(name);
}

/** `rows=1,2,3&fields=Name&language=ja` の形の URL を作る (重複除去 / 昇順)。 */
export function buildActionSheetUrl(ids: readonly number[]): string {
  const rows = [...new Set(ids)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .join(",");
  return `${XIVAPI_ACTION_SHEET_URL}?rows=${rows}&fields=Name&language=ja`;
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

/** 日本語名を引くべき死亡イベントの action ID (重複除去、出現順)。 */
export function collectLookupIds(
  events: ReadonlyArray<Pick<StoredDeathEvent, "id" | "ability" | "ja">>,
): number[] {
  const seen = new Set<number>();
  for (const e of events) {
    if (e.ja) continue;
    if (typeof e.id !== "number" || !Number.isInteger(e.id) || e.id <= 0) continue;
    if (!needsJapaneseLookup(e.ability)) continue;
    seen.add(e.id);
  }
  return [...seen];
}

/** 配列を `size` 件ずつに切る。 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 解決結果を死亡イベントへ書き戻す (in place)。書き換えた件数を返す。 */
export function applyJapaneseNames(
  events: Array<Pick<StoredDeathEvent, "id" | "ability" | "ja">>,
  names: ReadonlyMap<number, string>,
): number {
  let n = 0;
  for (const e of events) {
    if (e.ja || typeof e.id !== "number") continue;
    const ja = names.get(e.id);
    if (!ja || ja === e.ability) continue;
    e.ja = ja;
    n += 1;
  }
  return n;
}
