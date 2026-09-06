"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./locales";

/**
 * 表示言語を cookie に保存する Server Action。
 *
 * 認証は要らない (ブラウザごとの表示設定で、他人のデータに触れない)。
 * Set-Cookie は Server Function でしか出せないため Server Action にしている
 * (Next.js: Server Component の描画中には cookie を書けない)。cookie を
 * 書くと Next は現在のページと layout を再描画するので、呼び出し側は
 * `router.refresh()` を挟まなくても新しい言語で描き直される。
 */
export async function setLocaleAction(
  locale: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isLocale(locale)) return { ok: false, reason: "unsupported locale" };
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}
