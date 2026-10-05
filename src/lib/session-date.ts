/**
 * 練習ログの「日」(`fflogs_fights.session_date` など) を JST 暦日 `YYYY-MM-DD` に
 * そろえる (2026-10-05、精査「練習ログの日付の形が経路でまちまち」)。
 *
 * 日程の Logs (`schedule_past_session_logs` / `native_schedule_session_logs`) から
 * 付いたレポートは、日程の rawDate (`2026/10/04(日) 21:30~0:00`) がそのまま
 * `session_date` に入り、それ以外は `2026-10-04` だった。形が混ざると:
 *   - 出席の自動突合の保存が CHECK (20 文字以内) に当たって丸ごと失敗する
 *   - 取り直しの判定 (`isRecent`) が日付を読めず、毎回取り直す
 *   - 練習ログの日が割れ、並び順・トレンド・週のまとめの範囲がずれる
 * rawDate の先頭の日付は「開催日」なので、日付部分だけを取り出せば意味は変わらない。
 *
 * 書式のゆれ (月日 1 桁 / `2026/03/10 (火)` のように括弧の前に空白) も受ける。
 * 日付として読めないものは null (呼び出し側が開始時刻の JST 暦日で補う)。
 *
 * どこからも import しない純モジュール (`scripts/check-session-date.mjs`)。
 */

/** `YYYY-MM-DD` か `YYYY/M/D…` を `YYYY-MM-DD` に。読めなければ null。 */
export function normalizeSessionDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  // 2026/02/30 のような存在しない日は読めないものとして扱う。
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
