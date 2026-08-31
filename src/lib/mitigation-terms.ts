/**
 * 軽減表でよく使われる英語表記の日本語化 (2026-08-30 実機要望
 * 「シートに書かれている Calculate Mitigation などの英語を日本語表記に」)。
 *
 * 対象はテンプレート由来の**定型語だけ**。固定ごとに自由に書かれる技名や
 * 担当者名は触らない (勝手に別語へ置換すると原本と食い違って事故になる)。
 * 辞書に無い語はそのまま返す。
 *
 * 外部依存なしの純関数。
 */

/** 見出し・値に現れる定型語 (小文字化して比較)。 */
const TERMS: Record<string, string> = {
  // 構造列
  phase: "フェーズ",
  time: "時刻",
  action: "攻撃",
  ability: "アビリティ",
  mechanic: "ギミック",
  type: "種別",
  target: "対象",
  // ダメージ系
  damage: "ダメージ",
  "raw damage": "素ダメージ",
  "total damage": "合計ダメージ",
  "final damage": "最終ダメージ",
  "damage taken": "被ダメージ",
  "damage after mitigation": "軽減後ダメージ",
  hit: "被弾",
  hits: "被弾数",
  // 軽減系
  mitigation: "軽減",
  "calculate mitigation": "軽減計算",
  "calculated mitigation": "軽減計算",
  "total mitigation": "合計軽減",
  "mitigation rate": "軽減率",
  mitigated: "軽減後",
  reduction: "軽減",
  barrier: "バリア",
  shield: "バリア",
  healing: "回復",
  heal: "回復",
  // 種別の値
  magic: "魔法",
  magical: "魔法",
  physical: "物理",
  darkness: "特殊",
  unaspected: "無属性",
  auto: "オートアタック",
  "auto attack": "オートアタック",
  aoe: "全体",
  raidwide: "全体攻撃",
  tankbuster: "タンク強攻撃",
  // その他よく出るもの
  hp: "HP",
  "max hp": "最大HP",
  "remaining hp": "残HP",
  note: "メモ",
  notes: "メモ",
};

/**
 * 定型語なら日本語にする。
 *
 * - 完全一致のみ (部分置換はしない — 「Damage Check」のような複合語を
 *   壊さないため)
 * - 前後の空白は無視、大文字小文字も無視
 * - 辞書に無ければ元の文字列をそのまま返す
 */
export function translateMitigationTerm(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return raw;
  return TERMS[key] ?? raw;
}

/** 英字を含むか (日本語化を試す価値がある文字列かの粗い判定)。 */
export function hasLatinLetters(s: string): boolean {
  return /[A-Za-z]/.test(s);
}
