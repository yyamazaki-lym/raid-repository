"use client";

import { useState } from "react";

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
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-[#5865F2] px-4 text-sm font-medium text-white shadow-[0_0_18px_-4px_rgba(88,101,242,0.6)] transition hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "…" : "Discord でログイン"}
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
