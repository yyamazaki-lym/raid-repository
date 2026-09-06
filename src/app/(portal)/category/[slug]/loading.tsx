"use client";

import { Card } from "@/components/ui/card";
import { useMessages } from "@/lib/i18n/client";

/**
 * /category/[slug]/* 各タブ共通の instant loading skeleton (TODO #51 P2-5)。
 *
 * パンくず + SubTabs は [slug]/layout.tsx 側に居るので、タブ切替時は
 * この skeleton がタブのコンテンツ領域だけを置き換える (SubTabs は操作
 * 可能なまま)。strategy / videos / macros / mitigation / loot の 5 タブで
 * 共用するため、形はジェネリックなカードリストに留める。
 * CSS-only (Tailwind `animate-pulse`)。aria-label を表示言語に合わせるため
 * client component にしてあるが、Suspense の fallback として同期に描ける
 * (async にすると fallback 自体が suspend して親境界へ抜けるため避ける)。
 *
 * 注意 (loading.md): [slug]/layout.tsx 自体の uncached fetch
 * (findCategoryBySlug + role gate) は本 boundary の外なので、別カテゴリへ
 * またぐ遷移では layout 解決後に表示される。同一カテゴリ内のタブ切替では
 * 即時表示。
 */
export default function CategoryTabLoading() {
  const m = useMessages();
  return (
    <div
      role="status"
      aria-label={m.categoryTab.loadingAria}
      className="flex flex-col gap-4 pt-2"
    >
      {/* タブ右上のアクション (追加 button 等) の placeholder */}
      <div className="flex items-center justify-end gap-2">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-secondary/40" />
      </div>

      {/* カードリストの placeholder (videos / strategy のカード grid と同形) */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="glass gap-3 p-4">
            <div className="flex items-start gap-2">
              <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-secondary/40" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-secondary/50" />
            </div>
            <div className="h-3.5 w-full animate-pulse rounded bg-secondary/30" />
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-secondary/30" />
          </Card>
        ))}
      </div>
    </div>
  );
}
