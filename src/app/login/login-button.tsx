"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";

/**
 * Discord OAuth でサインインするだけのボタン。
 *
 * - `signInWithOAuth` は Supabase 側に組み込みの authorize URL を返すか、
 *   `skipBrowserRedirect: false` (default) でそのまま遷移してくれる。
 *   ここでは戻ってきた URL を window.location.assign で明示的に遷移させ
 *   ロード状態を出す。
 *
 * - scope は `identify` のみで十分。guild メンバーシップ確認は
 *   `/auth/callback` 側で **bot token** を使うので、ユーザー側の
 *   `guilds` / `guilds.members.read` は要らない (= 同意画面が短くなる)。
 */
export function LoginButton({ next }: { next: string }) {
  const m = useMessages();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setLoading(true);
    try {
      // B-3 (2026-06-15): Supabase client を動的 import で遅延化。未認証エント
      // リ /login の初期バンドルから `@supabase/ssr`/`supabase-js` を外す。
      // クリック後の OAuth リダイレクトに比べてチャンク取得の遅延は無視できる。
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo,
          scopes: "identify",
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.assign(data.url);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {/* 2026-09-06 再設計: Discord のブランド色 (blurple) はそのまま、
          高さ 12、角丸、hover で 1px 浮く。押下中は spinner。 */}
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 text-[14px] font-medium tracking-wide text-white shadow-[0_8px_24px_-10px_rgba(88,101,242,0.9),inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:-translate-y-px hover:bg-[#4f5be6] focus-visible:ring-2 focus-visible:ring-[#5865F2]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <LogIn className="h-4 w-4" aria-hidden />
        )}
        {loading ? m.login.buttonBusy : m.login.button}
      </button>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
