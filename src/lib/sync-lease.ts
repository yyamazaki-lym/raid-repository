/**
 * FFLogs 同期の同時実行を 1 本に絞る lease (2026-10-01 監査 C-5)。
 *
 * ## 直した問題
 *
 * FFLogs 同期は 5 つの経路から起動する (日次 cron / Discord 取り込み直後の
 * 自動起動 / 設定画面の「FFLogs と動画を連動」「ログを同期」/ 取り込み後の
 * 同期)。ロックが無く、手動と cron が重なると:
 *   - リンク段の「auto リンクを消して付け直す」が 2 本同時に走る
 *     (結果は収束するが、FFLogs の API と scrape-proxy の枠を 2 倍使う)
 *   - pull 取り込み段の Discord 通知 (新レポート / ベスト更新) が二重になり得る
 *
 * ## 仕組み
 *
 * `app_settings` の 1 行 (key = 段ごとのロック名) に `<期限の ISO>|<token>`
 * を書けた実行だけが進む。期限切れの行は次の実行が取り直せる (関数が途中で
 * kill されてもロックが残り続けない)。ISO 文字列は同じ長さなので、
 * `value < 今の ISO` の文字列比較で「期限切れ」を判定できる。
 *
 * 取り合いは 3 段の条件付き書き込みで、どれも 1 文なので Postgres の
 * 行ロックで直列化される (`marker-claim.ts` と同じ考え方)。
 *
 * ⚠ import を持たない純モジュール (`scripts/check-sync-lease.mjs` が偽の行で
 *   取り合いを再現して検査する)。
 */

/** ロックの有効期間。Vercel の maxDuration (300s) より長く取る。 */
export const SYNC_LEASE_TTL_MS = 6 * 60 * 1000;

export type LeaseOps = {
  /** 行があり、値が `nowIso` より小さい (= 期限切れ) とき `value` に書き換える。 */
  takeExpired: (value: string, nowIso: string) => Promise<boolean>;
  /** 行があり、値が NULL のとき `value` に書き換える。 */
  takeNull: (value: string) => Promise<boolean>;
  /** 行が無いとき `value` で作る。 */
  insertIfAbsent: (value: string) => Promise<boolean>;
};

/** ロック行に書く値。先頭が期限の ISO なので文字列比較で期限を判定できる。 */
export function leaseValue(expiresAtMs: number, token: string): string {
  return `${new Date(expiresAtMs).toISOString()}|${token}`;
}

/**
 * ロックを取れたら書いた値 (解放に使う) を、他の実行が持っていたら null を
 * 返す。各段の DB エラーは throw させる (呼び出し側で扱いを決める)。
 */
export async function acquireLease(
  ops: LeaseOps,
  nowMs: number,
  token: string,
  ttlMs: number = SYNC_LEASE_TTL_MS,
): Promise<string | null> {
  const value = leaseValue(nowMs + ttlMs, token);
  const nowIso = new Date(nowMs).toISOString();
  if (await ops.takeExpired(value, nowIso)) return value;
  if (await ops.takeNull(value)) return value;
  if (await ops.insertIfAbsent(value)) return value;
  return null;
}
