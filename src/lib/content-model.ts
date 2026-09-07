/**
 * コンテンツの「難易度」と「進行モデル」(W-33 ①、2026-09-07)。
 *
 * ## なぜ要るか
 *
 * 練習ログはこれまで **カテゴリ名の文字列マッチ**だけで挙動を決めていた:
 *
 *   - `isUltimateContent(name)` → true ならフェーズ (P1〜) 管理、false なら層管理
 *   - `isSavageContent(name)` → true なら「4 層構成」として層クラスタを作る
 *
 * 8.0「白銀のワンダラー」(2027-01) では **ノーマルと零式の中間の新難易度**が
 * 入り、2026-09 時点で**正式名称が未発表**です (調査ノート第 4 回 5-2)。名前が
 * 分からないものは辞書に足せないので、新難易度のカテゴリを作った瞬間に
 * 「層でもフェーズでもない」判定になり、層クラスタが崩れた表示になります。
 * さらに、既存でも判定を外す名前 (英語名だけで登録した / 通称で登録した) を
 * 人が直す手段がありませんでした。
 *
 * そこで **enum を増やさず**、カテゴリごとに
 *
 *   - `progressModel`: `auto` (名前から推測 = 従来) / `floors` / `phases`
 *   - `difficultyLabel`: 表示用の自由記述 (「零式」「絶」「新難易度 (仮)」…)
 *
 * を持てるようにしました。調査ノートの「名称・仕様が未確定 → enum 固定にせず
 * 設定値で吸収」という判断そのものです。8.0 の名前が判明したら
 * `content-groups.ts` の辞書に足せば `auto` のままで通るようになり、それまでは
 * 明示指定で運用できます。
 *
 * 検証: `node scripts/check-content-model.mjs`
 */

import { isSavageContent, isUltimateContent } from "./content-groups";

/** カテゴリごとの進行モデル指定。DB の `categories.progress_model`。 */
export const PROGRESS_MODELS = ["auto", "floors", "phases"] as const;
export type ProgressModel = (typeof PROGRESS_MODELS)[number];

export function isProgressModel(v: unknown): v is ProgressModel {
  return (
    typeof v === "string" && (PROGRESS_MODELS as readonly string[]).includes(v)
  );
}

/** 難易度ラベルの最大長 (DB の CHECK と揃える)。 */
export const DIFFICULTY_LABEL_MAX_LENGTH = 24;

/**
 * 実際に使う進行モデル。`auto` のときだけ名前から推測する。
 *
 * 戻り値は 2 値 — 「層」か「フェーズ」のどちらかで表示を組む必要があり、
 * 「不明」という第 3 の状態を UI に持ち込むと分岐が倍になる。名前から
 * 何も分からないときは **層** に倒す (零式・ノーマル・アライアンスが
 * 多数派で、フェーズ管理は絶だけという実運用に合わせる)。
 */
export function resolveProgressModel(
  model: ProgressModel | null | undefined,
  categoryName: string,
): "floors" | "phases" {
  if (model === "floors" || model === "phases") return model;
  return isUltimateContent(categoryName) ? "phases" : "floors";
}

/**
 * 層クラスタを作るときに想定する層数 (null = 実データの encounter 連番から
 * 推測する = 従来挙動)。
 *
 * 零式ティアは 4 層固定なので、`buildFloorMap` に 4 を渡すと「実データに
 * 3 層しか出ていない時期でも 4 層構成として扱う」ことができる。
 * 8.0 の新難易度は層数が未発表なので、**明示指定 (`floors`) のときは
 * null** にして実データから推測させる — 4 を決め打ちすると、もし 1 ボスの
 * コンテンツだった場合に最終層の判定 (= クリア数の数え方) が壊れる。
 */
export function resolveFloorCount(
  model: ProgressModel | null | undefined,
  categoryName: string,
): number | null {
  if (resolveProgressModel(model, categoryName) === "phases") return null;
  // 名前から零式と分かるときだけ 4 層を仮定する (従来と同じ)。
  if (model === "floors" && !isSavageContent(categoryName)) return null;
  return isSavageContent(categoryName) ? 4 : null;
}

/**
 * 表示用の難易度ラベル。明示設定があればそれ、無ければ名前から推測。
 * どちらも決まらなければ null (バッジを出さない)。
 *
 * 推測は「絶」「零式」の 2 つだけ — ノーマルやアライアンスは名前に難易度が
 * 現れないことが多く (「万魔殿パンデモニウム」だけ等)、推測を増やすと
 * 外れたバッジが出る。
 */
export function resolveDifficultyLabel(
  explicit: string | null | undefined,
  categoryName: string,
  locale: "ja" | "en" = "ja",
): string | null {
  const label = (explicit ?? "").trim();
  if (label) return label;
  if (isUltimateContent(categoryName)) return locale === "en" ? "Ultimate" : "絶";
  if (isSavageContent(categoryName)) return locale === "en" ? "Savage" : "零式";
  return null;
}

/**
 * 難易度バッジの配色。既知の難易度は固定色、それ以外 (8.0 の新難易度を
 * 含む) はラベルのハッシュで決める — 名前が分かる前から色が付き、判明後も
 * 同じ色のままになる。
 */
export function difficultyToneClass(label: string | null): string {
  const key = (label ?? "").trim();
  if (!key) return "border-border/50 text-muted-foreground";
  if (/絶|ultimate/i.test(key)) {
    return "border-amber-400/45 bg-amber-400/10 text-amber-200";
  }
  if (/零式|savage/i.test(key)) {
    return "border-rose-400/45 bg-rose-400/10 text-rose-200";
  }
  if (/ノーマル|normal|アライアンス|alliance/i.test(key)) {
    return "border-sky-400/45 bg-sky-400/10 text-sky-200";
  }
  const palette = [
    "border-violet-400/45 bg-violet-400/10 text-violet-200",
    "border-teal-400/45 bg-teal-400/10 text-teal-200",
    "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-200",
    "border-emerald-400/45 bg-emerald-400/10 text-emerald-200",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return palette[hash % palette.length]!;
}
