import "server-only";
import { safeFetch } from "./safe-fetch";
import type { StoredDeathEvent } from "@/lib/fflogs-fight-detail";
import {
  XIVAPI_ROWS_PER_REQUEST,
  applyJapaneseNames,
  buildActionSheetUrl,
  chunk,
  collectLookupIds,
  parseActionSheetRows,
} from "@/lib/xivapi-actions";

/**
 * XIVAPI から技名の日本語を引く (2026-09-06、練習ログのワイプ原因用)。
 *
 * 同期 (Server Action / cron) の中で呼ばれる。FFLogs の取得の後段なので
 * 時間予算 (`deadlineAtMs`) を尊重し、失敗は握って英語名のまま保存する。
 * ID → 名前はパッチ単位でしか変わらないのでプロセス内に長めのキャッシュを
 * 持ち、同じ技を pull ごとに引き直さない。「シートに無い」も覚える
 * (毎回同じ ID で 404 相当を出さないため)。
 */
const TIMEOUT_MS = 6_000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<number, { name: string | null; at: number }>();

export async function resolveActionNamesJa(
  ids: readonly number[],
  deadlineAtMs: number = Number.POSITIVE_INFINITY,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const missing: number[] = [];
  const now = Date.now();
  for (const id of new Set(ids)) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) {
      if (hit.name) out.set(id, hit.name);
      continue;
    }
    missing.push(id);
  }
  for (const batch of chunk(missing, XIVAPI_ROWS_PER_REQUEST)) {
    if (Date.now() > deadlineAtMs) break;
    try {
      const res = await safeFetch(buildActionSheetUrl(batch), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[xivapi] Action sheet ${res.status} — 技名は英語のまま`);
        break;
      }
      const names = parseActionSheetRows(await res.json());
      const at = Date.now();
      for (const id of batch) {
        const name = names.get(id) ?? null;
        cache.set(id, { name, at });
        if (name) out.set(id, name);
      }
    } catch (e) {
      console.warn("[xivapi] Action sheet fetch failed — 技名は英語のまま:", e);
      break;
    }
  }
  return out;
}

/**
 * 死亡イベント列の致命技に日本語名 (`ja`) を付ける (in place)。
 * 既に日本語 / ID 無し / 解決失敗はそのまま。
 */
export async function attachJapaneseAbilityNames(
  events: StoredDeathEvent[],
  deadlineAtMs: number = Number.POSITIVE_INFINITY,
): Promise<number> {
  const ids = collectLookupIds(events);
  if (ids.length === 0) return 0;
  const names = await resolveActionNamesJa(ids, deadlineAtMs);
  if (names.size === 0) return 0;
  return applyJapaneseNames(events, names);
}
