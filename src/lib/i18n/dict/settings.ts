import type { DeepWiden } from "../widen";

/**
 * 設定ダイアログの各セクションの文言 (第 3 段、2026-09-07)。
 * 書き方は `./core.ts` と同じ: ja を正 (`as const`)、en は同じ形を型で強制。
 * セクション名は core / content と重複させない。
 */
export const ja = {
  settingsSections: {
    // 第 3 段で各セクションの文言をここへ移す。
  },
} as const;

type SettingsMessages = DeepWiden<typeof ja>;

export const en: SettingsMessages = {
  settingsSections: {},
};
