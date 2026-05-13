"use client";

import dynamic from "next/dynamic";

/**
 * Phase 15 (2.x, 2026-05-13): `ImageFormDialog` を `next/dynamic` で
 * 別 chunk 化。攻略タブにマウントされるが、開かれない限りファイル選択
 * UI や Storage upload 経路は不要なので初期 bundle から外す。
 * link-form-dialog-lazy.tsx と同方針 (SSR 不要)。
 */
export const ImageFormDialog = dynamic(
  () =>
    import("./image-form-dialog").then((m) => ({
      default: m.ImageFormDialog,
    })),
  { ssr: false },
);
