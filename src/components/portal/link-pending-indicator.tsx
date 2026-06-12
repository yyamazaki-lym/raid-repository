"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * 2.9 (2026-06-11): `<Link>` 配下に置く遷移 pending インジケーター。
 *
 * cold start 等でサーバーの RSC 応答が遅い時、クリックしたのに何も
 * 起きない「無音 stuck」(TODO #54 part1) の正式対策。撤退した
 * next-nprogress-bar / 自前 progress bar (Vercel build SIGKILL) と違い、
 * Next 16 公式の `useLinkStatus` フックだけで完結する build-safe な実装。
 *
 * 挙動 (use-link-status docs のレイアウトシフト回避パターン準拠):
 *   - 固定サイズの dot を常時 render し、非 pending 時は visibility:
 *     hidden。呼び出し側で absolute 配置して flow から外す (flow に
 *     置くとタブ内余白が右に偏る)
 *   - pending になっても 150ms の animation-delay 内に遷移が完了すれば
 *     視認されない (prefetch 済みの高速遷移でフラッシュしない)
 *   - prefetch 済みルートでは pending 自体がスキップされるので、実際に
 *     出るのは「prefetch が無い/未完了 + サーバー応答待ち」の時だけ
 */
export function LinkPendingIndicator({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn("link-pending-dot", pending && "is-pending", className)}
    />
  );
}
