import type { Locale } from "./locales";
import type { DeepWiden } from "./widen";
import { ja as coreJa, en as coreEn } from "./dict/core";
import { ja as contentJa, en as contentEn } from "./dict/content";
import { ja as logsJa, en as logsEn } from "./dict/logs";

/**
 * UI 文言の辞書 — 合成層 (2026-09-07 に分割、2026-09-09 に設定辞書を分離)。
 *
 * 実体は `./dict/*.ts` にある。core = ログイン / ヘッダー / スケジュール周辺
 * (第 1〜2 段)、settings = 設定ダイアログの各セクション、content = 軽減表 /
 * ロット / 攻略 / 動画などのタブ + 運用メニュー、logs = 練習ログ / サブタブ /
 * カテゴリ一覧。呼び出し側 (`useMessages()` / `getMessages()`) からは分割前と
 * 同じ `Messages` に見せる。
 *
 * セクション名は 4 ファイルで重複させない (スプレッドは後勝ちで潰れる)。
 *
 * ## ⚠ 設定辞書 (`dict/settings.ts`) は runtime では合成しない (2026-09-09)
 *
 * 実測: `dict/*` 4 本を静的に合成して `MESSAGES[locale]` と添字アクセスする
 * 形だと、**ランタイム添字なので tree-shake が効かず**、ja / en 両方の全辞書が
 * 1 つの chunk (216KB raw / 72.5KB gz) になって**全ポータルページの初期 JS に
 * 載っていた**。設定辞書はその 31% を占めるのに、使うのは
 * `next/dynamic` で遅延化済みの設定ダイアログの中だけだった —
 * **既存の lazy 化が文言側で相殺されていた**。
 *
 * そこで:
 *
 * - この層 (`BASE_MESSAGES`) は core / content / logs だけを合成する
 * - 設定辞書は `components/portal/settings/settings-messages.tsx` の
 *   `SettingsMessagesProvider` が読み込み、設定ダイアログの部分木にだけ
 *   context で流す (= 設定ダイアログの lazy chunk に同居する)
 * - **型 (`Messages`) は分離前と同じ**。`typeof import(...)` は型だけの参照で
 *   出力に残らないので、設定セクションを型として合成しても JS は増えない
 *
 * ⚠ **設定セクション (`m.nativeMembers` 等) を設定ダイアログの外の Client
 * Component から読むと、型は通るのに runtime で `undefined` になる。**
 * どのセクションがどちらに属するかは `scripts/check-i18n-settings-dict.mjs`
 * が CI で見ており、外から参照すると落ちる。外でも要る文言は
 * `dict/content.ts` 側へ移すこと (maintenance / maintenancePanels / confirm /
 * maintenanceSchedule の 4 節が実際にそうなっている)。
 *
 * Server Component は `getMessages()` (server.ts) から読む。あちらは
 * **設定辞書も含めた全部**を返す — server バンドルは初期 client JS に載らず、
 * 設定セクションを使う Server Component もあるため。
 */
const jaBase = { ...coreJa, ...contentJa, ...logsJa } as const;

/** 常時読み込みぶん (core / content / logs) の型。 */
export type BaseMessages = DeepWiden<typeof jaBase>;

/** 設定辞書の型だけを参照する (`import type` 相当なので出力に残らない)。 */
type SettingsDict = DeepWiden<typeof import("./dict/settings").ja>;

/** 分離前と同じ「全部入り」の型。 */
export type Messages = BaseMessages & SettingsDict;

const enBase: BaseMessages = { ...coreEn, ...contentEn, ...logsEn };

/**
 * 常時読み込みぶんの辞書。
 *
 * ⚠ 設定セクションは**入っていない**。`Messages` として扱うのは
 * `useMessages()` / `getMessages()` の中だけにして、呼び出し側からは
 * 分離を見せない。
 */
export const BASE_MESSAGES: Record<Locale, BaseMessages> = {
  ja: jaBase,
  en: enBase,
};
