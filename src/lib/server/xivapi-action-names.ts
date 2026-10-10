import "server-only";
import { unstable_cache } from "next/cache";
import { safeFetch } from "./safe-fetch";
import type { StoredDeathEvent } from "@/lib/fflogs-fight-detail";
import {
  XIVAPI_MAX_MISSING_RETRIES,
  XIVAPI_ROWS_PER_REQUEST,
  applyResolvedNames,
  buildActionSheetUrl,
  chunk,
  collectLookupIds,
  parseActionSheetRows,
  parseMissingRowId,
  type ActionNameLang,
} from "@/lib/xivapi-actions";

/**
 * XIVAPI から技名を引く (2026-09-06、L-7 で ja / en 両対応に 2026-09-08)。
 *
 * 同期 (Server Action / cron) と保存済みデータの一括解決から呼ばれる。
 * FFLogs の取得の後段なので時間予算 (`deadlineAtMs`) を尊重し、失敗は
 * 握って元の名前のまま保存する。ID → 名前はパッチ単位でしか変わらないので
 * 長めにキャッシュし、同じ技を pull ごとに引き直さない。
 * 「シートに無い」も覚える (毎回同じ ID で 404 相当を出さないため)。
 *
 * ## キャッシュの置き場 (2026-09-09 に変更)
 *
 * ⚠ **プロセス内 `Map` だけに置いてはいけない。** `sheet-table.ts` の
 * docstring に実測付きで書かれているとおり、単一固定向けの低トラフィック
 * portal では Lambda インスタンスがすぐ冷えるため、プロセス内キャッシュは
 * **ほぼ毎回ミス**する。この関数は練習ログの**ページ描画中**に呼ばれるので
 * (`wipe-ability-names.ts`)、ミスするたび締切 (2.5 秒) いっぱいまで描画が
 * 待たされていた。
 *
 * そこで `sheet-table.ts` と同じ 2 段にする:
 *
 *   L1 … プロセス内 `Map` (同じインスタンス内の重複呼び出しを畳む)
 *   L2 … `unstable_cache` (Data Cache。**インスタンスを跨いで共有**)
 *
 * ⚠ **キャッシュのキーは言語込み**。言語を分けないと片方の言語で引いた
 * 名前をもう片方に配ってしまう。L2 のキーは `lang` + **並べ替えた ID 列**で、
 * 同じ pull 集合を描くたびに当たる (新しい技が増えた時だけ引き直す)。
 *
 * ⚠ **バッチは並列で投げる。** 以前は `for ... await` の直列で、
 * 上限 100 ID / 1 リクエスト 50 行なので最悪 2 往復が直列に並んでいた。
 */
const TIMEOUT_MS = 6_000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Data Cache の TTL (秒)。ID → 名前はパッチ単位でしか変わらない。 */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const cache = new Map<string, { name: string | null; at: number }>();

/**
 * バッチ 1 本を引く (Data Cache 本体)。引数がそのままキーになるので
 * ID は**呼び出し側で並べ替えてから**渡す。
 *
 * 戻り値は `[id, name | null]` の配列 (Map は Data Cache に載らない)。
 * 「シートに無い」も `null` として覚える。
 */
const cachedBatch = unstable_cache(
  async (
    lang: ActionNameLang,
    ids: number[],
  ): Promise<Array<[number, string | null]>> => {
    // 2026-10-10: XIVAPI v2 は**シートに無い行 ID が 1 つでも混ざると要求全体を
    // 404** にする。本番では FFLogs の guid にそういう ID が混ざり、同じ
    // バッチの他の技まで全部英語のままだった (練習ログの「ワイプ原因」が
    // 一部だけ日本語になるのはこれ)。404 の本文から無い ID を取り出して
    // 除き、上限回数まで引き直す。除いた ID は「シートに無い」(null) として
    // 覚える。
    let remaining = ids;
    for (let attempt = 0; ; attempt++) {
      if (remaining.length === 0) return ids.map((id) => [id, null]);
      const res = await safeFetch(buildActionSheetUrl(remaining, lang), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const names = parseActionSheetRows(await res.json());
        return ids.map((id) => [id, names.get(id) ?? null]);
      }
      const missing =
        res.status === 404 && attempt < XIVAPI_MAX_MISSING_RETRIES
          ? parseMissingRowId(await res.text().catch(() => null))
          : null;
      if (missing !== null && remaining.includes(missing)) {
        remaining = remaining.filter((id) => id !== missing);
        continue;
      }
      // ⚠ 失敗は**投げる** — 失敗を値として返すと Data Cache が
      // 「名前が無い」を TTL いっぱい覚えてしまう。
      throw new Error(`XIVAPI Action sheet ${res.status}`);
    }
  },
  ["xivapi-action-names"],
  { revalidate: CACHE_TTL_SECONDS },
);

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
  if (missing.length === 0) return out;
  if (Date.now() > deadlineAtMs) return out;

  // ⚠ バッチは**並列**。ID は並べ替えてから渡す (Data Cache のキーになる)。
  const batches = chunk(
    [...missing].sort((a, b) => a - b),
    XIVAPI_ROWS_PER_REQUEST,
  );
  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        return await cachedBatch(lang, batch);
      } catch (e) {
        // 1 バッチの失敗で他を捨てない (装飾なので部分的に解決できれば十分)。
        console.warn("[xivapi] Action sheet fetch failed — 技名は元のまま:", e);
        return null;
      }
    }),
  );
  const at = Date.now();
  for (const pairs of results) {
    if (!pairs) continue;
    for (const [id, name] of pairs) {
      cache.set(`${lang}:${id}`, { name, at });
      if (name) out.set(id, name);
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
