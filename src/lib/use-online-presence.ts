"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Supabase Realtime Presence で「今ポータルを開いているユニークメンバー数」
 * を購読するフック (総合レビュー F-4: ヘッダーの ONLINE 表示に意味付け)。
 *
 * - 全 portal クライアントが共通チャンネル `online-presence` に join する。
 * - presence key に本人の `selfKey` (= Discord ID) を使うため、同一メンバーの
 *   複数タブは同じ key に畳まれ **1 カウント**になる (= メンバー単位の人数)。
 * - `presence` の `sync` イベントで `presenceState()` の distinct key 数を数える。
 *   sync 前 / 接続失敗時は 0 を返す (表示側で「ONLINE」だけ出すフォールバック)。
 *
 * presence は Realtime のチャンネル機能で DB / RLS とは無関係。postgres_changes
 * 用の `useRealtimeTable` / `useRealtimeChannel` (C-4) とは別 API のため独立実装。
 */
export function useOnlinePresence(selfKey: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("online-presence", {
      config: { presence: { key: selfKey } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        // presenceState(): { [key]: meta[] }。key 数 = ユニークメンバー数。
        setCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[online-presence] removeChannel error:", e);
      }
    };
  }, [selfKey]);

  return count;
}
