"use client";

import { useMemo, type ReactNode } from "react";
import { MessagesContext, useLocale } from "@/lib/i18n/client";
import { BASE_MESSAGES, type Messages } from "@/lib/i18n/messages";
import { ja as settingsJa, en as settingsEn } from "@/lib/i18n/dict/settings";

/**
 * 設定辞書を設定ダイアログの部分木にだけ流す (2026-09-09)。
 *
 * ## なぜこのファイルが必要か
 *
 * 実測: `dict/*` 4 本を静的に合成して `MESSAGES[locale]` と添字アクセスする
 * 形だと **ランタイム添字で tree-shake が効かず**、ja / en 全辞書が 1 つの
 * chunk (216KB raw / 72.5KB gz) になって**全ポータルページの初期 JS に載って
 * いた**。設定辞書はその 31% を占めるのに、使うのは `next/dynamic` で
 * 遅延化済みの設定ダイアログの中だけ — 既存の lazy 化が文言側で
 * 相殺されていた。
 *
 * ⚠ **この import (`dict/settings`) が置かれる場所が本質。** このファイルは
 * `settings-dialog.tsx` からしか import されず、そちらは
 * `settings-dialog-lazy.tsx` の `next/dynamic` 経由でしか読まれないので、
 * 設定辞書は**設定ダイアログの chunk に同居する**。常時読み込みの
 * `lib/i18n/client.tsx` から import してしまうと元に戻るので注意。
 *
 * ⚠ **設定セクションを設定ダイアログの外から読んではいけない。** 型は
 * 分離前と同じ `Messages` なので tsc は通るが、runtime では `undefined` に
 * なる。`scripts/check-i18n-settings-dict.mjs` が CI で見ている。外でも要る
 * 文言は `dict/content.ts` 側へ移すこと。
 */
export function SettingsMessagesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const locale = useLocale();
  const value = useMemo<Messages>(
    () =>
      ({
        ...BASE_MESSAGES[locale],
        ...(locale === "en" ? settingsEn : settingsJa),
      }) as Messages,
    [locale],
  );
  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
}
