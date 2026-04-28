"use client";

import dynamic from "next/dynamic";

/**
 * 1.9 (2026-04-28) — TODO #11 (パフォーマンス最適化):
 *
 * `LinkFormDialog` (~338 行) は新規 / 編集 / 削除トリガーで開く CRUD
 * ダイアログ。攻略リンク (strategy) と動画 (videos) の両ページに常時
 * mount されるため、本体を直接 import すると初期 client bundle に含まれて
 * しまう。`next/dynamic({ ssr: false })` で別 chunk 化。
 */
export const LinkFormDialog = dynamic(
  () =>
    import("./link-form-dialog").then((m) => ({
      default: m.LinkFormDialog,
    })),
  { ssr: false },
);
