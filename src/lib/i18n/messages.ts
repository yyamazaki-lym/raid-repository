import type { Locale } from "./locales";
import type { DeepWiden } from "./widen";
import { ja as coreJa, en as coreEn } from "./dict/core";
import { ja as settingsJa, en as settingsEn } from "./dict/settings";
import { ja as contentJa, en as contentEn } from "./dict/content";
import { ja as logsJa, en as logsEn } from "./dict/logs";

/**
 * UI 文言の辞書 — 合成層 (2026-09-07 に分割)。
 *
 * 実体は `./dict/*.ts` にある。core = ログイン / ヘッダー / スケジュール周辺
 * (第 1〜2 段)、settings = 設定ダイアログの各セクション、content = 軽減表 /
 * ロット / 攻略 / 動画などのタブ、logs = 練習ログ / サブタブ / カテゴリ一覧。
 * ここでは 4 つをスプレッドで 1 つにし、呼び出し側
 * (`useMessages()` / `getMessages()`) からは分割前と同じ `Messages` に見せる。
 *
 * セクション名は 4 ファイルで重複させない (スプレッドは後勝ちで潰れる)。
 */
const ja = { ...coreJa, ...settingsJa, ...contentJa, ...logsJa } as const;

/** ja と同じ形。関数の引数も揃える。 */
export type Messages = DeepWiden<typeof ja>;

const en: Messages = { ...coreEn, ...settingsEn, ...contentEn, ...logsEn };

export const MESSAGES: Record<Locale, Messages> = { ja, en };
