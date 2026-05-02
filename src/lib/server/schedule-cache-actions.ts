"use server";

import { updateTag } from "next/cache";
import { SCHEDULE_CACHE_TAG } from "@/lib/schedule/next-session";

/**
 * character-sheets HTML の Vercel Data Cache を即時無効化する。
 *
 * iframe edit dialog 閉じる時に呼び出して、ユーザーの編集を次回 fetch で
 * 確実に拾えるようにする。Next.js 16 の `updateTag` は Server Action 専用
 * の read-your-own-writes 向け API で、次リクエストは stale を返さず
 * blocking で fresh fetch を待つ。TODO #61 で `revalidatePath("/")` が
 * 外していた fetch cache 行も tag 単位で確実に invalidate できる。
 *
 * 認可: 編集権の有無に関わらず無害な操作 (cache miss を強制するだけ)
 * なので gate なし。CSRF は Next の Server Action layer が body POST +
 * Origin check で防御。
 */
export async function invalidateScheduleCache(): Promise<void> {
  updateTag(SCHEDULE_CACHE_TAG);
}
