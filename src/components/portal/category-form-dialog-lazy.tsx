"use client";

import dynamic from "next/dynamic";

/**
 * 1.9 (2026-04-28) — TODO #11 (パフォーマンス最適化):
 *
 * `CategoryFormDialog` (~487 行) は新規追加 / 編集ボタンで開く CRUD
 * ダイアログ。category 一覧ページに常時 mount されるため、本体を直接
 * import すると初期ページ load 時の client bundle に含まれてしまう。
 *
 * `next/dynamic({ ssr: false })` で別 chunk に分離し、ダイアログ本体の
 * fetch を初期 paint と並行にする。トリガーボタン自体はラッパー側で
 * 即時表示されるので体感のレスポンス低下は無し。
 */
export const CategoryFormDialog = dynamic(
  () =>
    import("./category-form-dialog").then((m) => ({
      default: m.CategoryFormDialog,
    })),
  { ssr: false },
);
