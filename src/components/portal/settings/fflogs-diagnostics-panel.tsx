"use client";

/**
 * TODO #68 (2026-05-02): fflogs-sync-section.tsx の詳細診断パネル
 * (`logsResult.diag` + `userTypeFields`) を別ファイル化し、親側で
 * `next/dynamic({ ssr: false })` 経由で読み込む。details を開いた瞬間に
 * のみ chunk が fetch される (親側で controlled details + 条件マウント)。
 *
 * 親 (FflogsLinkResultLite.diag) と型を共有するため `FflogsDiag` を named
 * export。親は `import type` で受けて runtime chunk を分離維持する。
 */

export type FflogsDiag = {
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
  htmlReportCount?: number;
  htmlScrapeError?: string;
  htmlSample?: string;
  videosSkippedNoPostedAt?: number;
  titleDateHitCount?: number;
  titleDateMissCount?: number;
  titleDateMissSample?: string[];
};

export default function FflogsDiagnosticsPanel({
  diag,
  userTypeFields,
}: {
  diag: FflogsDiag;
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
        Session Cookie 適用:{" "}
        <strong
          className={
            diag.cookieUsed ? "text-emerald-300" : "text-rose-300/80"
          }
        >
          {diag.cookieUsed ? "あり" : "なし"}
        </strong>
        {diag.cookieUsed && (
          <span className="ml-1 text-muted-foreground/70">
            (連動完了後に自動削除済)
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
            ※ 1.9.9 から、タイトルに raid 日が無い動画は
            自動マッチ対象から除外（誤マッチ防止）。
            動画編集ダイアログから FFLogs URL を手動指定
            してください
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
