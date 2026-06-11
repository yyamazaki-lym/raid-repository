"use client";

/**
 * TODO #68 (2026-05-02): TODO #66 後続最適化。
 *
 * fflogs-sync-section.tsx 内に inline していた詳細診断パネル
 * (`logsResult.diag` + `userTypeFields` 描画、~190 行) を別 chunk に
 * 分離。`next/dynamic({ ssr: false })` 経由で「FFLogs 連動を実行して
 * 詳細診断 details を開いた」タイミングでだけ fetch される。通常運用時
 * (連動なし / 連動成功時) には客先ブラウザに転送されない true lazy
 * load。
 *
 * `userTypeFields` は logsResult 直下のフィールドだが UI 上は diag
 * パネル内 nested で描画されるため、props として一緒に受け渡し本
 * component 内で出し分ける。
 *
 * **part10 (2026-05-02)**: 親側で controlled `<details onToggle>` +
 * 条件マウント (`{diagOpen && <FflogsDiagnosticsPanel />}`) する設計に
 * 切替えたため、本 component は **root `<details>` を持たない**。
 * 親が開閉を制御し、本 component は「diag が開かれた瞬間に mount される
 * body 部分」だけを返す。これにより `logsResult.diag` が真値で **かつ**
 * details が開かれた瞬間に初めて chunk fetch される (連動実行のみで
 * 開かない場合は fetch されない)。
 */

export type FflogsDiagInfo = {
  v2RawCount?: number;
  v2OwnedCount?: number;
  v2Me?: { id: number; name: string };
  v2OwnersSample?: Array<{
    id: number | null;
    name: string | null;
    count: number;
  }>;
  htmlPageSize?: number;
  htmlCodesFound?: number;
  cookieUsed?: boolean;
  /** session cookie が scrape 成功により実際に削除されたか (2.8)。 */
  cookieDeleted?: boolean;
  htmlReportCount?: number;
  htmlScrapeError?: string;
  htmlSample?: string;
  videosSkippedNoPostedAt?: number;
  titleDateHitCount?: number;
  titleDateMissCount?: number;
  titleDateMissSample?: string[];
};

export function FflogsDiagnosticsPanel({
  diag,
  userTypeFields,
}: {
  diag: FflogsDiagInfo;
  userTypeFields?: string[];
}) {
  return (
    <div className="mt-1.5 ml-3.5 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
        {diag.v2Me && (
          <p>
            v2 currentUser: id=
            <strong className="text-foreground/85">{diag.v2Me.id}</strong>
            {" / name="}
            <strong className="text-foreground/85">
              {diag.v2Me.name || "(空)"}
            </strong>
          </p>
        )}
        <p>
          v2 raw fetched:{" "}
          <strong className="text-foreground/85">
            {diag.v2RawCount ?? "(なし)"}
          </strong>
          {" / owner-filter 通過: "}
          <strong className="text-foreground/85">
            {diag.v2OwnedCount ?? "(なし)"}
          </strong>
        </p>
        {diag.v2OwnersSample && diag.v2OwnersSample.length > 0 && (
          <>
            <p className="mt-0.5">v2 取得時の owner 上位:</p>
            <ul className="ml-3 flex flex-col gap-0.5">
              {diag.v2OwnersSample.map((o, i) => (
                <li key={i}>
                  ・id={o.id ?? "(null)"} / name=
                  {o.name ?? "(null)"} ×{o.count}
                </li>
              ))}
            </ul>
          </>
        )}
        {diag.htmlPageSize !== undefined && (
          <p className="mt-0.5">
            HTML スクレイプ: page1 size=
            <strong className="text-foreground/85">{diag.htmlPageSize}</strong>
            {" bytes / 検出 codes="}
            <strong className="text-foreground/85">
              {diag.htmlCodesFound ?? 0}
            </strong>
            {" / 取得 reports="}
            <strong className="text-foreground/85">
              {diag.htmlReportCount ?? 0}
            </strong>
          </p>
        )}
        <p className="mt-0.5">
          Session Cookie 設定:{" "}
          <strong
            className={
              diag.cookieUsed ? "text-emerald-300" : "text-rose-300/80"
            }
          >
            {diag.cookieUsed ? "あり" : "なし"}
          </strong>
          {/* 2.8 follow-up: 従来は scrape 失敗・未実行でも「自動削除済」
              と表示していた (嘘表示)。実際に削除された時のみそう表示し、
              温存時はその旨を出す。 */}
          {diag.cookieUsed && (
            <span
              className={
                diag.cookieDeleted
                  ? "ml-1 text-muted-foreground/70"
                  : "ml-1 text-amber-200/85"
              }
            >
              {diag.cookieDeleted
                ? "(scrape 成功 → 自動削除済)"
                : "(scrape 失敗/未実行のため温存 — 次回連動でも使われます)"}
            </span>
          )}
        </p>
        {diag.htmlScrapeError && (
          <p className="mt-0.5 text-rose-300/85">
            HTML スクレイプエラー: {diag.htmlScrapeError}
          </p>
        )}
        {(diag.videosSkippedNoPostedAt ?? 0) > 0 && (
          <p className="mt-0.5 text-amber-200/85">
            ⚠ タイトル日付なしでスキップ:{" "}
            <strong>{diag.videosSkippedNoPostedAt}</strong>
            {" 件"}
            <span className="ml-1 text-muted-foreground/85">
              ※ 1.9.9 から、タイトルに raid 日が無い動画は 自動マッチ対象から
              除外（誤マッチ防止）。 動画編集ダイアログから FFLogs URL を手動
              指定してください
            </span>
          </p>
        )}
        {diag.titleDateHitCount !== undefined && (
          <p className="mt-0.5">
            タイトル日付抽出:
            {" 成功 "}
            <strong className="text-emerald-300">
              {diag.titleDateHitCount}
            </strong>
            {" / 失敗 "}
            <strong className="text-rose-300">
              {diag.titleDateMissCount ?? 0}
            </strong>
            {" 件"}
            <span className="ml-1 text-muted-foreground/70">
              (失敗 = 自動マッチ対象外)
            </span>
          </p>
        )}
        {diag.titleDateMissSample && diag.titleDateMissSample.length > 0 && (
          <details className="mt-1 group/missdates">
            <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                <span className="text-rose-300/70 transition-transform group-open/missdates:rotate-90">
                  ▸
                </span>
                日付抽出に失敗したタイトル (上位
                {diag.titleDateMissSample.length}
                件)
              </span>
            </summary>
            <ul className="mt-1 ml-3 flex flex-col gap-0.5 font-mono text-[9px] leading-tight text-muted-foreground">
              {diag.titleDateMissSample.map((t, i) => (
                <li
                  key={i}
                  className="break-all bg-secondary/20 px-1.5 py-0.5 rounded"
                >
                  {t}
                </li>
              ))}
            </ul>
          </details>
        )}
        {diag.htmlSample && (
          <details className="mt-1.5 group/htmlsample">
            <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                <span className="text-amber-300/70 transition-transform group-open/htmlsample:rotate-90">
                  ▸
                </span>
                HTML サンプル (最初のレポートコード周辺)
              </span>
            </summary>
            <pre className="mt-1 ml-3 rounded bg-secondary/30 px-1.5 py-1 font-mono text-[9px] leading-tight whitespace-pre-wrap break-all text-muted-foreground/85 max-h-[16rem] overflow-y-auto">
              {diag.htmlSample}
            </pre>
          </details>
        )}
        {userTypeFields && userTypeFields.length > 0 && (
          <details className="mt-1.5 group/userfields">
            <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                <span className="text-amber-300/70 transition-transform group-open/userfields:rotate-90">
                  ▸
                </span>
                User 型のフィールド一覧 (introspect、{userTypeFields.length} 個)
              </span>
            </summary>
            <pre className="mt-1 ml-3 rounded bg-secondary/30 px-1.5 py-1 font-mono text-[9px] leading-tight whitespace-pre-wrap break-words text-muted-foreground/85 max-h-[12rem] overflow-y-auto">
              {userTypeFields.join("\n")}
            </pre>
          </details>
        )}
    </div>
  );
}

export default FflogsDiagnosticsPanel;
