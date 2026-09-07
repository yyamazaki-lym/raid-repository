/**
 * レポートの発見元の選択 (W-5、2026-09-07)。
 *
 * portal がどのレポートを取り込むかは、これまで**リンクから逆算**して
 * いた: 動画に貼った FFLogs URL、日付メモの URL、活動日に紐づけた URL。
 * つまり誰かが URL を貼るまで portal はレポートの存在を知らない
 * (調査ノート第 4 回 W-5)。
 *
 * FFLogs の `reportData.reports(...)` を引けば貼らなくても見つかるが、
 * **どこを見るのが正しいかは固定の運用で変わる**:
 *
 *   - FFLogs 上に static (guild) を作って Uploader でそれを選んでいる固定
 *     → guild のレポート一覧が「その固定の全ログ」になる
 *   - guild を作っていない固定 (計測担当が個人アカウントで上げている)
 *     → guild ID が無いので、接続した本人のレポート一覧を見る方が合う
 *
 * どちらかに決め打つと片方の固定では機能しないので、**設定で選べる**形に
 * する (2026-09-07 の実機判断)。
 *
 * ## 既定は `links` (従来のまま)
 *
 * 自動発見を既定にすると、guild で他のコンテンツ (討滅・レイド以外) も
 * 回している固定で無関係なレポートが大量に台帳へ入る。取り込み枠
 * (1 回 40 件) を食う上、未分類レポートの一覧が伸びて診断が読みにくく
 * なる。だから **明示的に選んだときだけ**自動発見する。
 *
 * ## `user` モードの制約
 *
 * `reports(userID:)` は実測で **Public のレポートだけ**を返す
 * (`fflogs.ts` の調査コメント参照)。Unlisted 運用を推奨している
 * (`docs/guides/log-runner.md`) 固定では拾えないので、その場合は
 * guild か従来のリンク経由を使う。UI 側にもこの制約を出す。
 *
 * 検証: `node scripts/check-fflogs-report-source.mjs`
 */

/** `app_settings` のキー。 */
export const FFLOGS_REPORT_SOURCE_KEY = "fflogs_report_source";

export const FFLOGS_REPORT_SOURCES = [
  /** 従来: 動画 / 日付ログに貼られた URL からのみ。 */
  "links",
  /** guild のレポート一覧も見る (guild ID が必要)。 */
  "guild",
  /** 接続した FFLogs アカウントのレポート一覧も見る (Public のみ)。 */
  "user",
] as const;
export type FflogsReportSource = (typeof FFLOGS_REPORT_SOURCES)[number];

/** 既定 (従来の挙動)。 */
export const FFLOGS_REPORT_SOURCE_DEFAULT: FflogsReportSource = "links";

export function isFflogsReportSource(v: unknown): v is FflogsReportSource {
  return (
    typeof v === "string" &&
    (FFLOGS_REPORT_SOURCES as readonly string[]).includes(v)
  );
}

/** 設定値の正規化。未設定・未知の値は既定 (= 従来の挙動) に倒す。 */
export function parseFflogsReportSource(
  raw: string | null | undefined,
): FflogsReportSource {
  const v = (raw ?? "").trim();
  return isFflogsReportSource(v) ? v : FFLOGS_REPORT_SOURCE_DEFAULT;
}

/**
 * 選んだモードが実際に動く状態か。
 *
 * 設定だけして条件が足りていない (guild を選んだのに guild ID が空) と、
 * 「自動発見にしたのに増えない」が起きて原因が見えない。UI と同期処理の
 * 両方でここを通し、足りないものを名前で返す。
 */
export function reportSourceReadiness(input: {
  source: FflogsReportSource;
  guildId: string | null | undefined;
  /** OAuth 接続済みか。 */
  oauthConnected: boolean;
}): { ready: boolean; missing: "guildId" | "oauth" | null } {
  if (input.source === "links") return { ready: true, missing: null };
  // guild / user はどちらも v2 API を叩くので OAuth が必須。
  if (!input.oauthConnected) return { ready: false, missing: "oauth" };
  if (input.source === "guild" && !(input.guildId ?? "").trim()) {
    return { ready: false, missing: "guildId" };
  }
  return { ready: true, missing: null };
}

/** 自動発見を行うモードか (同期処理の分岐用)。 */
export function usesAutoDiscovery(source: FflogsReportSource): boolean {
  return source !== "links";
}

/**
 * 1 回の同期で自動発見に使うレポート件数。
 *
 * 「直近のページ 1 枚」だけ見る。取り込み枠 (1 回 40 件) より多く発見しても
 * その回では取り込めず、次回また同じ一覧を引くので、ページを跨いで漁る
 * 意味が薄い。過去分をまとめて入れたいときは URL 貼り付けの導線がある。
 */
export const AUTO_DISCOVERY_LIMIT = 25;
