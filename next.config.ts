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
 * CSP (TODO #33 → TODO #84, 2.4, 2026-06-09):
 * リクエスト固有 nonce を含む `Content-Security-Policy` ヘッダは
 * `src/proxy.ts` (proxy/middleware 経由) で生成・送信する設計に移行。
 * 静的ヘッダの一覧からは CSP を除外し、他のセキュリティヘッダ
 * (HSTS / X-Frame-Options / Referrer-Policy / X-Content-Type-Options /
 * Permissions-Policy) のみここに残す。詳細は `src/lib/csp.ts` を参照。
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

/**
 * Next.js 16 標準の version skew protection (TODO #11, 2.1+).
 *
 * `deploymentId` を設定すると Next.js は:
 *   - 静的アセット URL に `?dpl=<id>` 付与 (CDN キャッシュバスト)
 *   - クライアント nav リクエストに `x-deployment-id` ヘッダ送信
 *   - レスポンスの `x-nextjs-deployment-id` と mismatch なら自動で hard nav
 *
 * Vercel `VERCEL_GIT_COMMIT_SHA` を使うと commit 単位で id が切り替わるので
 * デプロイ毎に確実に変わる。Hobby plan で Skew Protection (Pro 限定) が無くても
 * 同等の挙動を得られる — 古いタブからのクリックは自動 hard nav に
 * フォールバックされ、ChunkErrorHandler の事後 reload に頼る必要がなくなる。
 *
 * ローカル dev では env 未設定 → undefined 扱いで何も起こらない (default 動作)。
 */
// Next.js は deploymentId に 32 文字以下を要求するが git SHA は 40 文字
// なので切り詰める。先頭 12 文字あれば衝突実用上 0 + 視認性◎。
const deploymentId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12);

const nextConfig: NextConfig = {
  ...(deploymentId ? { deploymentId } : {}),
  images: {
    // Allow next/image to proxy YouTube thumbnails for the videos sub-tab.
    // Even though we render with `unoptimized`, declaring the pattern here
    // avoids compatibility issues with future image optimization choices.
    //
    // `*.supabase.co` は Supabase Storage public bucket
    // (`category-backgrounds` 等) からの画像を Vercel Image Optimization
    // で WebP 変換するために宣言。pathname を /storage/v1/object/public/**
    // に絞って bucket 外のレスポンスを通さないようにする。
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
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
