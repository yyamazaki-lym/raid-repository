/**
 * FFLogs / XIVAnalysis の URL 変換ヘルパー (TODO #94)。
 *
 * portal 内には FFLogs のレポート URL が
 *   - `category_links.logs_url` (動画に紐づいた report)
 *   - `schedule_past_session_logs.url` / `native_schedule_session_logs.url`
 * の 3 箇所に散らばっている。いずれも「report code」を取り出せば
 *   - fight 単位の FFLogs パーマリンク
 *   - XIVAnalysis の解析ページ
 * を機械的に組み立てられるので、その変換をここに集約する。
 *
 * 外部依存なし・純関数なので client / server の両方から import 可。
 */

/**
 * FFLogs のレポート URL から report code を取り出す。
 *
 * 対応形:
 *   https://www.fflogs.com/reports/aBcD1234efGH5678
 *   https://ja.fflogs.com/reports/aBcD1234efGH5678#fight=3
 *   https://www.fflogs.com/reports/aBcD1234efGH5678?fight=last
 *   https://www.fflogs.com/reports/compare/... → null (code ではない)
 *
 * code は英数字 16 文字前後。将来長さが変わっても壊れないよう
 * `[A-Za-z0-9]{8,}` の緩い判定にしている。
 */
export function parseFflogsReportCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)fflogs\.com$/i.test(u.hostname)) return null;
  const m = /^\/reports\/([A-Za-z0-9]{8,})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  const code = m[1]!;
  // `/reports/` の下には code 以外のルートもある。`rankings` `attendance`
  // `statistics` などは 8 文字以上の英数字なので、長さだけの判定では code
  // として通ってしまい、存在しないレポートの同期失敗行を作ってしまう。
  return REPORT_ROUTE_WORDS.has(code.toLowerCase()) ? null : code;
}

/** `/reports/` 直下に現れる、レポートコードではないルート語。 */
const REPORT_ROUTE_WORDS = new Set([
  "compare",
  "rankings",
  "ranking",
  "attendance",
  "statistics",
  "character",
  "characters",
  "guild",
  "guilds",
  "search",
  "upload",
  "recent",
]);

/**
 * 任意のテキストからレポートコードを一括抽出する (TODO #94 follow-up)。
 *
 * 想定入力: fflogs.com のレポート一覧ページを丸ごとコピペしたテキスト、
 * URL を改行区切りで並べたもの、Discord のログ等。`/reports/<code>` 形式を
 * 全て拾い、ルート語 (rankings 等) を除外して重複を畳む。
 */
export function extractFflogsReportCodes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /reports\/([A-Za-z0-9]{8,32})(?![A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1]!;
    if (REPORT_ROUTE_WORDS.has(code.toLowerCase())) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** report code から FFLogs のレポート URL を組み立てる。 */
export function buildFflogsReportUrl(code: string, fightId?: number | null): string {
  const base = `https://www.fflogs.com/reports/${encodeURIComponent(code)}`;
  return fightId == null ? base : `${base}#fight=${fightId}`;
}

/**
 * XIVAnalysis の解析ページ URL。
 *
 * XIVAnalysis は FFLogs のレポートを読んで「スキル回し / バフ整合 / CD 落ち」を
 * ジョブ別に自動指摘するツール。URL 体系は
 *   https://xivanalysis.com/fflogs/<code>              … fight 選択画面
 *   https://xivanalysis.com/fflogs/<code>/<fightId>    … その pull の解析
 * fightId まで渡せば 1 クリックで該当 pull に着地する。
 *
 * ⚠ 個人の火力を序列化して晒す用途には使わない (調査ノート §1-F の設計原則)。
 * ここで開くのは「自分たちの pull を自分たちで見る」導線のみ。
 */
export function buildXivAnalysisUrl(
  code: string,
  fightId?: number | null,
): string {
  const base = `https://xivanalysis.com/fflogs/${encodeURIComponent(code)}`;
  return fightId == null ? base : `${base}/${fightId}`;
}

/** FFLogs レポート URL を直接 XIVAnalysis の URL に変換 (取れなければ null)。 */
export function toXivAnalysisUrl(
  reportUrl: string | null | undefined,
  fightId?: number | null,
): string | null {
  const code = parseFflogsReportCode(reportUrl);
  return code ? buildXivAnalysisUrl(code, fightId) : null;
}

/**
 * 動画 URL に再生開始秒を付ける。YouTube は `t=`、それ以外は
 * `#t=` (HTML5 media fragment) を使う。非 http(s) は null。
 */
export function buildVideoTimestampUrl(
  videoUrl: string | null | undefined,
  seconds: number,
): string | null {
  if (!videoUrl) return null;
  let u: URL;
  try {
    u = new URL(videoUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const t = Math.max(0, Math.floor(seconds));
  if (/(^|\.)youtube\.com$/i.test(u.hostname) || /(^|\.)youtu\.be$/i.test(u.hostname)) {
    u.searchParams.set("t", `${t}s`);
    return u.toString();
  }
  u.hash = `t=${t}`;
  return u.toString();
}

/** `1:23:45` / `12:34` 形式に整形 (pull の動画内時刻表示用)。 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}
