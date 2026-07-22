/* Splash 制御 (cold start スプラッシュ、public/sw.js とペア)。
   CSP (script-src 'self' 'nonce-...') の都合でインライン script は使えない
   ため外部ファイル。public/ 配下の素の JS — tsc / eslint の対象外
   (eslint.config.mjs で public/** を ignore)。

   役割: sw.js がスプラッシュを応答した後、「本物の応答 (nav1 の pending
   fetch) が届いたか」を MessageChannel で SW にポーリングし、届いた瞬間に
   同一 URL へ再ナビゲーション (nav2) する。nav2 は SW 側で保存済み応答を
   即座に respondWith されるため、ブラウザの paint holding タイムアウト
   (Chrome 実測 ~4s) に依存せずスプラッシュ → 本物の置換が完了する。 */
(function () {
  "use strict";

  var POLL_INTERVAL_MS = 300; // SW への「本物の応答は届いたか」ポーリング間隔
  var POLL_START_MS = 500; // スプラッシュ最低表示時間を兼ねた初回ポーリング遅延
  var FORCE_NAV_MS = 8000; // ポーリングが機能しなくても必ず再ナビする保険
  var RETRY_LINK_MS = 20000; // それでも進まない場合の手動リロード導線

  // 直接 /splash.html を開かれた場合 (公開静的ファイルなので誰でも開ける)。
  // location.replace(location.href) だと自分自身へ無限再ナビするため TOP へ。
  if (location.pathname === "/splash.html") {
    location.replace("/");
    return;
  }

  var navigated = false;
  function goToRealPage() {
    if (navigated) return;
    navigated = true;
    // replace: スプラッシュを履歴に残さない。同一 URL への再ナビゲーションで
    // SW 側が保存済み pending fetch を応答に使う (オリジンへの 2 本目は出ない)。
    location.replace(location.href);
  }

  function poll() {
    if (navigated) return;
    var ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl) return; // SW 消失 → FORCE_NAV_MS の保険に任せる
    var ch = new MessageChannel();
    var answered = false;
    ch.port1.onmessage = function (event) {
      answered = true;
      var d = event.data || {};
      // resolved: 応答到着済み / known=false: SW 再起動で pending 消失 —
      // どちらも即再ナビ (後者はループガードにより素のネットワーク待ちに
      // 落ちるだけで、スプラッシュの無限ループにはならない)。
      if (d.resolved || d.known === false) goToRealPage();
      else setTimeout(poll, POLL_INTERVAL_MS);
    };
    ctrl.postMessage(
      { type: "splash-status", url: location.href.split("#")[0] },
      [ch.port2]
    );
    // 応答が来ない (SW kill 直後等) 場合もポーリングを止めない
    setTimeout(function () {
      if (!answered && !navigated) poll();
    }, 1000);
  }

  setTimeout(poll, POLL_START_MS);
  setTimeout(goToRealPage, FORCE_NAV_MS);
  setTimeout(function () {
    var el = document.getElementById("retry");
    var link = document.getElementById("retry-link");
    if (link) link.setAttribute("href", location.href);
    if (el) el.style.display = "block";
  }, RETRY_LINK_MS);
})();
