import type { DeepWiden } from "../widen";

/**
 * 練習ログ (logs-view) / サブタブ / カテゴリ一覧の文言 (第 3 段、2026-09-07)。
 * 書き方は `./core.ts` と同じ: ja を正 (`as const`)、en は同じ形を型で強制。
 * セクション名は core / settings / content と重複させない。
 */
export const ja = {
  logs: {
    // 第 3 段で練習ログの文言をここへ移す。
  },
} as const;

type LogsMessages = DeepWiden<typeof ja>;

export const en: LogsMessages = {
  logs: {},
};
