/**
 * TODO #41 (2.1): Server Action から client に返す DB エラー文言を
 * 汎用化するヘルパー。Postgres の生エラー (column 名 / FK 違反 / RLS
 * deny の error code 等) が client に届くと攻撃者に DB スキーマ情報を
 * 渡してしまうため、詳細は server log にだけ残し client には
 * 「{label}に失敗しました」程度の汎用メッセージを返す。
 *
 * UX 上特定エラー (例: duplicate slug) を区別したい場合は呼び出し側で
 * error.code 等を見てから個別に日本語メッセージを返し、それ以外を
 * dbError() に落とすこと。
 */
export function dbError(label: string, error: unknown): string {
  // Server log に詳細を残す (Vercel logs 等で参照可)。
  // Caller の意図を grep で追えるよう [db-error] prefix + label を付ける。
  try {
    const detail =
      error && typeof error === "object" && "message" in error
        ? (error as { message?: unknown }).message
        : error;
    console.warn(`[db-error] ${label}:`, detail);
  } catch {
    // best-effort logging
  }
  return `${label}に失敗しました`;
}
