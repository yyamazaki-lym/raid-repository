/**
 * 募集文の変数差し込み (W-28、2026-09-07)。
 *
 * 欠員が出たときの野良補充で、募集テンプレの本文に「コンテンツ / フェーズ /
 * 希望武器 / 時間 / DC」を差し込めるようにする。既存の
 * `recruitment_templates` に**変数を足すだけ**で、テーブルは増やさない
 * (調査ノート第 4 回 W-28)。
 *
 * ## 自動と手入力を分ける
 *
 * portal が知っている値 (コンテンツ名・難易度・次回開催の日時・URL) は
 * **自動で埋める**。知りようがない値 (いま練習しているフェーズ・欲しい武器・
 * DC) は **コピー時に人が入れる**。全部を設定にすると「募集のたびに設定を
 * 開いて直す」ことになり、テンプレの意味が薄れる。
 *
 * 手入力の値はブラウザに覚えさせる (呼び出し側の責務) — DC は固定で変わらず、
 * フェーズも数週間は同じなので、毎回打ち直させない。
 *
 * ## 未指定の変数は消さずに残す
 *
 * 値が空の変数は `{phase}` のまま本文に残す。空文字に置き換えると
 * 「P{phase} 練習中」が「P 練習中」になって、貼ってから気付くことになる。
 * 変数が残っていれば貼る前に気付ける。
 *
 * 検証: `node scripts/check-recruitment-placeholders.mjs`
 */

/** 変数の一覧 (UI のヒント表示と検証に使う)。 */
export const RECRUITMENT_PLACEHOLDERS = [
  /** コンテンツ名 (カテゴリ名)。自動。 */
  "content",
  /** 難易度ラベル (零式 / 絶 / 明示設定値)。自動。 */
  "difficulty",
  /** 次回開催の日付表記。自動。 */
  "date",
  /** 次回開催の開始時刻 `HH:MM`。自動。 */
  "time_start",
  /** 次回開催の終了時刻 `HH:MM`。自動。 */
  "time_end",
  /** portal の URL。自動。 */
  "site_url",
  /** 練習中のフェーズ / 層 (例: `P3`, `4層`)。手入力。 */
  "phase",
  /** 希望武器 / ジョブ (例: `零式武器`, `占星`)。手入力。 */
  "weapon",
  /** データセンター (例: `Elemental`)。手入力。 */
  "dc",
] as const;

export type RecruitmentPlaceholder = (typeof RECRUITMENT_PLACEHOLDERS)[number];

/** コピー時に人が入れる変数 (portal が知りようがない値)。 */
export const MANUAL_PLACEHOLDERS: readonly RecruitmentPlaceholder[] = [
  "phase",
  "weapon",
  "dc",
];

export function isRecruitmentPlaceholder(
  v: unknown,
): v is RecruitmentPlaceholder {
  return (
    typeof v === "string" &&
    (RECRUITMENT_PLACEHOLDERS as readonly string[]).includes(v)
  );
}

/**
 * 本文で実際に使われている変数を、`RECRUITMENT_PLACEHOLDERS` の順で返す。
 *
 * UI は「この本文に必要な手入力欄」だけを出したいので、使われていない変数の
 * 入力欄は出さない (`{phase}` を使わないテンプレで フェーズ を聞かない)。
 * 未知の `{foo}` は無視する — テンプレ本文にはゲーム内の記号や絵文字が
 * 入るので、知らない波括弧を変数として扱うと誤検出する。
 */
export function usedPlaceholders(body: string): RecruitmentPlaceholder[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{([a-z_]+)\}/g)) {
    if (isRecruitmentPlaceholder(m[1]!)) found.add(m[1]!);
  }
  return RECRUITMENT_PLACEHOLDERS.filter((p) => found.has(p));
}

/** 本文が手入力を要求しているか (UI がダイアログを出すかの判定)。 */
export function needsManualInput(body: string): RecruitmentPlaceholder[] {
  const used = usedPlaceholders(body);
  return MANUAL_PLACEHOLDERS.filter((p) => used.includes(p));
}

/**
 * 変数を差し込む。
 *
 * - 値が空 / 未指定の変数は **`{name}` のまま残す** (貼る前に気付けるよう)。
 * - 置換は 1 パスで行う。値の中に `{...}` が含まれていても再展開しない
 *   (フェーズに「{P3}」と入れられても無限展開にならない)。
 * - 未知の `{foo}` はそのまま残す。
 */
export function fillRecruitmentTemplate(
  body: string,
  values: Partial<Record<RecruitmentPlaceholder, string | null | undefined>>,
): string {
  return body.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    if (!isRecruitmentPlaceholder(name)) return whole;
    const v = values[name];
    const trimmed = typeof v === "string" ? v.trim() : "";
    return trimmed || whole;
  });
}
