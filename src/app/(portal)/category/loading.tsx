"use client";

import { Card } from "@/components/ui/card";
import { useMessages } from "@/lib/i18n/client";

/**
 * /category (コンテンツ一覧) の instant loading skeleton (TODO #51 P2-5)。
 *
 * page.tsx は fetchCategories + 集計 4 系統を SSR の Promise.all で待つ
 * ため、遷移直後はこのカード形 placeholder を出して体感待ち時間を抑える。
 * CSS-only (Tailwind `animate-pulse`) の Server Component なので client
 * bundle への影響はゼロ (TODO #11/#67 の初期 bundle 維持方針と整合)。
 */
export default function CategoryIndexLoading() {
  // 2026-09-07: aria-label を辞書化するため client component に (async の
  // loading fallback は suspend するので Server Component では辞書を待てない)。
  const m = useMessages();
  return (
    <div
      role="status"
      aria-label={m.app.categoriesLoadingAria}
      className="flex flex-col gap-6"
    >
      {/* page header (h1 "Contents" + 説明文) の placeholder */}
      <div className="flex flex-col gap-2">
        <div className="h-7 w-36 animate-pulse rounded-md bg-secondary/50" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-secondary/30" />
      </div>

      {/* カテゴリカード列の placeholder (実 page は DnD 並び替え付き縦積みカード) */}
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="glass gap-3 p-4">
            <div className="h-5 w-1/2 max-w-64 animate-pulse rounded bg-secondary/50" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-secondary/30" />
            <div className="flex items-center gap-2 pt-1">
              {[0, 1, 2, 3, 4].map((j) => (
                <div
                  key={j}
                  className="h-7 w-7 animate-pulse rounded-md bg-secondary/40"
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
