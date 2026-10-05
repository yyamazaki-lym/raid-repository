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
