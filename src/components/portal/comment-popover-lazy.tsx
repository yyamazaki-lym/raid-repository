"use client";

import dynamic from "next/dynamic";

/**
 * `CommentPopover` (Popover base-ui primitive) を `next/dynamic` で別
 * chunk 化 (TODO #11 phase 10, 2.1, 2026-04-30)。スケジュール表のユーザ名
 * ヘッダーに mount される、コメントを表示する popover。click で初めて開く
 * ため SSR 不要。
 */
export const CommentPopover = dynamic(
  () =>
    import("./comment-popover").then((m) => ({
      default: m.CommentPopover,
    })),
  { ssr: false },
);
