/* Cold start スプラッシュ専用 Service Worker (2026-07-22)。

   スコープは「アイドル後ハードナビゲーションの白画面 3〜4s (Vercel Node
   関数の cold start) をスプラッシュに置き換える」のみ。オフライン対応・
   アセットキャッシュ・PWA 化は意図的にやらない。

   本物のページ HTML は per-request CSP nonce (src/proxy.ts が発行、
   layout.tsx がインライン script に刻む) を含むため、絶対にキャッシュ /
   合成しない — nonce とヘッダのペアが崩れて CSP 違反になる。スプラッシュは
   キャッシュ済みの静的 HTML (/splash.html — インライン script なし) を出し、
   本物は必ずネットワーク応答をそのまま流す。

   動作 (cold 時のタイムライン):
     nav1: ハードナビ → fetch とタイマー (600ms) を race → タイマー勝ち →
           スプラッシュを respondWith し、進行中の fetch を Map に保存
     splash.js: 応答到着を MessageChannel でポーリング → 到着で再ナビ
     nav2: 同一 URL への再ナビ → Map の保存済み応答をそのまま respondWith
   オリジンへの document リクエストは終始 1 本 (nav1 の fetch が関数を温め、
   応答もそれを使う)。warm 時は race でネットワークが勝ち完全素通し。

   ループガード: 「直近 30s 以内にこの URL をスプラッシュ済み」の記録を
   Cache API に永続化 (SW グローバル変数は kill で消えるため)。該当中は
   スプラッシュを出さず素直にネットワークを待つ → 無限スプラッシュ
   ループは構造的に不可能。

   キルスイッチ: 登録/解除は SplashSwRegistrar (NEXT_PUBLIC_SPLASH_SW) が
   管理。フラグ off でデプロイすると次回ページロードで unregister される。 */

const VERSION = "v1"; // splash.html / splash.js / 本ファイル変更時にインクリメント
const CACHE_NAME = `splash-${VERSION}`;
const GUARD_CACHE = "splash-guard"; // ループガード (SW kill を跨いで永続)
const SPLASH_PATH = "/splash.html";
const SPLASH_ASSETS = ["/splash.html", "/splash.js"];

const SPLASH_TIMEOUT_MS = 600; // warm TTFB 実測 0.16〜0.23s に対し十分な余白
const GUARD_TTL_MS = 30_000; // 同一 URL への再スプラッシュ禁止期間
const PENDING_TTL_MS = 30_000; // 回収されなかった pending の掃除期限

/** URL(href, fragment なし) -> Promise<Response>。nav1 の進行中 fetch を
    保存し、スプラッシュからの再ナビ (nav2) がこれを応答として回収する。
    SW kill で消える (その場合はループガード側が安全に受け止める)。 */
const pendingNavigations = new Map();
/** pending が解決済みの URL 集合 (splash.js のポーリング応答用)。 */
const resolvedNavigations = new Set();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SPLASH_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith("splash-") && k !== CACHE_NAME && k !== GUARD_CACHE,
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---- ループガード (Cache API 永続) --------------------------------------
function guardKey(urlHref) {
  return new Request(
    self.location.origin + "/__splash-guard?u=" + encodeURIComponent(urlHref),
  );
}
async function wasRecentlySplashed(urlHref) {
  const cache = await caches.open(GUARD_CACHE);
  const hit = await cache.match(guardKey(urlHref));
  if (!hit) return false;
  const ts = Number(await hit.text());
  return Number.isFinite(ts) && Date.now() - ts < GUARD_TTL_MS;
}
async function markSplashed(urlHref) {
  const cache = await caches.open(GUARD_CACHE);
  await cache.put(guardKey(urlHref), new Response(String(Date.now())));
}

// ---- splash.js からのポーリング -----------------------------------------
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "splash-status" || typeof data.url !== "string") {
    return;
  }
  const port = event.ports && event.ports[0];
  if (!port) return;
  port.postMessage({
    resolved: resolvedNavigations.has(data.url),
    known:
      pendingNavigations.has(data.url) || resolvedNavigations.has(data.url),
  });
});

// ---- fetch --------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // ハードナビゲーションの GET のみ対象:
  // - RSC fetch / prefetch (rsc / next-router-prefetch ヘッダ) は mode が
  //   navigate でないので通らない
  // - Server Action の JS 無し form POST は mode=navigate になり得るため
  //   method ガードも必須
  // - destination "document" 判定で same-origin iframe ナビも除外
  if (req.mode !== "navigate" || req.method !== "GET") return;
  if (req.destination !== "document") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // /auth/callback は OAuth code の一回性、/auth/sign-out は副作用ありの
  // ため絶対にスプラッシュ / 再ナビさせない。/api/ は画面を持たない。
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) {
    return;
  }
  if (url.pathname === SPLASH_PATH) return; // 直接アクセスは素通し
  event.respondWith(handleNavigate(event, req, url));
});

async function handleNavigate(event, req, url) {
  url.hash = ""; // request.url の fragment 有無はブラウザ差があるため正規化
  const key = url.href;

  // (1) スプラッシュからの再ナビ (nav2): pending を回収して応答に使う
  const pending = pendingNavigations.get(key);
  if (pending) {
    pendingNavigations.delete(key);
    resolvedNavigations.delete(key);
    try {
      const res = await pending;
      // opaqueredirect (proxy の /login リダイレクト等) を別ナビゲーション
      // へ再利用するのはブラウザ実装のグレーゾーンなので、決め打ちで
      // 再フェッチに倒す。この時点で関数は温まっており redirect 応答は
      // proxy 層で返るため安価。
      if (res.type === "opaqueredirect" || res.redirected) return fetch(req);
      return res;
    } catch {
      return fetch(req); // nav1 がネットワークエラー → nav2 で素直に再試行
    }
  }

  // (2) ループガード: 直近スプラッシュ済み (SW kill で pending 消失した
  // 場合を含む) → スプラッシュを出さずネットワークを待つ。この待機中も
  // ブラウザの paint holding で旧ドキュメント (= スプラッシュ) が表示され
  // 続けるため UX は保たれる。
  if (await wasRecentlySplashed(key)) {
    return fetch(req);
  }

  // (3) 通常経路: ネットワーク vs タイマーの race
  const networkPromise = fetch(req);
  networkPromise.then(
    () => resolvedNavigations.add(key),
    () => resolvedNavigations.add(key), // エラーも「決着」— splash に再ナビさせる
  );

  let timerId;
  const timeout = new Promise((resolve) => {
    timerId = setTimeout(() => resolve("timeout"), SPLASH_TIMEOUT_MS);
  });
  const winner = await Promise.race([
    networkPromise.then(
      (res) => ({ kind: "network", res }),
      (err) => ({ kind: "error", err }),
    ),
    timeout.then(() => ({ kind: "timeout" })),
  ]);

  if (winner.kind !== "timeout") {
    clearTimeout(timerId);
    resolvedNavigations.delete(key);
    if (winner.kind === "network") return winner.res; // warm 経路: 完全素通し
    throw winner.err; // ブラウザ標準のネットワークエラー表示 (現状同等)
  }

  // (4) タイマー勝ち = cold start とみなしスプラッシュ
  const cache = await caches.open(CACHE_NAME);
  const splash = await cache.match(SPLASH_PATH);
  if (!splash) return networkPromise; // キャッシュ消失 → 諦めてネットワーク待ち

  pendingNavigations.set(key, networkPromise);
  await markSplashed(key); // respondWith 前に永続化 (直後 kill でもガード有効)

  // respondWith がスプラッシュで確定すると SW が idle 扱いで kill され
  // pending fetch が中断され得るため、waitUntil で解決まで延命する。
  // 併せて回収されなかった pending の掃除 (メモリ / 接続リーク対策)。
  event.waitUntil(
    networkPromise
      .catch(() => null)
      .then(
        (res) =>
          new Promise((resolve) => {
            setTimeout(() => {
              if (pendingNavigations.get(key) === networkPromise) {
                pendingNavigations.delete(key);
                resolvedNavigations.delete(key);
                if (res && res.body) res.body.cancel().catch(() => {});
              }
              resolve();
            }, PENDING_TTL_MS);
          }),
      ),
  );

  return splash.clone(); // キャッシュ本体を disturbed にしないよう clone を返す
}
