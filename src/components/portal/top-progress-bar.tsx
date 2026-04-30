"use client";

import { AppProgressBar } from "next-nprogress-bar";

/**
 * 2.1 (2026-04-30) TODO #54: デプロイ直後の遷移時 stuck 対策。
 *
 * 症状: deploy 後初回アクセスや動画/カテゴリページ遷移で、Server
 * Component の Supabase fetch が cold start で数秒詰まる間、Next.js
 * App Router 仕様上「前ページのまま静止」するためユーザーには
 * 「クリックしても何も起きない」無音 stuck に見える。
 *
 * 対策: 上端に薄い top progress bar を 1 本表示。`usePathname` 変化を
 * ライブラリ側が listen し、遷移開始 → 完了の間だけバーを描画する。
 * skeleton と違いコンテンツ領域は触らないため、過去 (1.9 系) に
 * ユーザー指示で撤去した「Suspense streaming + skeleton」とは別解。
 *
 * cold start 自体は残るが「何かが起きている」がユーザーに即伝わり、
 * 体感の主問題 (= 完全無音) を解決する。
 */
export function TopProgressBar() {
  return (
    <AppProgressBar
      height="2px"
      color="#06b6d4"
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
