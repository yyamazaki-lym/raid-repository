"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { BASE_MESSAGES, type Messages } from "./messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/**
 * 文言の差し替え口 (2026-09-09)。
 *
 * 既定は null で、その場合 `useMessages()` は常時読み込みぶん
 * (`BASE_MESSAGES`) を返す。設定ダイアログの部分木だけは
 * `SettingsMessagesProvider` が「常時ぶん + 設定辞書」を入れて上書きする
 * ため、設定辞書は設定ダイアログの lazy chunk にだけ載る (理由は
 * `messages.ts` の docstring)。
 *
 * ⚠ **公開するのは Provider ではなく context 自体**。Provider を
 * `settings/settings-messages.tsx` 側に置くことで、設定辞書の import が
 * この常時読み込みモジュールに入らないようにしている。
 */
export const MessagesContext = createContext<Messages | null>(null);

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
  // ⚠ hook は条件分岐の外で呼ぶ (呼ぶ順が変わると React が壊れる)。
  const locale = useContext(LocaleContext);
  const override = useContext(MessagesContext);
  // 上書きが無いときは設定セクションを持たない。型は分離前と同じ
  // `Messages` に見せる (どのセクションが常時ぶんかは
  // scripts/check-i18n-settings-dict.mjs が CI で守る)。
  return override ?? (BASE_MESSAGES[locale] as Messages);
}
