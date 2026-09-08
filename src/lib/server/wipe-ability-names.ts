import "server-only";

import type { Locale } from "@/lib/i18n/locales";
import type { WipeSummary } from "@/lib/fflogs-fight-detail";
import { needsLookup } from "@/lib/xivapi-actions";
import { resolveActionNames } from "./xivapi-action-names";

/**
 * ワイプ原因の技名を表示言語で埋める (L-7、2026-09-08)。
 *
 * ## なぜ表示のときに引くのか
 *
 * 技名の解決 (`server/xivapi-action-names.ts`) は**同期の後段**で走るので、
 * それ以前に取り込んだ pull の `death_events` には `ja` / `en` が入って
 * いない。再同期は 1 回に 1 レポートしか取り直さないため、放っておくと
 * 古い pull はいつまでも FFLogs のクライアント言語 (この固定では英語) で
 * 表示され続ける。**実機報告 L-7 がまさにこれ。**
 *
 * 保存済みデータを一括で書き換える手もあるが、pull 数は 20,000 行規模で
 * UPDATE の本数が読めない。一方**表示に必要なのは「最初の死亡の技名」**
 * だけで、その action ID の種類は 1 コンテンツで数十しかない。だから
 * ここで **足りない ID だけを 1 〜 2 リクエストで引く**方が安く済む。
 *
 * ## 上限と失敗時
 *
 * ⚠ ページ描画の中で外部 API を叩くので、上限と締切を必ず持つこと。
 * 解決できなければ元の名前がそのまま出る (この機能は装飾)。
 * ID → 名前はプロセス内に 7 日キャッシュされるので、2 回目以降は
 * ネットワークに出ない。
 */

/** 1 回の描画で引く action ID の上限 (= XIVAPI 2 リクエストぶん)。 */
const MAX_IDS = 100;
/** 描画を待たせない締切。超えたら諦めて元の名前で出す。 */
const BUDGET_MS = 2_500;

export async function localizeWipeAbilities(
  wipes: Array<WipeSummary | null | undefined>,
  locale: Locale,
): Promise<void> {
  const targets: WipeSummary[] = [];
  const ids = new Set<number>();
  for (const w of wipes) {
    if (!w) continue;
    const already = locale === "ja" ? w.ja : w.en;
    if (already) continue;
    if (typeof w.id !== "number" || w.id <= 0) continue;
    if (!needsLookup(w.ability, locale)) continue;
    targets.push(w);
    ids.add(w.id);
    if (ids.size >= MAX_IDS) break;
  }
  if (ids.size === 0) return;

  try {
    const names = await resolveActionNames(
      [...ids],
      locale,
      Date.now() + BUDGET_MS,
    );
    if (names.size === 0) return;
    for (const w of targets) {
      if (typeof w.id !== "number") continue;
      const name = names.get(w.id);
      if (!name || name === w.ability) continue;
      if (locale === "ja") w.ja = name;
      else w.en = name;
    }
  } catch (e) {
    console.warn("[wipe-ability-names] failed — 技名は元のまま:", e);
  }
}
