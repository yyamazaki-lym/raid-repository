"use client";

import dynamic from "next/dynamic";

/**
 * `LinkCardMenu` (DropdownMenu base-ui primitive を含む) を `next/dynamic`
 * で別 chunk 化 (TODO #11 phase 10, 2.1, 2026-04-30)。動画 / 攻略リンク
 * 一覧の各カードに mount される三点メニュー。トリガーボタン (⋮) を押した
 * ときに初めて開くため SSR 不要、client 初回 bundle から除外する。
 *
 * loading は何も描画しない (省略時のデフォルト)。chunk load 中は ⋮ ボタン
 * が一瞬遅れて出現するが、admin 用 menu のため非 admin 描画ガード経路では
 * そもそも render されず影響無し。
 */
export const LinkCardMenu = dynamic(
  () =>
    import("./link-card-menu").then((m) => ({
      default: m.LinkCardMenu,
    })),
  { ssr: false },
);
