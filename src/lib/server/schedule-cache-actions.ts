"use server";

import { updateTag } from "next/cache";
import { SCHEDULE_CACHE_TAG } from "@/lib/schedule/next-session";
import { assertAdminResult } from "@/lib/server/auth";

/**
 * character-sheets HTML の Vercel Data Cache を即時無効化する。
 *
 * iframe edit dialog 閉じる時に呼び出して、ユーザーの編集を次回 fetch で
 * 確実に拾えるようにする。Next.js 16 の `updateTag` は Server Action 専用
 * の read-your-own-writes 向け API で、次リクエストは stale を返さず
 * blocking で fresh fetch を待つ。TODO #61 で `revalidatePath("/")` が
 * 外していた fetch cache 行も tag 単位で確実に invalidate できる。
 *
 * 認可 (2026-08-05 監査 M-4): **admin gate あり**。
 *
 * 以前は「cache miss を強制するだけで無害」として無ゲートだったが、この tag が
 * 保護しているのは 60 秒 `revalidate` 付きの**外部ホストへの fetch**
 * (`next-session.ts` の list + edit 2 本) で、無効化はブロッキング再フェッチを
 * 誘発する。`PUBLIC_DEMO_MODE=true` では proxy が gate を外すため未認証
 * ユーザーが next-action ヘッダ付きで連打でき、以降のページ表示すべてが
 * キャッシュを外れて外向き fetch が飛ぶ。この Server Action のパスは
 * `RATE_LIMIT_RULES` のどのルールにもマッチしないため、第三者ホストへの
 * 増幅と Vercel 関数課金の両方に効いてしまう。
 *
 * 唯一の呼び出し元は編集ダイアログ (`schedule-edit-frame-dialog.tsx`) で
 * admin しか開けないため、admin gate を入れても正規の導線には影響しない。
 * CSRF は Next の Server Action layer が body POST + Origin check で防御。
 */
export async function invalidateScheduleCache(): Promise<void> {
  const gate = await assertAdminResult();
  if (!gate.ok) return; // 非 admin は no-op (UI 側にエラーを出す必要はない)
  updateTag(SCHEDULE_CACHE_TAG);
}
