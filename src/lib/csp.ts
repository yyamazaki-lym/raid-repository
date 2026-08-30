/**
 * Content Security Policy ヘルパ (TODO #84, 2.4, 2026-06-09)。
 *
 * proxy.ts でリクエストごとに nonce を生成し、CSP ヘッダの `script-src
 * 'nonce-...'` ディレクティブと、Server Component 側で読む `x-nonce`
 * カスタム request header の双方に書き込む。layout.tsx は `headers()`
 * で `x-nonce` を取得し、theme pre-hydration script の `nonce` 属性に
 * 焼き込む。
 *
 * 設計判断:
 * - **script-src** から `'unsafe-inline'` を撤去、`'self' 'nonce-...'`
 *   に置換。これが本 TODO の主目的 (XSS 経路を縮める)。`'strict-dynamic'`
 *   は採用しない理由: それを書くと `'self'` 等の allowlist が無効化され、
 *   `@vercel/analytics` / `@vercel/speed-insights` が injection する
 *   `<script src>` (同一オリジン) が nonce を持たないと block されかねない
 *   ため、互換寄りに `'self'` を残す。`'self'` 範囲内の悪意ある script
 *   は本 portal のユースケースでは起こり得ない (ユーザー JS upload なし)。
 * - **style-src** は `'unsafe-inline'` を維持 (本 TODO スコープ外)。
 *   理由: React の `style={{...}}` props (inline element-level style 属性)、
 *   Base UI / sonner / Tailwind v4 が広く inline style に依存しており、
 *   nonce 化には大規模な改修コストが必要。`style-src-elem` / `style-src-attr`
 *   分割案は CSP Level 3 でブラウザ互換が割れる。改善余地は別 TODO 候補。
 *   **2026-06-11 セキュリティ監査**: 上記の改修コストと互換性リスクを踏まえ
 *   現状維持と判断 (受容リスク)。script-src は nonce 化済みで XSS の主経路は
 *   塞がれており、inline style 経由の残存リスクは限定的。
 * - **dev mode** (Turbopack / React Refresh) は `'unsafe-eval'` を script-src
 *   に追加。React が source map 復元で eval する。production では削除。
 */

import "server-only";

export const CSP_NONCE_HEADER = "x-nonce";

/**
 * 32 byte ランダムを base64 化した nonce を生成。CSP3 仕様で nonce は
 * 「128 bit 以上のランダム文字列」が推奨されているため十分。
 */
export function generateCspNonce(): string {
  // Vercel Functions (Node.js 24 LTS) では crypto は global。
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * 指定 nonce を埋め込んだ CSP ヘッダ値を組み立てる。
 *
 * dev (`NODE_ENV !== 'production'`) では Turbopack / React Refresh の
 * `eval` 系を許可するため `'unsafe-eval'` を script-src に追加。
 */
export function buildCspHeader(nonce: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const scriptSrc = isProduction
    ? `script-src 'self' 'nonce-${nonce}'`
    : `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`;

  const directives = [
    "default-src 'self'",
    scriptSrc,
    // style-src の `'unsafe-inline'` は本 TODO スコープ外で維持。詳細は
    // モジュール冒頭の設計判断を参照。
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // ユーザーがカテゴリ背景画像を任意の HTTPS ホスト (imgur 等) から
    // 貼るユースケース (TODO #17) があるため、img-src は `https:` 全許可。
    "img-src 'self' data: blob: https:",
    // Supabase REST + Realtime WebSocket。ホストは *.supabase.co で固定。
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    // 軽減表 / ロット管理 (docs.google.com) + character-sheets +
    // YouTube embed (動画タブで使う場合に備えて)
    // 2026-08-30: XivGear の埋め込みビュー (BiS プレビュー) を追加。
    // 公式の `?page=embed|sl|<uuid>` を iframe で読むため。
    "frame-src 'self' https://docs.google.com https://character-sheets.appspot.com https://www.youtube-nocookie.com https://www.youtube.com https://xivgear.app",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}
