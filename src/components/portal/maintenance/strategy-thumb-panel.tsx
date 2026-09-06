"use client";

import { useMessages } from "@/lib/i18n/client";

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
  const t = useMessages().maintenancePanels;
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        {t.thumbTitle(force)}
      </p>
      <ul className="flex flex-col gap-0.5 text-[11px]">
        <li className="flex items-baseline gap-2">
          <span className="text-emerald-300">{t.fetched}</span>
          <span className="font-mono text-foreground">{data.filled}</span>
          <span className="text-muted-foreground">{t.count}</span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="text-zinc-400">{t.noOgImage}</span>
          <span className="font-mono text-foreground">
            {data.skippedNoImage}
          </span>
          <span className="text-muted-foreground">{t.count}</span>
        </li>
        {data.failed > 0 && (
          <li className="flex items-baseline gap-2">
            <span className="text-rose-300">{t.failed}</span>
            <span className="font-mono text-foreground">{data.failed}</span>
            <span className="text-muted-foreground">{t.count}</span>
          </li>
        )}
        <li className="text-[10px] text-muted-foreground">
          {t.target(data.scanned)}
        </li>
      </ul>
    </>
  );
}
