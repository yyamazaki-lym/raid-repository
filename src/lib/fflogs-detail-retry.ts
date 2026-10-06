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

/**
 * 代替経路 (v1 / cookie) でしか読めなかったレポートの印 (2026-10-06)。
 *
 * 代替経路では pull の詳細 (参加者名を含む) を取らないので、出席の突合の
 * 取り直しを何度しても紐づかない。印を付けて取り直しの対象から外す
 * (`selectRefetchTargets`)。v2 で読めた同期で印は消える (詳細の印で上書き)。
 */
export const VIA_FALLBACK_MARK = "via-fallback";

/**
 * 出席の突合の取り直し (`preserveExisting`) で、一時的な失敗が続いた回数の印
 * (2026-10-06)。取り直しの失敗は台帳の ok / 日付を書き換えないので、回数だけを
 * 取り込み済み (ok) の行の reason に `refetch-failed:<回数>` で残す。
 * 回数の多いものほど後回しにし、`MAX_REFETCH_FAILURES` 回で対象から外す。
 * 取り込みに成功した同期で reason は書き直されるので印は消える。
 */
export const REFETCH_FAILED_PREFIX = "refetch-failed";
export const MAX_REFETCH_FAILURES = 3;

/** reason から取り直しの失敗回数を読む。印でなければ 0。 */
export function refetchFailureCount(reason: string | null | undefined): number {
  const m = /^refetch-failed:(\d+)$/.exec(reason ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * 取り直しに失敗したときに書く reason。前の reason が空か同じ印のときだけ
 * 回数を足す。他の印 (details-missing / details-archived / via-fallback) は
 * 上書きしない (null を返す = 書かない)。
 */
export function nextRefetchFailedReason(prevReason: string | null | undefined): string | null {
  if (prevReason && refetchFailureCount(prevReason) === 0) return null;
  return `${REFETCH_FAILED_PREFIX}:${refetchFailureCount(prevReason) + 1}`;
}
