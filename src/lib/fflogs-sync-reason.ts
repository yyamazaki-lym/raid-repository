/**
 * FFLogs fights 同期の失敗理由まわりの共有定義 (TODO #94 follow-up)。
 *
 * `server/fflogs-fights.ts` (保存側) と `logs-view.tsx` (表示側 = client
 * component) の両方から使うため、`server-only` を含まないモジュールに
 * 切り出している。
 */

/**
 * FFLogs v2 が返す「アクセス権なし」エラー。private レポートは
 * **アップロード者本人が OAuth 認可していないと読めない** ため、固定
 * メンバーの誰かが private でアップしたレポートはこのエラーになる
 * (2026-08-28 実機で確認: 絶竜詩の 3 レポートが該当)。再試行しても
 * 結果は変わらない恒久エラーとして扱う。
 */
export const PERMISSION_ERROR_RE =
  /do(es)? not ha(ve|s) permission|did not grant|permission to view/i;

export const PRIVATE_REPORT_REASON =
  "非公開 (private) レポートのため取得できません — アップロードした本人の " +
  "FFLogs アカウントで連携するか、レポートの公開設定を unlisted / public に" +
  "すると取り込めます (設定で FFLogs の session cookie を登録している場合は" +
  "自動で再試行します)";

/** 保存済みの英文エラーも表示前に日本語へ寄せる (既存行の後方互換)。 */
export function humanizeFflogsSyncReason(
  reason: string | null,
): string | null {
  if (!reason) return null;
  if (PERMISSION_ERROR_RE.test(reason)) return PRIVATE_REPORT_REASON;
  return reason;
}
