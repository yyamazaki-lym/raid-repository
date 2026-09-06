"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** root layout が cookie から決めた言語を client 側へ配る。 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  return MESSAGES[useContext(LocaleContext)];
}
