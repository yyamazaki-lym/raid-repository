"use client";

import { useEffect } from "react";

/**
 * Cold start スプラッシュ SW (public/sw.js) の登録 / 解除 (2026-07-22)。
 *
 * - 有効条件: production ビルド かつ `NEXT_PUBLIC_SPLASH_SW === "true"`。
 *   NEXT_PUBLIC_* はビルド時インライン化されるため、キルスイッチの
 *   ON/OFF は Vercel の env 変更 + 再デプロイで反映される。
 * - 無効時は「登録しない」だけでなく既登録 SW を **unregister** する。
 *   SW はブラウザに粘着するため、フラグを戻した後も旧 SW が残り続ける
 *   事故を防ぐ (ChunkErrorHandler と同系の防御的姿勢)。
 * - dev では常に無効 + unregister。next start で SW を検証した後に
 *   next dev へ戻った際、localhost に残った SW がナビゲーションを掴む
 *   事故もこれで自動回収される。
 * - 登録はハイドレーション後の idle に遅らせ、初期表示と競合させない。
 * - root layout に置く: (portal) layout だと未ログイン時 (/login) に
 *   キルスイッチの unregister 経路が動かない。
 */
const SW_ENABLED =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_SPLASH_SW === "true";

export function SplashSwRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (!SW_ENABLED) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) {
            if (key.startsWith("splash-")) void caches.delete(key);
          }
        });
      }
      return;
    }

    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      // updateViaCache: "none" — sw.js の更新チェックに HTTP キャッシュを
      // 使わせない (next.config.ts の no-cache ヘッダと二重の保険)。
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {
          // 登録失敗 = スプラッシュが出ないだけで現状動作 (白画面) に戻る。
          // 異常系として扱わない。
        });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(register, { timeout: 3000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = window.setTimeout(register, 1500); // Safari: requestIdleCallback 無し
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  return null;
}
