import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DynamicToaster } from "@/components/ui/toaster-dynamic";
import { ServerTextLocalizer } from "@/components/server-text-localizer";
import { SplashSwRegistrar } from "@/components/splash-sw-registrar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CSP_NONCE_HEADER } from "@/lib/csp";
import { PRE_HYDRATION_THEME_SCRIPT } from "@/lib/theme-store";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import "./globals.css";

// 2026-10-09: 本番ビルドが next/font/google (Orbitron) で 1 回落ちた (Turbopack の
// "next/font/google queries have exactly one entry")。ビルドのたびに Google Fonts へ
// 取りに行く依存を外すため、Google Fonts の latin サブセットの可変フォントを ./fonts/ に
// 置いて next/font/local で読む (ライセンスは ./fonts/OFL-*.txt)。太さの範囲と
// unicode-range は Google の CSS の latin ブロックと同じ値 (next/font の引数はリテラル
// しか書けないので 3 か所に同じ値を書いている)。latin 以外の文字はフォールバックで描く。
// 出どころ (URL・版・ハッシュ) は ./fonts/README.md。
//
// フォールバック (フォントに無い文字・読み込み中に使う Arial) は、next/font/local の
// 自動計算 (fontkit) だと next/font/google の値 (capsize の事前計算) と size-adjust が
// 1.5〜2.3% ずれる。`→` などはずっとフォールバックで描かれるので、自動計算を止め、
// 以前と同じ名前・同じ値の @font-face を globals.css に書いている。
const geistSans = localFont({
  src: "./fonts/geist-latin-wght.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
  style: "normal",
  adjustFontFallback: false,
  fallback: ["Geist Fallback"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
  style: "normal",
  adjustFontFallback: false,
  fallback: ["JetBrains Mono Fallback"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

// 可変フォント 1 本を、以前と同じく 500 / 600 / 700 / 800 の 4 つの @font-face で出す。
const orbitron = localFont({
  src: [
    { path: "./fonts/orbitron-latin-wght.woff2", weight: "500" },
    { path: "./fonts/orbitron-latin-wght.woff2", weight: "600" },
    { path: "./fonts/orbitron-latin-wght.woff2", weight: "700" },
    { path: "./fonts/orbitron-latin-wght.woff2", weight: "800" },
  ],
  variable: "--font-orbitron",
  display: "swap",
  style: "normal",
  adjustFontFallback: false,
  fallback: ["Orbitron Fallback"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: {
      default: "Raid Repository",
      template: "%s · Raid Repository",
    },
    description: m.app.description,
    applicationName: "Raid Repository",
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0e18",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 2.4 (2026-06-09) TODO #84: proxy.ts が CSP `script-src 'nonce-...'` と
  // `x-nonce` request header をリクエストごとに焼き込んでいる。pre-hydration
  // script の `nonce={...}` 属性に同値を付与しなければ CSP 違反で block される。
  // proxy が走らない経路 (テスト等) では nonce が無いケースもあり得るので
  // `?? undefined` で安全側に倒す (nonce 無し = production では script が
  // 通らないが、それは proxy 適用範囲外の異常系)。
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;
  // 2026-09-06: 表示言語 (cookie)。<html lang> と client 側の辞書選択に使う。
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      // Force dark mode + default theme. The pre-hydration script below may
      // swap `theme-evercold` for whichever theme the user previously picked,
      // so suppressHydrationWarning is required.
      className={`dark theme-evercold ${geistSans.variable} ${jetbrainsMono.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs synchronously before React hydrates — no flash of default theme.
          `suppressHydrationWarning`: browsers strip the `nonce` HTML attribute
          from the DOM after parsing (security feature). Server-rendered HTML
          has `nonce="..."`, client DOM has `nonce=""` → React hydration
          mismatch warning is expected, not a real bug. (TODO #84, 2.4)
        */}
        <script
           
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_THEME_SCRIPT }}
          suppressHydrationWarning
        />
      </head>
      <body className="bg-background text-foreground relative min-h-full overflow-x-hidden font-sans">
        {/* Ambient background layers (fixed so they don't scroll) */}
        <div
          aria-hidden
          className="bg-orbs pointer-events-none fixed inset-0 -z-20 overflow-hidden"
        />
        <div
          aria-hidden
          className="bg-grid bg-grid-animate pointer-events-none fixed inset-0 -z-10"
        />
        <div
          aria-hidden
          className="bg-scanlines pointer-events-none fixed inset-0 -z-10"
        />

        {/* Base UI Tooltip uses `delay` (formerly Radix's `delayDuration`). */}
        <LocaleProvider locale={locale}>
          <TooltipProvider delay={150}>
            <div className="relative z-0 flex min-h-screen flex-col">
              {children}
            </div>
          </TooltipProvider>
        </LocaleProvider>
        <DynamicToaster richColors position="top-center" theme="dark" />
        {/* 2026-10-01 監査 U-6: 英語表示のとき、トーストに出る Server Action の
            日本語の失敗理由を訳す。 */}
        <ServerTextLocalizer locale={locale} />
        {/*
          Vercel Speed Insights — Core Web Vitals (TTFB / LCP / FCP / CLS / INP) の RUM。
          Vercel Analytics — ページビュー / referrer / device 内訳。
          いずれも本番環境でのみ beacon を送信 (NODE_ENV=production)、dev / preview
          では noop。TODO #55 計測基盤として導入。
        */}
        <SpeedInsights />
        <Analytics />
        {/* Cold start スプラッシュ SW の登録/解除 (NEXT_PUBLIC_SPLASH_SW)。
            root layout に置くのは /login 含む全ページでキルスイッチの
            unregister 経路を動かすため。詳細は public/sw.js 冒頭コメント。 */}
        <SplashSwRegistrar />
      </body>
    </html>
  );
}
