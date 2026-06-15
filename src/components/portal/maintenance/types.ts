/**
 * maintenance-menu の本体と結果パネルで共有する型。
 *
 * `"use server"` モジュール (`categories-actions`) は純粋な型を re-export でき
 * ないため、Discord 投稿日時 backfill の結果型をここに inline 定義し、本体
 * (`maintenance-menu.tsx`) と `video-meta-panel.tsx` の双方から import する
 * (循環 import を避けるための独立モジュール)。
 */
export type PostedAtBackfillResult = {
  ok: boolean;
  reason?: string;
  scannedMessages: number;
  scannedUrls: number;
  matched: number;
  updated: number;
  channels: Array<{
    categorySlug: string;
    kind: "strategy" | "video";
    ok: boolean;
    reason?: string;
    scanned: number;
    updated: number;
  }>;
};
