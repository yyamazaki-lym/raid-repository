/**
 * マクロ同士の「差分の要点」 (UI-7、2026-09-08)。
 *
 * 複数のマクロ (層ごと / 攻略サイトごと) が並ぶとき、**採用中のものと
 * どこが違うか**を 1 行で言えるようにする。PF から流れてきた別 strat と
 * 自分たちのものを見分けるのが目的 (調査ノート第 4 回 8-3 UI-7)。
 *
 * ## 行の集合として比べる (順番は見ない)
 *
 * マクロは同じ内容でも行の順番が入れ替わることが普通にある
 * (`/p` の並び替え、コメント行の位置)。順番まで差分にすると **ほぼ全部が
 * 「違う」になって役に立たない**ので、**行の多重集合**として比べる。
 *
 * ## 表示のための正規化だけを行う
 *
 * 比較キーは「前後の空白を落として全角空白を半角に」まで。マクロ記号
 * (`/p` 等) や絵文字は落とさない — 落とすと「/p と /say の違い」や
 * 「マーカーの絵文字違い」が見えなくなり、それこそが strat の違いである
 * ことが多い。
 *
 * 検証: `node scripts/check-macro-diff.mjs`
 */

export type MacroDiff = {
  /** 両方にある行数 (多重集合として)。 */
  same: number;
  /** 採用中にしか無い行 (この案では消えている)。 */
  onlyInBase: string[];
  /** この案にしか無い行 (採用中には無い)。 */
  onlyInOther: string[];
  /** 差分の合計行数 (`onlyInBase + onlyInOther`)。 */
  changed: number;
  /** 空行と空白だけの行を除いた比較対象の行数 (採用中 / この案)。 */
  baseLines: number;
  otherLines: number;
};

/** 比較キー: 前後の空白を落とし、全角空白を半角にする。空行は捨てる。 */
function toKeys(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/　/g, " ").trim())
    .filter((l) => l.length > 0);
}

/**
 * 採用中 (`base`) と比べた差分。
 *
 * 同じ行が複数ある場合は**回数まで見る** (多重集合)。「同じ行を 2 回書く」
 * のはマクロでは意味のある違い (2 回コールする) なので、集合に畳まない。
 */
export function diffMacroBodies(base: string, other: string): MacroDiff {
  const baseKeys = toKeys(base);
  const otherKeys = toKeys(other);
  const remaining = new Map<string, number>();
  for (const k of baseKeys) remaining.set(k, (remaining.get(k) ?? 0) + 1);

  let same = 0;
  const onlyInOther: string[] = [];
  for (const k of otherKeys) {
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      same += 1;
    } else {
      onlyInOther.push(k);
    }
  }
  const onlyInBase: string[] = [];
  for (const [k, n] of remaining) {
    for (let i = 0; i < n; i++) onlyInBase.push(k);
  }
  // 出現順を保つ: onlyInBase は base の並びで出す (Map の反復順は挿入順
  // なので base の初出順になるが、同一行の重複分がまとまる点だけ違う)。
  return {
    same,
    onlyInBase,
    onlyInOther,
    changed: onlyInBase.length + onlyInOther.length,
    baseLines: baseKeys.length,
    otherLines: otherKeys.length,
  };
}

/**
 * 一覧に出す短い要点 (「採用中と同じ」/「+2 / -1 行」)。
 *
 * 文字列の組み立ては呼び出し側 (i18n) に任せ、ここは数だけ返す。
 */
export function macroDiffSummary(diff: MacroDiff): {
  identical: boolean;
  added: number;
  removed: number;
} {
  return {
    identical: diff.changed === 0,
    added: diff.onlyInOther.length,
    removed: diff.onlyInBase.length,
  };
}
