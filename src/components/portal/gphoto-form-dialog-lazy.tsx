"use client";

import dynamic from "next/dynamic";

/**
 * Phase 16 (2026-05-13): `GphotoFormDialog` を `next/dynamic` で別 chunk 化。
 * 攻略タブにマウントされるが、開かれない限り入力 UI は不要なので初期
 * bundle から外す。image-form-dialog-lazy.tsx と同方針 (SSR 不要)。
 */
export const GphotoFormDialog = dynamic(
  () =>
    import("./gphoto-form-dialog").then((m) => ({
      default: m.GphotoFormDialog,
    })),
  { ssr: false },
);
