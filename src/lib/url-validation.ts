/**
 * http(s) URL の形式チェック (TODO #51 P2-6)。
 *
 * 各 form の submit 時バリデーションと、input の onBlur 即時バリデーション
 * (aria-invalid + inline field error) で共用する。
 *
 * 戻り値はエラー文言 (日本語) または null (valid)。空文字 / 空白のみは
 * 「未入力」として null を返す — 必須チェックは呼び出し側の責務 (任意
 * 入力の FFLogs URL 等で「空 = エラーなし」をそのまま使えるように)。
 */
export function httpUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return "http:// または https:// で始めてください";
  }
  try {
    new URL(trimmed);
  } catch {
    return "URLの形式が正しくありません";
  }
  return null;
}
