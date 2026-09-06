import type { DeepWiden } from "../widen";

/**
 * コンテンツタブ (軽減表 / ロット / 攻略 / 動画 / 練習ログ / サブタブ) の
 * 文言 (第 3 段、2026-09-07)。書き方は `./core.ts` と同じ: ja を正
 * (`as const`)、en は同じ形を型で強制。セクション名は core / settings と
 * 重複させない。
 */
export const ja = {
  content: {
    // 第 3 段で各タブの文言をここへ移す。
  },
} as const;

type ContentMessages = DeepWiden<typeof ja>;

export const en: ContentMessages = {
  content: {},
};
