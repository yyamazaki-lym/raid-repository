"use client";

import { useEffect } from "react";

/**
 * 2.1 (2026-04-30) TODO #11: デプロイ後 navigation 失敗対策。
 *
 * 症状: 古いタブ (デプロイ前にロード済) で `<Link>` をクリック →
 * URL が変わらず loading 表示も出ない (silent failure)。
 *
 * 原因: Next.js のソフトナビは内部で RSC payload + JS chunk を fetch
 * するが、デプロイで chunk hash が変わると 404 になる。`Link` は
 * onClick で `preventDefault()` 済なので `<a href>` のブラウザ標準
 * 遷移にもフォールバックされない。
 *
 * 対策: ChunkLoadError / "Loading chunk" 系のエラーを window で listen
 * して、検出時は `window.location.reload()` で hard refresh。新しい
 * build を再取得して整合状態に戻す。`sessionStorage` で 1 度だけ
 * reload するように制限し、無限ループを回避。
 *
 * Vercel Skew Protection を Project Settings で有効化すれば fundamental
 * には解決するが、コード側でも fallback を持たせる。
 */
const RELOAD_FLAG_KEY = "raid-repo:chunk-reloaded";

function isChunkLoadError(message: string, name?: string): boolean {
  if (name === "ChunkLoadError") return true;
  return (
    /ChunkLoadError/i.test(message) ||
    /Loading chunk\s+[\w-]+\s+failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message)
  );
}

function tryReloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG_KEY)) {
      // 1 度 reload 済 → これ以上ループさせない。
      console.warn(
        "[chunk-error-handler] reload already attempted this session, giving up",
      );
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
  } catch {
    // sessionStorage が使えない環境 (private mode 等) でも reload は試す
  }
  window.location.reload();
}

export function ChunkErrorHandler() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.message ?? "";
      const errName = (event.error as { name?: string } | null | undefined)
        ?.name;
      if (isChunkLoadError(msg, errName)) {
        console.warn("[chunk-error-handler] chunk load error → reload:", msg);
        tryReloadOnce();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as
        | { message?: string; name?: string }
        | null
        | undefined;
      const msg = reason?.message ?? "";
      const name = reason?.name;
      if (isChunkLoadError(msg, name)) {
        console.warn(
          "[chunk-error-handler] unhandled chunk error → reload:",
          msg,
        );
        tryReloadOnce();
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
