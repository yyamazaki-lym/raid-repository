"use client";

import { LogOut } from "lucide-react";

/**
 * サインアウトボタン。誤クリック防止のため `window.confirm` で 1 段
 * 噛ませてから `/auth/sign-out` に POST する。
 *
 * 本体ロジックは `<form action="/auth/sign-out" method="post">` のまま
 * (= JS 無し環境でもサーバー側 route に到達できる progressive enhancement)。
 * `onSubmit` で false を返すと submit が止まる。
 */
export function SignOutButton() {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!window.confirm("サインアウトしますか?")) {
      e.preventDefault();
    }
  };

  return (
    <form action="/auth/sign-out" method="post" onSubmit={onSubmit}>
      <button
        type="submit"
        aria-label="サインアウト"
        title="サインアウト"
        className="grid h-9 w-9 place-items-center rounded-md border border-border/40 bg-background/40 text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}
