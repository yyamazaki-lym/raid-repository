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
 * CSP (TODO #33, 2.1+) — Report-Only で 1 段目投入後、本実装で enforce
 * 切替 (`Content-Security-Policy` ヘッダー)。
 *
 * dev mode (Next.js + Turbopack) は HMR / Fast Refresh で eval 系を
 * 使うため `'unsafe-eval'` が必要だが、production build では eval は
 * 不要なので外して攻撃面を狭める (production-only tighten)。
 *
 * 主要な許可先:
 * - script-src: self + unsafe-inline (theme pre-hydration script) +
 *   ([dev のみ] unsafe-eval)
 * - style-src: self + unsafe-inline (Tailwind v4 + styled-jsx) + Google Fonts
 * - font-src: self + data: (next/font fallback) + Google Fonts CDN
 * - img-src: self + data:/blob: + YouTube サムネ + Supabase Storage
 *   (背景画像) + Discord avatar CDN
 * - connect-src: self + Supabase (REST + Realtime WebSocket)
 * - frame-src: Google Sheets + character-sheets + YouTube embed
 * - frame-ancestors 'none' / object-src 'none' / base-uri 'self' /
 *   form-action 'self' で残りの攻撃面を最小化
 * - upgrade-insecure-requests で http→https を自動昇格
 *
 * 万一 enforce 切替で UI が壊れた場合は Report-Only に戻し、不足
 * origin を追加してから再 enforce する手順 (changelog 参照)。
 */
const isProduction = process.env.NODE_ENV === "production";
const scriptSrc = isProduction
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const cspDirectives = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // ユーザーがカテゴリ背景画像を任意の HTTPS ホスト (imgur 等) から
  // 貼るユースケース (TODO #17) があるため、img-src は `https:` 全許可。
  // CSP の他 directive (script/connect 等) は厳格に維持しているので、
  // 画像のみ広く開いても XSS / data exfil の実害は限定的。
  // self / data: / blob: は引き続き明示。
  "img-src 'self' data: blob: https:",
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
  // Enforce mode (TODO #33 second phase, 2.1, 2026-04-29). 違反は
  // ブラウザが block する。万一 UI が壊れた場合はキーを
  // `Content-Security-Policy-Report-Only` に戻して原因 origin を
  // `cspDirectives` に追加してから再 enforce する。
  {
    key: "Content-Security-Policy",
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
