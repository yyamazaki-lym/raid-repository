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

/**
 * Logs URL の「同一レポート判定」キー (2026-08-30、08/29 二重取り込み対策)。
 *
 * 同じレポートでも URL 文字列は `#fight=3` / `?fight=last` / `ja.` サブ
 * ドメインなどで揺れる。素の文字列比較で dedup / UNIQUE(raw_date, url)
 * すると同一レポートが 2 件として取り込まれるため、比較はこのキーで行う:
 *   - レポート URL として解釈できれば `report:<code>` (揺れを吸収)
 *   - できなければ trim した URL そのまま (非 fflogs URL の従来挙動を維持)
 */
export function fflogsLogDedupeKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const code = parseFflogsReportCode(trimmed);
  return code ? `report:${code}` : trimmed;
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

/**
 * FFLogs のレポート一覧ページから全レポート URL を一括コピーする
 * ブックマークレット (2026-08-28)。
 *
 * 一覧ページのリンクはテキストがコンテンツ名 (「クルーザー級」等) で、
 * URL は href の中にしか無い — ページを Ctrl+A でコピーしても URL は
 * 取れない (実機で確認)。ブラウザのブックマークにこの文字列を URL として
 * 登録し、fflogs.com の一覧ページ上で実行すると、表示中の全レポート URL が
 * クリップボードに入る。ユーザーのブラウザ内 (= 本人のセッション) で
 * 動くので、unlisted / private の一覧もそのまま拾える。
 */
export const FFLOGS_REPORT_LINKS_BOOKMARKLET =
  "javascript:(()=>{const s=new Set();for(const a of document.querySelectorAll('a[href*=\\\"/reports/\\\"]')){const m=a.href.match(/reports\\/([A-Za-z0-9]{8,32})(?![A-Za-z0-9])/);if(m&&!/^(rankings|ranking|attendance|statistics|compare|guilds?|characters?|search|upload|recent)$/i.test(m[1]))s.add('https://www.fflogs.com/reports/'+m[1])}const t=[...s].join('\\n');if(!t){alert('レポート URL が見つかりません');return}(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>alert(s.size+' 件のレポート URL をコピーしました'),()=>prompt('自動コピーできませんでした。以下を手動でコピーしてください:',t))})();";

/** report code から FFLogs のレポート URL を組み立てる。 */
export function buildFflogsReportUrl(code: string, fightId?: number | null): string {
  // 日本語 UI で開く (2026-08-30)。DB に保存する URL は www のままで、
  // ここで作るのは「開くためのリンク」なので ja を既定にする。
  const base = `https://ja.fflogs.com/reports/${encodeURIComponent(code)}`;
  return fightId == null ? base : `${base}#fight=${fightId}`;
}

/**
 * FFLogs を日本語 UI で開く (2026-08-30 実機報告「英語表記になるのが気になる」)。
 *
 * FFLogs は言語別サブドメインを持ち、`ja.fflogs.com` で開くと UI が日本語に
 * なる。保存済み URL (`www.fflogs.com`) はそのままに、**開くときだけ**
 * ホストを差し替える (DB の値を書き換えると、外部で共有された URL との
 * 見た目の一致が崩れるため)。fflogs.com 以外はそのまま返す。
 */
export function toJapaneseFflogsUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)fflogs\.com$/i.test(u.hostname)) return url;
    u.hostname = "ja.fflogs.com";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * FFLogs のビュー種別 (2026-08-30 調査 §2)。レポート URL のハッシュに
 * `type=` を足すと該当ビューで開く。
 *   - deaths       … 死亡一覧 (死亡直前の被ダメ / 回復まで辿れる)
 *   - damage-taken … 被ダメージ (どのギミックで削られたか)
 *
 * ⚠ ハッシュパラメータは公式ドキュメントが無い慣行仕様。将来 FFLogs 側が
 * 変えても、未知の type は無視されてレポート先頭が開くだけ (fail-soft)。
 */
export type FflogsFightView = "deaths" | "damage-taken";

/** fight 単位で特定ビュー (死亡 / 被ダメ) を開く URL。 */
export function buildFflogsFightViewUrl(
  code: string,
  fightId: number | null | undefined,
  view: FflogsFightView,
): string {
  const base = `https://ja.fflogs.com/reports/${encodeURIComponent(code)}`;
  const fight = fightId == null ? "last" : String(fightId);
  return `${base}#fight=${fight}&type=${view}`;
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
