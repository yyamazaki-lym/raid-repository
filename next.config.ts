import type { NextConfig } from "next";

/**
 * Security response headers (TODO #32, 2.1+).
 *
 * 副作用が最小のものから先に enforce する方針。CSP は誤設定で画面が
 * 動かなくなるリスクが高いので別 TODO (#33) で段階導入。ここでは:
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
