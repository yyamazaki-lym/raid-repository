import { Loader2 } from "lucide-react";

/**
 * 2.9 (2026-06-11): TOP (スケジュール) の Suspense 境界を page 内
 * `<Suspense>` から本 loading.tsx に移設 (経緯は `page.tsx` の
 * SchedulePage コメント参照)。
 *
 * 実効スコープは TOP (`/`) のみ — `/category` 配下は各セグメントが自前の
 * loading.tsx (CSS-only skeleton) を持つのでそちらが優先される。
 *
 * fallback は旧 ScheduleLoadingFallback (TODO #57) をそのまま移植:
 * `scheduleLoadingFadeIn` keyframe (globals.css) で `opacity: 0 → 1` を
 * `0.5s delay + 0.3s duration` で発火。ロードが 500ms 未満なら視認されず
 * swap 違和感を回避、500ms を超える場合のみ穏やかに "Now Loading" が出る。
 *
 * 注意: `(portal)/layout.tsx` は uncached fetch を await しているため、
 * layout を新規に通る遷移 (ハードロード / portal 外からの遷移) では本
 * fallback は layout 解決後にしか出ない。タブ遷移 (layout 持続) では
 * prefetch 済み boundary として即表示される。
 */
export default function PortalLoading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground"
      style={{
        opacity: 0,
        animation: "scheduleLoadingFadeIn 300ms ease-out 500ms forwards",
      }}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-sm">Now Loading...</span>
    </div>
  );
}
