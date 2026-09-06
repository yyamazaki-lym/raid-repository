/**
 * FFLogs レポート / fight → portal カテゴリの解決 (純関数、2026-09-06 に
 * `server/fflogs-fights.ts` から切り出し + fight 単位の解決を追加)。
 *
 * ## なぜ fight 単位が要るか (実機: 絶オメガの 2024-07 以降が出ない)
 *
 * FFLogs の zone は拡張ごとに切り直され、旧拡張の絶は現行拡張では
 * **"Ultimates (Legacy)" という 1 つの zone** にまとめられる (Dawntrail 期の
 * 絶バハ / 絶アルテマ / 絶アレキ / 絶竜詩 / 絶オメガはすべて zone 59)。
 * レポートのタイトルも「絶シリーズ（過去）」のように何の絶か書かれない。
 * つまり **レポート単位の zone 名 / タイトルでは分類できない**。
 *
 * 一方 fight (pull) には encounter 名 ("The Omega Protocol" など) が付く
 * ので、fight 名を CONTENT_GROUPS に通せば絶の種類が決まる。レポート単位で
 * 決まらないときは fight ごとに決め、1 レポートに複数の絶が混ざっていても
 * (同じ夜に絶竜詩と絶オメガをやった等) それぞれのカテゴリへ振り分ける。
 *
 * 優先順位:
 *   1. fight 名から一意に決まるカテゴリ (encounter 名は最も具体的な情報)
 *   2. レポート単位の解決 (`resolveCategory`: zone ID → zone 名 / タイトル)
 *   3. 動画リンクなどで portal 側が知っているカテゴリ (`fallback`)
 * 零式の fight 名はボス名 ("Dancing Green" 等) で分類器に当たらないため、
 * 実質的に 1. が効くのは絶だけ。
 */

import { findContentGroups } from "./content-groups";

export type CategoryRef = {
  id: string;
  name: string;
  zoneIds: number[];
  keywords: string[];
};

/** カテゴリ名 + マッチワードが落ちるグループ (呼び出しごとに計算、件数は少ない)。 */
function categoryGroups(c: CategoryRef): Set<number> {
  return findContentGroups([c.name, ...c.keywords].join(" "));
}

/** テキストのグループと重なるカテゴリが **ちょうど 1 つ** ならその id。 */
function uniqueCategoryForText(
  categories: readonly CategoryRef[],
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const groups = findContentGroups(text);
  if (groups.size === 0) return null;
  const hits = categories.filter((c) => {
    for (const g of categoryGroups(c)) if (groups.has(g)) return true;
    return false;
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * レポート → カテゴリの解決。
 *
 * (a) `expected_fflogs_zone_ids` の一致を最優先 (運用者が明示した対応)。
 *     複数カテゴリが同じ zone を持つ (Ultimates (Legacy) を絶カテゴリ全部に
 *     設定した等) 場合は決められないので null → fight 単位に委ねる
 * (b) 次に zone 名 / タイトルの内容分類がカテゴリ名または
 *     `fflogs_match_keywords` と同じグループに落ちるもの
 * どちらも「1 件に定まる」ときだけ採用し、曖昧なら null。
 */
export function resolveCategory(
  categories: readonly CategoryRef[],
  zoneId: number | null,
  zoneName: string | null,
  title: string | null,
): string | null {
  if (zoneId != null) {
    const byZone = categories.filter((c) => c.zoneIds.includes(zoneId));
    if (byZone.length === 1) return byZone[0]!.id;
    if (byZone.length > 1) return null;
  }
  const reportText = [zoneName, title].filter(Boolean).join(" ");
  return uniqueCategoryForText(categories, reportText);
}

/** fight (encounter) 名 → カテゴリ。決まらなければ null。 */
export function resolveCategoryByFightName(
  categories: readonly CategoryRef[],
  fightName: string | null | undefined,
): string | null {
  return uniqueCategoryForText(categories, fightName);
}

/**
 * fight ごとのカテゴリ。fight 名で決まればそれ、決まらなければ
 * `reportCategoryId` (レポート単位の解決結果 / 動画リンク由来)。
 */
export function resolveFightCategory(
  categories: readonly CategoryRef[],
  fightName: string | null | undefined,
  reportCategoryId: string | null,
): string | null {
  return resolveCategoryByFightName(categories, fightName) ?? reportCategoryId;
}

/**
 * レポート台帳に書く代表カテゴリ: fight ごとのカテゴリの最多 (同数なら先に
 * 現れたもの)。すべて null なら null。動画への橋渡し (同日 + 同カテゴリ) や
 * 「未確定レポートの取り直し」判定に使うので、混在レポートでも 1 つに寄せる。
 */
export function consensusCategory(
  fightCategoryIds: ReadonlyArray<string | null>,
): string | null {
  const counts = new Map<string, number>();
  for (const id of fightCategoryIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}
