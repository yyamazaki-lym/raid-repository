"use client";

import dynamic from "next/dynamic";

/**
 * `ScheduleEditFrameDialog` (Dialog base-ui primitive + iframe + 各種 UI)
 * を `next/dynamic` で別 chunk 化 (TODO #11 phase 10, 2.1, 2026-04-30)。
 * iframe で character-sheets を埋め込むダイアログで、ユーザ名 / 出欠セルの
 * クリックで初めて開く。`editTarget` state が null のときは render される
 * が中身は描画されないため、ここでは初回 chunk から完全に外す。
 */
export const ScheduleEditFrameDialog = dynamic(
  () =>
    import("./schedule-edit-frame-dialog").then((m) => ({
      default: m.ScheduleEditFrameDialog,
    })),
  { ssr: false },
);
