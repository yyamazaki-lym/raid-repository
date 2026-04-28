/**
 * 1.9 (2026-04-28) TODO #11: Suspense streaming 用のスケルトン。
 *
 * `/` ページの Server Component が Promise.all で 6+ の DB / 外部 fetch を
 * 解決するまでの 200-1500ms の間、Layout (Header + MainTabs) は既に
 * streamed 済みなので、その下にこのスケルトンを表示する。
 *
 * 完成形 `SchedulePageBody` の主要セクション (header buttons / next-
 * session card / schedule list card) のサイズに大体合わせて配置 →
 * 実データ到着時のレイアウトシフトを最小化。
 *
 * pulse animation を抑え目にして「読み込み中」だけ伝える簡素なバージョン。
 * Card の neon-edge / glass ベースは残してテーマ感は維持。
 */
export function SchedulePageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Page heading + toolbar 行 */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="h-7 w-32 animate-pulse rounded-sm bg-secondary/40" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-secondary/40" />
        </div>
      </div>

      {/* 次回開催日 card */}
      <div className="glass animate-pulse rounded-lg border border-border/40 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-secondary/50" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3 w-20 rounded-sm bg-secondary/40" />
            <div className="h-5 w-56 rounded-sm bg-secondary/50" />
          </div>
          <div className="h-7 w-16 rounded-md bg-secondary/40" />
        </div>
      </div>

      {/* スケジュール表 card */}
      <div className="glass overflow-hidden rounded-lg border border-border/40">
        {/* Legend 行 */}
        <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-secondary/15 px-3 py-2">
          <div className="flex gap-2">
            <div className="h-3 w-16 rounded-sm bg-secondary/40" />
            <div className="h-3 w-16 rounded-sm bg-secondary/40" />
            <div className="h-3 w-16 rounded-sm bg-secondary/40" />
          </div>
          <div className="flex gap-1.5">
            <div className="h-6 w-12 rounded-md bg-secondary/40" />
            <div className="h-6 w-6 rounded-md bg-secondary/40" />
          </div>
        </div>
        {/* Table rows のダミー (5 行) */}
        <div className="flex flex-col">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border/30 px-3 py-2.5 last:border-b-0"
            >
              <div className="h-4 w-32 animate-pulse rounded-sm bg-secondary/40" />
              <div className="ml-auto flex gap-2">
                {Array.from({ length: 6 }).map((__, j) => (
                  <div
                    key={j}
                    className="h-5 w-7 animate-pulse rounded-sm bg-secondary/30"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 「読み込み中」のテキスト hint (a11y / 状態を明確に) */}
      <p className="text-center font-mono text-[10px] tracking-[0.22em] text-muted-foreground/70 uppercase">
        Loading schedule…
      </p>
    </div>
  );
}
