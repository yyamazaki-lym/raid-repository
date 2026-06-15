"use client";

/**
 * Phase 14 (2.x, 2026-05-13): 攻略リンクサムネイル backfill の結果サマリー。
 * 取得成功 / og:image なし / Supabase エラー の 3 値を表示。
 * (maintenance-menu から分離、C-5)
 */
export function StrategyThumbPanel({
  data,
  force,
}: {
  data: {
    filled: number;
    failed: number;
    skippedNoImage: number;
    scanned: number;
  };
  force: boolean;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        攻略サムネ — {force ? "全件再取得" : "NULL のみ"} 結果
      </p>
      <ul className="flex flex-col gap-0.5 text-[11px]">
        <li className="flex items-baseline gap-2">
          <span className="text-emerald-300">取得</span>
          <span className="font-mono text-foreground">{data.filled}</span>
          <span className="text-muted-foreground">件</span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="text-zinc-400">og:image なし</span>
          <span className="font-mono text-foreground">
            {data.skippedNoImage}
          </span>
          <span className="text-muted-foreground">件</span>
        </li>
        {data.failed > 0 && (
          <li className="flex items-baseline gap-2">
            <span className="text-rose-300">失敗</span>
            <span className="font-mono text-foreground">{data.failed}</span>
            <span className="text-muted-foreground">件</span>
          </li>
        )}
        <li className="text-[10px] text-muted-foreground">
          対象: {data.scanned} 件
        </li>
      </ul>
    </>
  );
}
