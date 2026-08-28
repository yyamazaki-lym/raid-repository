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

// 2026-08-28 実機 + 調査で確定した FFLogs の visibility セマンティクス:
// - 「一覧」(reports/user) は public のみ。unlisted / private は一覧に出ない
// - 「個別取得」(report/fights/{code}) は **unlisted なら code を知っていれば
//   読める** (xivanalysis が unlisted ログを解析できるのはこの経路)。
//   private は本人の OAuth 連携以外では読めない
// - session cookie の scrape 経路は Cloudflare の bot 対策で 403 になる
//   ことがある (Edge IP でも実測)
// portal は動画リンク / 日付メモで code を知っているので、unlisted は
// FFLOGS_API_KEY (v1) fallback で取得できる。この文言が出るのは
// それでも読めなかった = private (または v1 キー未設定) のケース。
export const PRIVATE_REPORT_REASON =
  "非公開レポートのため取得できません — unlisted (限定公開) なら Vercel の " +
  "FFLOGS_API_KEY 設定で取得できます。private (非公開) はアップロードした" +
  "本人の OAuth 連携か、レポートを Public / Unlisted に変更すると取り込めます";

/**
 * 試行チェーン付き失敗 reason のプレフィックス (2026-08-28)。
 * 「取得不可」の実機報告で v1 が「未設定でスキップ」なのか「試して失敗」
 * なのか切り分けられなかったため、各経路の結果を reason に全て刻む形に
 * 変更した。恒久失敗判定 (リトライ抑制) はこのプレフィックスで行う。
 */
export const PERMISSION_CHAIN_PREFIX = "非公開レポートの可能性 — ";

/** 恒久失敗 (再試行しても結果が変わらない) かどうかの共通判定。 */
export function isPermanentSyncFailure(reason: string | null): boolean {
  if (!reason) return false;
  return (
    PERMISSION_ERROR_RE.test(reason) ||
    reason === PRIVATE_REPORT_REASON ||
    reason.startsWith(PERMISSION_CHAIN_PREFIX)
  );
}

/** 保存済みの英文エラーも表示前に日本語へ寄せる (既存行の後方互換)。 */
export function humanizeFflogsSyncReason(
  reason: string | null,
): string | null {
  if (!reason) return null;
  if (PERMISSION_ERROR_RE.test(reason)) return PRIVATE_REPORT_REASON;
  return reason;
}
