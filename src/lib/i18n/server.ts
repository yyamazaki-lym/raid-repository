import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./locales";
import { BASE_MESSAGES, type Messages } from "./messages";
// ⚠ Server Component は設定セクションも読むので、こちらは**全部入り**を返す
// (server バンドルは初期 client JS に載らない)。client 側の分離の理由は
// `messages.ts` の docstring を参照。
import { ja as settingsJa, en as settingsEn } from "./dict/settings";

/**
 * リクエストの表示言語 (cookie `rr_locale`)。React.cache で 1 リクエスト 1 回。
 * root layout がこれで `<html lang>` と `LocaleProvider` を決めるので、
 * Server Component はここから、Client Component は `useLocale()` から読む。
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
});

const FULL: Record<Locale, Messages> = {
  ja: { ...BASE_MESSAGES.ja, ...settingsJa } as Messages,
  en: { ...BASE_MESSAGES.en, ...settingsEn } as Messages,
};

export async function getMessages(): Promise<Messages> {
  return FULL[await getLocale()];
}
