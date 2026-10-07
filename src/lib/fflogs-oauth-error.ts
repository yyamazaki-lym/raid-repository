/**
 * FFLogs OAuth の失敗を、画面へ戻す URL (`?fflogs_oauth_error=`) に載せる
 * コード (2026-10-07 セキュリティ精査)。
 *
 * 以前は失敗理由の文そのものを URL に載せ、設定ダイアログがそれをトーストに
 * 出していた。そのため誰でも `/?fflogs_oauth_error=<任意の文>` のリンクで、
 * 正規のドメイン上に任意の案内文を出せた (2026-08-05 の L-7 と同じ型)。
 * URL にはこのコードだけを載せ、文言は画面側の辞書で引く。知らない値は
 * 「連携に失敗しました」の固定文言にする。詳しい理由はサーバーのログに出す。
 *
 * 純モジュール (client / server の両方から読む)。
 */
export const FFLOGS_OAUTH_ERROR_CODES = [
  /** FFLogs 側で連携を拒否された (`?error=access_denied` など)。 */
  "denied",
  /** FFLogs からの戻りに code / state が無い。 */
  "missing_params",
  /** state が cookie と一致しない (改ざん・失効・別タブから)。 */
  "state_mismatch",
  /** OAuth クライアントの env が未設定。 */
  "not_configured",
  /** token 交換でクライアント認証に失敗 (401 / invalid_client)。 */
  "client_auth",
  /** token 交換がそれ以外の HTTP エラー。 */
  "exchange_failed",
  /** token の応答が想定外の形。 */
  "bad_response",
  /** token を暗号化して保存できなかった。 */
  "persist_failed",
  /** FFLogs への接続そのものが失敗 (タイムアウトなど)。 */
  "network",
] as const;

export type FflogsOauthErrorCode = (typeof FFLOGS_OAUTH_ERROR_CODES)[number];

const CODE_SET = new Set<string>(FFLOGS_OAUTH_ERROR_CODES);

export function isFflogsOauthErrorCode(
  v: string | null | undefined,
): v is FflogsOauthErrorCode {
  return typeof v === "string" && CODE_SET.has(v);
}
