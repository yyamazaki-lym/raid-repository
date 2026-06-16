"use client";

import { useOnlinePresence } from "@/lib/use-online-presence";

/**
 * ヘッダー右上の「● ONLINE」表示。常時点灯の装飾だったものを、Supabase
 * Realtime Presence で取得した**オンライン中のメンバー数**を出す形に変更
 * (総合レビュー F-4)。`selfKey` は本人由来の不可逆ハッシュ (presence key、
 * server 側生成)。生の Discord ID を client に載せないための措置。
 *
 * 見た目は従来どおり (シアンの脈動ドット + mono の "ONLINE")。人数が取れたら
 * "ONLINE {n}" に、sync 前 / 取得不可なら従来どおり "ONLINE" を表示。
 * dot / text は親ヘッダーの flex に直接並ぶよう Fragment で返す (従来のレイ
 * アウト・gap を維持)。
 */
export function OnlinePresenceIndicator({ selfKey }: { selfKey: string }) {
  const count = useOnlinePresence(selfKey);
  return (
    <>
      <span
        aria-hidden
        className="hidden h-2 w-2 animate-pulse rounded-full bg-[var(--neon-cyan)] shadow-[0_0_10px_var(--neon-cyan)] motion-reduce:animate-none sm:inline-block"
      />
      <span
        className="hidden font-mono text-[11px] tracking-[0.22em] text-muted-foreground sm:inline"
        aria-label={count > 0 ? `オンライン ${count} 人` : undefined}
        title={count > 0 ? `現在 ${count} 人がオンライン` : undefined}
      >
        {count > 0 ? `ONLINE ${count}` : "ONLINE"}
      </span>
    </>
  );
}
