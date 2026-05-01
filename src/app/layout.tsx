import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Orbitron } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DynamicToaster } from "@/components/ui/toaster-dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PRE_HYDRATION_THEME_SCRIPT } from "@/lib/theme-store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Raid Repository",
    template: "%s · Raid Repository",
  },
  description:
    "FF14レイド固定向けポータル — スケジュール、ロット管理、軽減表、攻略情報を一箇所に。",
  applicationName: "Raid Repository",
};

export const viewport: Viewport = {
  themeColor: "#0a0e18",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      // Force dark mode + default theme. The pre-hydration script below may
      // swap `theme-evercold` for whichever theme the user previously picked,
      // so suppressHydrationWarning is required.
      className={`dark theme-evercold ${geistSans.variable} ${jetbrainsMono.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs synchronously before React hydrates — no flash of default theme. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_THEME_SCRIPT }}
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
        <TooltipProvider delay={150}>
          <div className="relative z-0 flex min-h-screen flex-col">
            {children}
          </div>
        </TooltipProvider>
        <DynamicToaster richColors position="top-center" theme="dark" />
        {/*
          Vercel Speed Insights — 本番環境でのみデータを送信 (NODE_ENV=production)。
          dev / preview では beacon を投げないため localhost への影響なし。
          TODO #55 計測基盤として導入 (TTFB / LCP / FCP / CLS / INP の RUM)。
        */}
        <SpeedInsights />
      </body>
    </html>
  );
}
