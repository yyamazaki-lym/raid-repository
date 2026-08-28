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

// 2026-08-28 実機確認: unlisted (限定公開) も v2 API では返されない
// (private と同じ permission エラー)。文言から「unlisted にすれば読める」
// という誤った案内を撤去した。
export const PRIVATE_REPORT_REASON =
  "非公開 (private / unlisted) レポートのため API では取得できません — " +
  "設定の FFLogs 連携で session cookie を登録すると取り込めます " +
  "(アップロードした本人が OAuth 連携している場合は登録不要)";

/** 保存済みの英文エラーも表示前に日本語へ寄せる (既存行の後方互換)。 */
export function humanizeFflogsSyncReason(
  reason: string | null,
): string | null {
  if (!reason) return null;
  if (PERMISSION_ERROR_RE.test(reason)) return PRIVATE_REPORT_REASON;
  return reason;
}
