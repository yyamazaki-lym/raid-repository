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

// 2026-08-28 実機確認:
// - unlisted (限定公開) も v2 API では返されない (private と同じ permission
//   エラー)。「unlisted にすれば読める」という案内は誤りだった。
// - session cookie の scrape 経路も Edge IP ごと Cloudflare に 403 で
//   弾かれるようになった (2026-06 実測では通っていた)。cookie は「試みる」
//   手段であり、確実なのはレポートの Public 化のみ。
export const PRIVATE_REPORT_REASON =
  "非公開 (private / unlisted) レポートのため API では取得できません — " +
  "確実な対処はレポートを Public にすること (アップローダの既定公開設定を " +
  "Public にすると以後は自動で取り込めます)。アップロードした本人が " +
  "OAuth 連携している場合はそのままで取得可能です";

/** 保存済みの英文エラーも表示前に日本語へ寄せる (既存行の後方互換)。 */
export function humanizeFflogsSyncReason(
  reason: string | null,
): string | null {
  if (!reason) return null;
  if (PERMISSION_ERROR_RE.test(reason)) return PRIVATE_REPORT_REASON;
  return reason;
}
