import "server-only";
import { safeFetch } from "./safe-fetch";
import type { StoredDeathEvent } from "@/lib/fflogs-fight-detail";
import {
  XIVAPI_ROWS_PER_REQUEST,
  applyResolvedNames,
  buildActionSheetUrl,
  chunk,
  collectLookupIds,
  parseActionSheetRows,
  type ActionNameLang,
} from "@/lib/xivapi-actions";

/**
 * XIVAPI から技名を引く (2026-09-06、L-7 で ja / en 両対応に 2026-09-08)。
 *
 * 同期 (Server Action / cron) と保存済みデータの一括解決から呼ばれる。
 * FFLogs の取得の後段なので時間予算 (`deadlineAtMs`) を尊重し、失敗は
 * 握って元の名前のまま保存する。ID → 名前はパッチ単位でしか変わらないので
 * プロセス内に長めのキャッシュを持ち、同じ技を pull ごとに引き直さない。
 * 「シートに無い」も覚える (毎回同じ ID で 404 相当を出さないため)。
 *
 * ⚠ キャッシュのキーは **言語込み** (`ja:1234`)。言語を分けないと
 * 片方の言語で引いた名前をもう片方に配ってしまう。
 */
const TIMEOUT_MS = 6_000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, { name: string | null; at: number }>();

export async function resolveActionNames(
  ids: readonly number[],
  lang: ActionNameLang = "ja",
  deadlineAtMs: number = Number.POSITIVE_INFINITY,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const missing: number[] = [];
  const now = Date.now();
  for (const id of new Set(ids)) {
    const hit = cache.get(`${lang}:${id}`);
    if (hit && now - hit.at < TTL_MS) {
      if (hit.name) out.set(id, hit.name);
      continue;
    }
    missing.push(id);
  }
  for (const batch of chunk(missing, XIVAPI_ROWS_PER_REQUEST)) {
    if (Date.now() > deadlineAtMs) break;
    try {
      const res = await safeFetch(buildActionSheetUrl(batch, lang), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[xivapi] Action sheet ${res.status} — 技名は元のまま`);
        break;
      }
      const names = parseActionSheetRows(await res.json());
      const at = Date.now();
      for (const id of batch) {
        const name = names.get(id) ?? null;
        cache.set(`${lang}:${id}`, { name, at });
        if (name) out.set(id, name);
      }
    } catch (e) {
      console.warn("[xivapi] Action sheet fetch failed — 技名は元のまま:", e);
      break;
    }
  }
  return out;
}

/**
 * 死亡イベント列の致命技に、その言語の名前を付ける (in place)。
 * 既に入っている / ID 無し / 解決失敗はそのまま。
 */
export async function attachAbilityNames(
  events: StoredDeathEvent[],
  lang: ActionNameLang = "ja",
  deadlineAtMs: number = Number.POSITIVE_INFINITY,
): Promise<number> {
  const ids = collectLookupIds(events, lang);
  if (ids.length === 0) return 0;
  const names = await resolveActionNames(ids, lang, deadlineAtMs);
  if (names.size === 0) return 0;
  return applyResolvedNames(events, names, lang);
}

/**
 * ja と en の両方を付ける (in place)。付いた件数の合計を返す。
 *
 * ⚠ 同期の中で呼ぶので **ja を先に**やる。時間予算で片方しか終わらない
 * ときに残るのが日本語側になるようにしたい (この固定の既定言語)。
 */
export async function attachBothAbilityNames(
  events: StoredDeathEvent[],
  deadlineAtMs: number = Number.POSITIVE_INFINITY,
): Promise<number> {
  const ja = await attachAbilityNames(events, "ja", deadlineAtMs);
  const en = await attachAbilityNames(events, "en", deadlineAtMs);
  return ja + en;
}
