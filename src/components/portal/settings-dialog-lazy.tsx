"use client";

import dynamic from "next/dynamic";
import type React from "react";

/**
 * 1.9 (2026-04-28) — TODO #11 (パフォーマンス最適化):
 *
 * `SettingsDialog` 本体は ~1601 行 + `MaintenanceMenu` (~880 行) を含み
 * 巨大だが、ヘッダー右上のボタン経由で「開いた時だけ」必要な UI。
 * これまで `site-header.tsx` から static import していたため初回ページ
 * ロードの client bundle に常時混入してリロードが遅くなっていた。
 *
 * `next/dynamic({ ssr: false })` で別 chunk に分離し、コンポーネントが
 * mount されるタイミング (= ヘッダーが描画される直後) でも別ファイルと
 * して fetch されるようにする。初期 paint が完了するまで blocking
 * しないので体感の重さが軽減する。
 *
 * trade-off: ボタン自体の表示にも一瞬 (ms オーダー) の遅延が出る可能性
 * あり。ヘッダーのボタンは critical path ではないので許容。
 */
export const SettingsDialog: React.ComponentType<{ canEdit: boolean }> =
  dynamic(
    () =>
      import("./settings-dialog").then((m) => ({
        default: m.SettingsDialog,
      })),
    { ssr: false },
  );
