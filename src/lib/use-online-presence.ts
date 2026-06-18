"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Supabase Realtime Presence で「今ポータルを開いているユニークメンバー数」
 * を購読するフック (総合レビュー F-4: ヘッダーの ONLINE 表示に意味付け)。
 *
 * - 全 portal クライアントが共通チャンネル `online-presence` に join する。
 * - presence key に本人の `selfKey` (= 本人由来の不可逆ハッシュ、server 側で
 *   生成。`getCurrentUserPresenceKey()` 参照) を使う。同一メンバーは決定的に
 *   同じ key に畳まれるため複数タブでも **1 カウント** (= メンバー単位の人数)。
 *   生の Discord ID を渡さないのは presence チャンネルが anon でも join でき
 *   `presenceState()` のキーが列挙されるため (露出防止)。
 * - `presence` の `sync` イベントで `presenceState()` の distinct key 数を数える。
 *   sync 前 / 接続失敗 (CHANNEL_ERROR / TIMED_OUT / CLOSED) 時は 0 を返す
 *   (表示側で「ONLINE」だけ出すフォールバック)。通信断中は presenceState() が
 *   stale な map を返し続けるため明示的に 0 へ戻し、再接続時の sync 再発火で
 *   正しい人数に自己回復させる。
 * - `enabled=false` のときは購読・track を一切行わず常に 0 を返す。demo ゲストは
 *   全員が固定 presence key に畳まれ「常に 1」の誤カウントになるため、呼び出し側
 *   (online-presence-indicator) が demo 時に false を渡して集計を止める用途。
 *
 * presence は Realtime のチャンネル機能で DB / RLS とは無関係。postgres_changes
 * 用の `useRealtimeTable` / `useRealtimeChannel` (C-4) とは別 API のため独立実装。
 */
export function useOnlinePresence(selfKey: string, enabled = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // 集計対象外 (demo ゲスト等) では購読・track をせず無駄な WS 接続と
    // 固定 key 畳み込みによる誤カウントを回避。count は初期 0 のまま。
    if (!enabled) return;
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
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // 通信断: stale な人数を出し続けないよう 0 に戻す。rejoin 後の
          // presence_state 再送 → sync 再発火で正しい人数に自己回復する。
          setCount(0);
        }
      });

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch (e) {
        console.warn("[online-presence] removeChannel error:", e);
      }
    };
  }, [selfKey, enabled]);

  return count;
}
