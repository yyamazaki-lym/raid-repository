/**
 * pull の詳細 (PT DPS・死亡数・ワイプ原因) が取れなかったレポートを取り直す印
 * (2026-10-05、精査「練習ログの解析が空」)。
 *
 * 詳細は FFLogs の Summary table を pull ごとに引く (`fetchFightDetails`) が、
 * HTTP エラー・429・タイムアウト・時間切れで途中から取れないことがある。以前は
 * 取れなかった pull を詳細なしで保存し、台帳を「同期済み (ok)」にしていたため、
 * 14 日を過ぎたレポートは二度と取り直されず、死亡数・ワイプ原因が空のまま残った。
 *
 * 台帳 (`fflogs_report_syncs.reason`、ok の行では使っていなかった列) に
 * `details-missing:<取れなかった pull 数>:<試した回数>` を書き、次の同期で
 * 日付に関係なく取り直す。同じレポートで取れ続けない (FFLogs 側に詳細が無い等)
 * ときのために、取り直しは `MAX_DETAIL_RETRIES` 回までにする。schema の変更は無い。
 * FFLogs が保管扱いにしたレポートは取り直さない (下の `DETAILS_ARCHIVED_PREFIX`)。
 *
 * `@/` を import しない純モジュール (`scripts/check-fflogs-detail-retry.mjs`)。
 */

export const DETAILS_MISSING_PREFIX = "details-missing";
/** 詳細が取れなかったレポートを取り直す回数の上限。 */
export const MAX_DETAIL_RETRIES = 3;

/** 台帳の reason から、取れなかった pull 数と試した回数を読む。印でなければ null。 */
export function parseDetailsMissing(
  reason: string | null | undefined,
): { missing: number; attempts: number } | null {
  const m = /^details-missing:(\d+):(\d+)$/.exec(reason ?? "");
  if (!m) return null;
  return { missing: Number(m[1]), attempts: Number(m[2]) };
}

/**
 * 今回の同期の後に台帳へ書く reason。全部取れたら null (印を消す)。
 * 取れなかったら、前回の印の回数に 1 を足した印。
 */
export function detailsMissingReason(
  missing: number,
  prevReason: string | null | undefined,
): string | null {
  if (!(missing > 0)) return null;
  const attempts = (parseDetailsMissing(prevReason)?.attempts ?? 0) + 1;
  return `${DETAILS_MISSING_PREFIX}:${missing}:${attempts}`;
}

/** 次の同期で取り直すか (印があり、上限に届いていない)。 */
export function shouldRetryMissingDetails(reason: string | null | undefined): boolean {
  const p = parseDetailsMissing(reason);
  return p !== null && p.attempts < MAX_DETAIL_RETRIES;
}

/**
 * FFLogs が保管扱い (archive) にしたレポート (2026-10-06)。
 *
 * 古いレポート (本番では 2022 年のもの) は、fights の一覧は返るが Summary
 * table を `This report has been archived. Subscribing users can access the
 * report content via the /user API endpoint.` で断る。FFLogs は古いログを
 * 有料会員にだけ見せる扱いにしているので、**取り直しても結果は変わらない**。
 * `details-missing` の印にすると 3 回取り直して同期の枠を使うため、別の印
 * `details-archived:<取れなかった pull 数>` を書き、取り直さない
 * (`shouldRetryMissingDetails` はこの印を読まない)。
 */
export const DETAILS_ARCHIVED_PREFIX = "details-archived";
const ARCHIVED_REPORT_RE = /has been archived/i;

/** FFLogs の応答のエラー文が「保管扱い」か。 */
export function isArchivedReportError(message: string | null | undefined): boolean {
  return ARCHIVED_REPORT_RE.test(message ?? "");
}

/**
 * 今回の同期の後に台帳へ書く reason (保管扱いを含めた入口)。
 * 保管扱いなら取り直さない印、そうでなければ `detailsMissingReason`。
 */
export function detailsLedgerReason(
  missing: number,
  prevReason: string | null | undefined,
  archived: boolean,
): string | null {
  if (!(missing > 0)) return null;
  if (archived) return `${DETAILS_ARCHIVED_PREFIX}:${missing}`;
  return detailsMissingReason(missing, prevReason);
}
