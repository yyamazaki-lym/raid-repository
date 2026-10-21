/**
 * サーバーの起動時に一度だけ、動いている Node の版をログに出す (2026-10-21)。
 *
 * Vercel で選べるのはメジャー版 (`24.x`) だけで、マイナー・パッチ版は
 * Vercel が自動で入れる。ビルドログにも実行時の版は出ないので、Node の
 * セキュリティリリース (例: 2026-10 の 24.22.1) が本番に入ったかは、
 * runtime logs の `[runtime] node v24.x.y` で確かめる (Vercel のドキュメントの
 * 確かめ方「`process.version` をログに出す」)。
 *
 * 本体は Node でだけ読み込む別のモジュールに置く。このファイルは Edge
 * (`scrape-proxy`) 向けにもコンパイルされ、`process.version` を直接書くと
 * 「Edge では使えない Node の API」の警告が要求のたびに出るため
 * (Next のドキュメントの「Specifying the runtime」と同じ形)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRuntimeVersion } = await import("./lib/server/log-runtime-version");
    logRuntimeVersion();
  }
}
