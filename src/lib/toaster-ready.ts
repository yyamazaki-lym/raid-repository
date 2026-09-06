/**
 * sonner `<Toaster>` の mount 完了シグナル (2.14, 2026-09-06)。
 *
 * 背景: `toaster-dynamic.tsx` は Toaster を `next/dynamic({ ssr: false })`
 * で遅延読み込みしている。sonner v2 の `toast()` は **その時点で subscribe
 * 済みの Toaster にしか publish せず、後から mount した Toaster へ過去の
 * トーストを再送しない** (sonner の `ToastState.subscribe` / `addToast` に
 * replay は無い)。そのため Toaster の chunk が届く前に発火したトーストは
 * 黙って消える。実害があったのは FFLogs OAuth 復帰時 (`settings-dialog.tsx`
 * の mount 時 effect が `toast.success / error` を呼ぶ) で、Playwright の
 * 計測では 3 回中 0〜1 回しか表示されなかった。
 *
 * 仕組み: `src/components/ui/sonner.tsx` のラッパーが `useEffect` で
 * `markToasterReady()` を呼ぶ。React の passive effect は子 → 親の順で
 * 走るため、ラッパーの effect が走った時点で子の `<Sonner>` 内部の
 * subscribe effect は完了している (= 以降の `toast()` は確実に届く)。
 * 発火側は `whenToasterReady().then(() => toast.…)` とする。
 *
 * ページ内で 1 回 ready になれば以後は即 resolve。Toaster が何らかの理由で
 * mount しない (chunk 取得失敗など) 場合に発火側が永久に待たないよう、
 * 上限時間で必ず resolve する (その場合は従来どおりトーストは失われる
 * だけで、他の処理は止めない)。
 *
 * ユーザー操作起点のトースト (ボタン押下後の保存結果など) は Toaster の
 * mount がとうに済んでいるため本モジュールを通す必要はない。
 */
let ready = false;
let resolveReady: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

/** Toaster ラッパーの mount 時に 1 回呼ぶ。 */
export function markToasterReady(): void {
  if (ready) return;
  ready = true;
  resolveReady?.();
}

/**
 * Toaster が mount 済みなら即 resolve、未 mount なら mount または
 * `timeoutMs` 経過のいずれか早い方で resolve する。reject はしない。
 */
export function whenToasterReady(timeoutMs = 5000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void readyPromise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
