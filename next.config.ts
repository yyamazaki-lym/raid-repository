import type { NextConfig } from "next";

/**
 * Security response headers (TODO #32, 2.1+).
 *
 * - `X-Frame-Options: DENY`
 *     iframe で portal を埋め込まれて clickjacking される攻撃を防ぐ。
 *     portal 自身が外部サイト (Google Sheets / character-sheets) を
 *     iframe で埋めるが、逆方向は禁止で問題なし。
 * - `Strict-Transport-Security` (HSTS)
 *     6 ヶ月の HTTPS 強制。Vercel は常時 HTTPS なのでブラウザに
 *     その事実をメモらせるだけ。`includeSubDomains` で *.vercel.app /
 *     カスタムドメインも保護。`preload` は HSTS preload list 申請後に
 *     有効化する想定で今は付けない。
 * - `Referrer-Policy: strict-origin-when-cross-origin`
 *     外部リンク遷移時に path / query を漏らさない (origin のみ送る)。
 *     OAuth callback などで内部 path が leak するのを防ぐ。
 * - `X-Content-Type-Options: nosniff`
 *     ブラウザの MIME sniffing を無効化。upload された画像が text/html
 *     扱いされて XSS になるのを防ぐ。
 * - `Permissions-Policy: ...`
 *     使わない機能 (camera / microphone / geolocation / payment 等) を
 *     全部 OFF にして、万一 XSS で乗っ取られても影響を最小化。
 */

/**
 * CSP (TODO #33, 2.1+) — まず Content-Security-Policy-Report-Only で
 * 本番投入する。違反があってもブラウザは block せずコンソールに記録
 * するだけなので、実 UI を壊さずに「足りない origin」を発見できる。
 *
 * 1 週間運用 → DevTools の violation を確認 → 不足 origin を追加 →
 * `Content-Security-Policy-Report-Only` のキーを `Content-Security-Policy`
 * に切り替えて enforce、という段階導入の想定。
 *
 * 主要な許可先:
 * - script-src: self + unsafe-inline (theme pre-hydration script + Next.js
 *   hydration) + unsafe-eval (Next.js / React DevTools / Turbopack)
 * - style-src: self + unsafe-inline (Tailwind v4 + styled-jsx) + Google Fonts
 * - font-src: self + data: (next/font fallback) + Google Fonts CDN
 * - img-src: self + data:/blob: + YouTube サムネ + Supabase Storage
 *   (背景画像) + Discord avatar CDN
 * - connect-src: self + Supabase (REST + Realtime WebSocket)
 * - frame-src: Google Sheets + character-sheets + YouTube embed
 * - frame-ancestors 'none' / object-src 'none' / base-uri 'self' /
 *   form-action 'self' で残りの攻撃面を最小化
 * - upgrade-insecure-requests で http→https を自動昇格
 */
const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-inline' は theme pre-hydration script で必須、'unsafe-eval' は
  // Next.js / React の internal で使われている可能性があるため当面残す。
  // 段階 2 で nonce ベース化できれば 'unsafe-inline' を外す。
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // i.ytimg.com: YouTube サムネ (next/image の remotePatterns と一致)
  // *.supabase.co: storage public URL (`category-backgrounds` bucket)
  // cdn.discordapp.com: Discord avatar (将来 user 表示で使う想定で先に許可)
  "img-src 'self' data: blob: https://i.ytimg.com https://*.supabase.co https://cdn.discordapp.com",
  // Supabase REST + Realtime WebSocket。ホストは *.supabase.co で固定。
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  // 軽減表 / ロット管理 (docs.google.com) + character-sheets スケジュール
  // + YouTube embed (動画タブで使う場合に備えて)
  "frame-src 'self' https://docs.google.com https://character-sheets.appspot.com https://www.youtube-nocookie.com https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000; includeSubDomains",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
  },
  // Report-Only モードで運用 → 1 週間 violation 観察後に enforce に切替。
  // Enforce 切替時はキーを `Content-Security-Policy` に変更するだけ。
  {
    key: "Content-Security-Policy-Report-Only",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    // Allow next/image to proxy YouTube thumbnails for the videos sub-tab.
    // Even though we render with `unoptimized`, declaring the pattern here
    // avoids compatibility issues with future image optimization choices.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
  async headers() {
    return [
      {
        // 全パスに上記ヘッダーを付与。/_next/static や画像 path も対象。
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
