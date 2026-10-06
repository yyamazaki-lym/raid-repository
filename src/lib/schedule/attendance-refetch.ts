import {
  DETAILS_ARCHIVED_PREFIX,
  MAX_REFETCH_FAILURES,
  VIA_FALLBACK_MARK,
  refetchFailureCount,
} from "../fflogs-detail-retry";
import { isPermanentSyncFailure } from "../fflogs-sync-reason";

/**
 * 出席の突合のための取り直し (2026-10-06) で、どのレポートを取り直すかを
 * 決める純粋ロジック。DB / fetch に触らない (`scripts/check-attendance-refetch.mjs`)。
 *
 * ## なぜ要るか
 *
 * 参加者名は保存しない (W-6 / schema.sql 6b-9) ので、メンバーの「ログ名」を
 * 後から入れても、突合は**レポートを取り直さないとやり直せない**。通常の
 * 同期が取り直すのは直近 14 日だけなので、それより前の日は出席サマリーの
 * 窓 (90 日) の中にあっても「紐づけられなかった日」のまま残っていた
 * (本番 2026-10-06: ログ名が空だった間の 16 日)。
 *
 * ## 選び方
 *
 * - 窓の中のレポートで、突合の行 (`fflogs_attendance_actuals`) が 1 つも無いもの
 * - **恒久的な**取得失敗 (private など、`isPermanentSyncFailure`) は外す —
 *   取り直しても読めない。一時的な失敗 (5xx・タイムアウト) は残す: 動画や
 *   日程に紐づかないレポートは通常の同期が再試行しないので、ここで外すと
 *   二度と取り直されない (マージ前レビュー)
 * - FFLogs の保管扱い (`details-archived`) は参加者名も返らないので外す
 * - **直前に取り直したばかり** (`RECENT_REFETCH_MS` 以内) のレポートは外す。
 *   固定外の人しか映っていないレポートなど、取り直しても紐づかないものが
 *   新しい順の先頭に居座ると、何度押しても古い日に届かないため
 * - 新しい順に `limit` 件。残りは件数だけ返す (もう一度押すと続きを取る)
 *
 * ## 2026-10-06 の追加
 *
 * - `includeMatched`: 突合の行があるレポートも選ぶ。一部のメンバーだけ
 *   「ログ名」を後から入れた場合、他の人が紐づいている日は上の条件では
 *   選ばれず、その人の古い日が数え直されなかった。30 分の間隔があるので、
 *   押すたびに次の 25 件へ進む
 * - 代替経路 (v1 / cookie) でしか読めなかったレポート (`via-fallback`) は外す。
 *   参加者名を取れないので、取り直しても紐づかない
 * - 取り直しの一時的な失敗が続いたレポート (`refetch-failed:<回数>`) は後回しに
 *   し、`MAX_REFETCH_FAILURES` 回で外す (削除済みなどで毎回選ばれて枠を使うため)
 */

/** 直前に取り直したとみなす時間。この間に取り直したレポートは選ばない。 */
export const RECENT_REFETCH_MS = 30 * 60 * 1000;

export type RefetchCandidateReport = {
  reportCode: string;
  /** レポートの最初の pull の開始時刻 (epoch ms)。新しい順に並べるのに使う。 */
  firstStartMs: number;
};

export type RefetchLedgerRow = {
  ok: boolean;
  reason: string | null;
  /** 台帳を最後に書いた時刻 (ISO)。 */
  syncedAt: string | null;
};

export function selectRefetchTargets(input: {
  reports: ReadonlyArray<RefetchCandidateReport>;
  /** 突合の行が 1 つでもあるレポート。 */
  matchedCodes: ReadonlySet<string>;
  ledger: ReadonlyMap<string, RefetchLedgerRow>;
  nowMs: number;
  limit: number;
  /** 突合の行があるレポートも選ぶ (一部の人のログ名を後から入れたとき)。 */
  includeMatched?: boolean;
}): { codes: string[]; remaining: number } {
  const failuresOf = (code: string) =>
    refetchFailureCount(input.ledger.get(code)?.reason);
  const candidates = input.reports
    .filter((r) => {
      if (!input.includeMatched && input.matchedCodes.has(r.reportCode)) return false;
      const row = input.ledger.get(r.reportCode);
      if (!row) return true;
      if (!row.ok && isPermanentSyncFailure(row.reason)) return false;
      if ((row.reason ?? "").startsWith(DETAILS_ARCHIVED_PREFIX)) return false;
      if (row.reason === VIA_FALLBACK_MARK) return false;
      if (refetchFailureCount(row.reason) >= MAX_REFETCH_FAILURES) return false;
      const syncedMs = row.syncedAt ? Date.parse(row.syncedAt) : NaN;
      if (Number.isFinite(syncedMs) && input.nowMs - syncedMs < RECENT_REFETCH_MS) {
        return false;
      }
      return true;
    })
    // 同じレポートが 2 回来ても 1 回だけ取り直す。
    .filter((r, i, all) => all.findIndex((x) => x.reportCode === r.reportCode) === i)
    // 失敗が続いたものを後回しにし、同じ回数どうしは新しい順。
    .sort(
      (a, b) =>
        failuresOf(a.reportCode) - failuresOf(b.reportCode) ||
        b.firstStartMs - a.firstStartMs,
    );
  const limit = Math.max(0, Math.trunc(input.limit));
  const codes = candidates.slice(0, limit).map((r) => r.reportCode);
  return { codes, remaining: candidates.length - codes.length };
}
