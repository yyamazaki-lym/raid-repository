import type { Dispatcher } from "undici";

/**
 * 外から取ってくる応答の Brotli を展開しない (2026-10-21)。
 *
 * ## 直した問題
 *
 * Node の 2026-10 のセキュリティリリースの CVE-2026-111497 (high) は、Brotli の
 * デコーダの範囲外書き込みで、リモートでのコード実行につながる。undici の fetch は
 * HTTPS の要求に既定で `accept-encoding: br, gzip, deflate, zstd` を付け、応答の
 * `Content-Encoding: br` を **こちらが何を求めたかに関係なく** Node 本体の
 * `zlib.createBrotliDecompress` で展開する (`undici/lib/web/fetch/index.js` の
 * `onResponseStart`)。本番の Vercel は 2026-10-21 時点で Node v24.21.0 (未修正。
 * 選べるのはメジャー版だけで、パッチ版は Vercel が入れる) なので、`safeFetch` が
 * 取りに行く相手 (メンバーが指定した URL を含む) が細工した Brotli を返すと、
 * 修正前の展開処理を通っていた。
 *
 * ## 仕組み
 *
 * 1. 求めない: `Accept-Encoding` を `gzip, deflate` にする (`withSafeAcceptEncoding`)。
 *    まともな相手は br を返さなくなる
 * 2. 断る: それでも br で返ってきたら、fetch が展開の処理を作る前
 *    (dispatcher の `onResponseStart`) に要求を打ち切る (`refuseBrotliInterceptor`)。
 *    呼び出し側には通常の fetch の失敗 (`TypeError: fetch failed`、cause が
 *    `BrotliRefusedError`) として届く
 *
 * fetch が本文を展開しない応答 (HEAD / CONNECT、101・204・205・304) は断らない
 * (undici の fetch と同じ判定)。Node が直った後も残してよい — br を求めないので、
 * まともな相手との取得は変わらない。
 *
 * 検査: `scripts/check-refuse-brotli.mjs` (br を返す手元のサーバーに、本物の
 * undici の fetch とこの interceptor を向ける)。
 */

/** `safeFetch` が送る `Accept-Encoding` (br を求めない)。 */
export const SAFE_ACCEPT_ENCODING = "gzip, deflate";

/** Brotli の応答を展開する前に断ったときのエラー。 */
export class BrotliRefusedError extends Error {
  constructor() {
    super("refused a brotli-encoded response");
    this.name = "BrotliRefusedError";
  }
}

/** fetch が本文を展開しない状態コード (undici の fetch の `nullBodyStatus`)。 */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** `Content-Encoding` に br が含まれるか (大文字小文字・複数の指定・配列を見る)。 */
export function hasBrotliCoding(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  const joined = Array.isArray(value) ? value.join(",") : value;
  return joined
    .toLowerCase()
    .split(",")
    .some((coding) => coding.trim() === "br");
}

function willDecodeBody(method: string, statusCode: number): boolean {
  const m = method.toUpperCase();
  return m !== "HEAD" && m !== "CONNECT" && !NULL_BODY_STATUS.has(statusCode);
}

/** 応答の頭で br を見つけたら打ち切り、それ以外はそのまま `handler` に渡す。 */
function refuseBrotliHandler(
  method: string,
  handler: Dispatcher.DispatchHandler,
): Dispatcher.DispatchHandler {
  return {
    onRequestStart: (controller, context) =>
      handler.onRequestStart?.(controller, context),
    onRequestUpgrade: (controller, statusCode, headers, socket) =>
      handler.onRequestUpgrade?.(controller, statusCode, headers, socket),
    onResponseStart(controller, statusCode, headers, statusMessage) {
      if (
        willDecodeBody(method, statusCode) &&
        hasBrotliCoding(headers["content-encoding"])
      ) {
        // fetch の onResponseStart (展開の処理を作るところ) を呼ばずに打ち切る。
        controller.abort(new BrotliRefusedError());
        return;
      }
      handler.onResponseStart?.(controller, statusCode, headers, statusMessage);
    },
    onResponseData: (controller, chunk) =>
      handler.onResponseData?.(controller, chunk),
    onResponseEnd: (controller, trailers) =>
      handler.onResponseEnd?.(controller, trailers),
    onResponseError: (controller, error) =>
      handler.onResponseError?.(controller, error),
    onResponseStarted: () => handler.onResponseStarted?.(),
    onBodySent: (chunk) => handler.onBodySent?.(chunk),
    onRequestSent: () => handler.onRequestSent?.(),
  };
}

/** `Agent#compose` に渡す interceptor。 */
export const refuseBrotliInterceptor: Dispatcher.DispatcherComposeInterceptor =
  (dispatch) => (opts, handler) =>
    dispatch(opts, refuseBrotliHandler(opts.method ?? "GET", handler));

/** 呼び出し側のヘッダに、br を求めない `Accept-Encoding` を上書きして返す。 */
export function withSafeAcceptEncoding(headers: HeadersInit | undefined): Headers {
  const h = new Headers(headers);
  h.set("accept-encoding", SAFE_ACCEPT_ENCODING);
  return h;
}
