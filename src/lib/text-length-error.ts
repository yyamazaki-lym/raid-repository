/**
 * 入力の文字数上限エラー文 (2026-09-07)。
 *
 * `category_macros` / `category_waymarks` / `recruitment_templates` /
 * `schedule_session_memos` はいずれも schema 側の CHECK
 * (`*_text_sane`) で本文・ラベル・メモの長さを縛っている。DB が生の
 * Postgres エラーを返す前に、入口で友好的な文言を返すのが各
 * `*-client.ts` の validate 関数の役割。
 *
 * その文言が 4 つの client モジュールに同じ形で重複していて、しかも
 * **日本語固定**だった (表示言語 en でも日本語のトーストが出る)。
 * ここに 1 つ集めて `locale` で切り替える。
 *
 * 純関数モジュールなので辞書 (`@/lib/i18n/messages`) は import しない
 * — client / server / Server Action のどこからでも呼べるようにするため
 * (`url-validation.ts` / `attendance-ui.ts` と同じ方針)。
 *
 * 検証: `node scripts/check-text-length-error.mjs`
 */

/** 上限を持つ入力欄。DB のカラム名ではなく「画面上の欄」の単位。 */
export type TextLengthField = "body" | "label" | "note" | "name";

const FIELD_JA: Record<TextLengthField, string> = {
  body: "本文",
  label: "ラベル",
  note: "メモ",
  name: "名前",
};

const FIELD_EN: Record<TextLengthField, string> = {
  body: "Body",
  label: "Label",
  note: "Note",
  name: "Name",
};

export type TextLengthCheck = {
  field: TextLengthField;
  /** 未入力 (undefined / null) の欄は検査しない (部分更新の patch 用)。 */
  value: string | null | undefined;
  max: number;
};

/**
 * 最初に上限を超えた欄のエラー文を返す。すべて収まっていれば null。
 *
 * 複数の欄が超えていても **1 件だけ**返す — トーストは 1 行で出すので、
 * 「本文とラベルとメモが長すぎます」と並べても直す順番は変わらない。
 * 検査は渡された順なので、呼び出し側が直してほしい順に並べる。
 *
 * 長さは `.length` (UTF-16 単位) で数える。Postgres の `char_length`
 * (コードポイント) 以上の値になるので、ここを通れば DB も通る安全側に
 * 倒れる (サロゲートペアの絵文字は 2 と数えるため厳しめに出る)。
 */
export function textLengthError(
  checks: ReadonlyArray<TextLengthCheck>,
  locale: "ja" | "en" = "ja",
): string | null {
  for (const c of checks) {
    if (c.value == null) continue;
    if (c.value.length <= c.max) continue;
    return locale === "en"
      ? `${FIELD_EN[c.field]} is too long (max ${c.max} characters)`
      : `${FIELD_JA[c.field]}が長すぎます（最大 ${c.max} 文字）`;
  }
  return null;
}

/**
 * 権限が無い / 行が見つからないときの文言。
 *
 * PostgREST は RLS の USING で弾かれた UPDATE / DELETE を**エラーでは
 * なく 0 件**で返すので、呼び出し側は「更新できたのに 0 件」を失敗として
 * 扱う必要がある。原因は権限のことがほとんどだが、他人が同時に消した
 * 場合も同じ形になるため断定しない文言にしている。
 */
export function noPermissionError(
  action: "update" | "delete",
  locale: "ja" | "en" = "ja",
): string {
  if (locale === "en") {
    return action === "update"
      ? "Could not update it (you may not have permission)"
      : "Could not delete it (you may not have permission)";
  }
  return action === "update"
    ? "更新できませんでした（権限がない可能性があります）"
    : "削除できませんでした（権限がない可能性があります）";
}
