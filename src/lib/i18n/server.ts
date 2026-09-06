import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

/**
 * リクエストの表示言語 (cookie `rr_locale`)。React.cache で 1 リクエスト 1 回。
 * root layout がこれで `<html lang>` と `LocaleProvider` を決めるので、
 * Server Component はここから、Client Component は `useLocale()` から読む。
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
});

export async function getMessages(): Promise<Messages> {
  return MESSAGES[await getLocale()];
}
