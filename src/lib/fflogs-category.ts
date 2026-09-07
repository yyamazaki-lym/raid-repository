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

import { findContentGroups, isUltimateContent } from "./content-groups";

/**
 * FFLogs の encounter ID → CONTENT_GROUPS の index (絶のみ、2026-09-07)。
 *
 * 実機の診断で判明: "Ultimates (Legacy)" zone の fight 名は encounter 名
 * ("The Omega Protocol") ではなく **ボス名** ("Omega" / "Omega / Omega-M")
 * だった。名前では絶の種類が決まらないので、encounter ID を最優先の手掛かり
 * にする。ID は FFLogs が拡張ごとに振り直す (同じ絶でも zone が変わると別 ID)。
 *
 * 確認済み: 1077 = 絶オメガ (Dawntrail の Legacy zone 59、実機診断)。
 * Legacy zone は UCOB / UWU / TEA / DSR / TOP の順に連番で振られているので
 * 1073〜1076 をその順に置く。Endwalker 期の ID (1060〜1062 / 1065 / 1068) と
 * 絶もうひとつの未来 (1079) も併記。誤マッピングは別コンテンツへの誤帰属に
 * なるので、確度の低い旧拡張 (ShB / SB) の ID は入れていない — 診断画面で
 * encounter ID が見えるので、必要になったら実機の値を足す。
 */
export const ULTIMATE_ENCOUNTER_GROUPS: Readonly<Record<number, number>> = {
  // Dawntrail — Ultimates (Legacy) zone 59
  1073: 1, // 絶バハムート
  1074: 2, // 絶アルテマウェポン
  1075: 0, // 絶アレキサンダー
  1076: 3, // 絶竜詩戦争
  1077: 4, // 絶オメガ検証戦 (実機確認)
  // Dawntrail — 現行絶
  1079: 5, // 絶もうひとつの未来
  // Endwalker
  1060: 1, // 絶バハムート (EW Legacy)
  1061: 2, // 絶アルテマウェポン (EW Legacy)
  1062: 0, // 絶アレキサンダー (EW Legacy)
  1065: 3, // 絶竜詩戦争
  1068: 4, // 絶オメガ検証戦
};

/**
 * 絶 zone 内でのボス名 → グループ (encounter ID が map に無いときの保険)。
 * "Omega" や "Titan" は零式 / 討滅にも出るので、**zone 名が絶のときだけ** 使う。
 */
const ULTIMATE_BOSS_GROUPS: ReadonlyArray<[RegExp, number]> = [
  [/omega|alpha omega|dynamis/i, 4], // 絶オメガ
  [/thordan|nidhogg|adelphel|grinnaux|charibert|hraesvelgr|eyes|vedrfolnir|dragon/i, 3], // 絶竜詩
  [/twintania|nael|bahamut/i, 1], // 絶バハ
  [/garuda|ifrit|titan|ultima weapon|lahabrea/i, 2], // 絶アルテマ
  [/living liquid|brute justice|cruise chaser|alexander|perfect/i, 0], // 絶アレキ
  [/fatebreaker|usurper|oracle|pandora|gaia|ryne|shiva|eden/i, 5], // 絶もうひとつの未来
];

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

/** グループ index に落ちるカテゴリが **ちょうど 1 つ** ならその id。 */
function uniqueCategoryForGroup(
  categories: readonly CategoryRef[],
  group: number,
): string | null {
  const hits = categories.filter((c) => categoryGroups(c).has(group));
  return hits.length === 1 ? hits[0]!.id : null;
}

/** encounter ID → カテゴリ (絶の既知 ID のみ)。 */
export function resolveCategoryByEncounter(
  categories: readonly CategoryRef[],
  encounterId: number | null | undefined,
): string | null {
  if (typeof encounterId !== "number") return null;
  const group = ULTIMATE_ENCOUNTER_GROUPS[encounterId];
  return group === undefined ? null : uniqueCategoryForGroup(categories, group);
}

/** 絶 zone のボス名 → カテゴリ (zone 名が絶のときだけ)。 */
export function resolveCategoryByUltimateBoss(
  categories: readonly CategoryRef[],
  fightName: string | null | undefined,
  zoneName: string | null | undefined,
): string | null {
  if (!fightName || !zoneName) return null;
  if (!isUltimateContent(zoneName) && !/ultimate|絶/i.test(zoneName)) return null;
  for (const [re, group] of ULTIMATE_BOSS_GROUPS) {
    if (re.test(fightName)) return uniqueCategoryForGroup(categories, group);
  }
  return null;
}

/**
 * fight ごとのカテゴリ。優先順位:
 *   1. encounter ID (絶の既知 ID)
 *   2. fight 名の内容分類 ("The Omega Protocol" 等)
 *   3. 絶 zone 内のボス名 ("Omega" 等、zone が絶のときだけ)
 *   4. `reportCategoryId` (レポート単位の解決結果 / 動画リンク / 取り込み元)
 */
export function resolveFightCategory(
  categories: readonly CategoryRef[],
  fightName: string | null | undefined,
  reportCategoryId: string | null,
  ctx?: { encounterId?: number | null; zoneName?: string | null },
): string | null {
  return (
    resolveCategoryByEncounter(categories, ctx?.encounterId) ??
    resolveCategoryByFightName(categories, fightName) ??
    resolveCategoryByUltimateBoss(categories, fightName, ctx?.zoneName) ??
    reportCategoryId
  );
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
