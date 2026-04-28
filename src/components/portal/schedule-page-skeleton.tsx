/**
 * 1.9 (2026-04-28) TODO #11: Suspense streaming 用のスケルトン。
 *
 * `/` ページの Server Component が Promise.all で 6+ の DB / 外部 fetch を
 * 解決するまでの間、Layout (Header + MainTabs) は既に streamed 済みなので、
 * その下にこのスケルトンを表示する。
 *
 * 寸法・配置は実コンポーネント (`SchedulePageBody` / `NextSessionCard` /
 * `ScheduleList`) に揃えて、実データ到着時のレイアウトシフトを最小化。
 *   - ヘッダー行: `items-center gap-2`、右側ボタン群は 4× `h-8 w-8`、
 *     `shrink-0 gap-1.5` で実 layout と一致。
 *   - 次回開催日 card: `p-3 sm:p-4` + `h-8 w-8` icon で `NextSessionCard`
 *     の Frame と一致。
 *   - スケジュール表 card: 横スクロール表 (`overflow-x-auto`) を採用せず、
 *     縦並びの簡易 row を表示 (狭幅表示時の見え方に近い)。
 *
 * pulse animation を抑え目にして「読み込み中」だけ伝える簡素なバージョン。
 * Card の neon-edge / glass ベースは残してテーマ感は維持。
 */
export function SchedulePageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Page heading + toolbar 行
         実 layout (`SchedulePageBody`) と揃える: items-center / gap-2、
         右側 4 ボタンは全て h-8 w-8 + gap-1.5。 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="h-7 w-32 animate-pulse rounded-sm bg-secondary/40" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-secondary/40" />
        </div>
      </div>

      {/* 次回開催日 card
         実 `NextSessionCard` Frame: glass + p-3 sm:p-4 + flex items-center
         gap-3 + h-8 w-8 アイコン + flex-1 column。 */}
      <div className="glass animate-pulse flex items-center gap-3 rounded-lg border border-border/50 p-3 sm:p-4">
        <div className="h-8 w-8 shrink-0 rounded-md bg-secondary/50" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-3 w-20 rounded-sm bg-secondary/40" />
          <div className="h-5 w-56 max-w-full rounded-sm bg-secondary/50" />
        </div>
      </div>

      {/* スケジュール表 card
         実 `ScheduleList` は `overflow-x-auto` 内の `min-w-[640px]` table
         だが、skeleton では狭幅時の視覚に近い簡易 row を縦に並べる。 */}
      <div className="glass overflow-hidden rounded-lg border border-border/40">
        {/* Legend 行: bg-secondary/15 px-3 py-2 で実 Legend と一致 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 bg-secondary/15 px-3 py-2">
          <div className="h-3 w-16 animate-pulse rounded-sm bg-secondary/40" />
          <div className="h-4 w-12 animate-pulse rounded-sm bg-secondary/30" />
          <div className="h-4 w-12 animate-pulse rounded-sm bg-secondary/30" />
          <div className="h-4 w-12 animate-pulse rounded-sm bg-secondary/30" />
          <div className="ml-auto flex items-center gap-1.5">
            <div className="h-6 w-14 animate-pulse rounded-md bg-secondary/40" />
            <div className="h-6 w-6 animate-pulse rounded-md bg-secondary/40" />
          </div>
        </div>
        {/* Table rows のダミー (5 行) — 各行は実 SessionRow と同じ
           padding / gap で並べる。 */}
        <div className="flex flex-col">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border/30 px-3 py-2.5 last:border-b-0"
            >
              <div className="h-4 w-32 animate-pulse rounded-sm bg-secondary/40" />
              <div className="h-3 w-20 animate-pulse rounded-sm bg-secondary/30" />
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
