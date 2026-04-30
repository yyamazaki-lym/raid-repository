/**
 * 2.1 (2026-05-01) TODO #54 part2: Top progress bar (cold start UX) を
 * 自前実装に置換するための pending カウンタ。
 *
 * `next-nprogress-bar` (Next.js 15 時代のライブラリ) は本番 Next.js 16 +
 * React 19 環境でバーが描画されないため、Next.js 16 標準の
 * `useLinkStatus` フックを使った自前実装に切替。Link 内で発火した pending
 * 状態を集約するために module-level の参照カウンタを置き、TopProgressBar が
 * `useSyncExternalStore` 経由で読む構成。
 *
 * `incrementPending` / `decrementPending` は対称呼び出し前提 (NavReporter
 * の useEffect cleanup が必ず減算する)。複数 Link を素早く連打しても
 * 加算優先で常に正の整数なので「最後の Link が完了するまでバーが残る」
 * 自然な挙動になる。
 */

let pendingCount = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function incrementPending(): void {
  pendingCount += 1;
  notify();
}

export function decrementPending(): void {
  if (pendingCount > 0) pendingCount -= 1;
  notify();
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingSnapshot(): boolean {
  return pendingCount > 0;
}

/**
 * SSR では常に false を返して hydration mismatch を避ける。pending 状態は
 * クライアントイベント (Link click) で初めて立つので server snapshot は
 * 必ず false で安全。
 */
export function getPendingServerSnapshot(): boolean {
  return false;
}
