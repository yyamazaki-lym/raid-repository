"use client";

import { useEffect, useState } from "react";
import {
  fetchUnresolvedLogNamesAction,
  type UnresolvedLogName,
} from "@/lib/server/attendance-unresolved-actions";
import type { NativeMemberRowFull } from "@/lib/schedule/native-admin-client";
import { useMessages } from "@/lib/i18n/client";

/**
 * 出席の突合で、ログに出たがどのメンバーにも一致しなかった名前 (2026-10-06)。
 *
 * 実機で「出席サマリーが 0 日のまま」だった原因は、メンバーの「ログ名」が
 * 全員空で、表示名 (Discord の名前) が FFLogs のキャラ名と一致しないこと
 * だった。何を入れればよいかは同期のトーストにしか出ていなかったので、
 * メンバー一覧の下に出して、そのままメンバーの「ログ名」に割り当てられる
 * ようにする。割り当ては下書きに入るだけで、保存は行ごとの「保存」ボタン
 * (他の欄と同じ流れ)。
 *
 * 一覧は `members` が変わるたびに取り直す — ログ名を保存すると一覧から
 * 消える (サーバー側で今のメンバーに一致する名前を外している)。
 * 名前が 1 つも無ければ何も出さない。
 */
export function UnresolvedLogNames({
  members,
  disabled,
  onAssign,
}: {
  members: NativeMemberRowFull[];
  disabled: boolean;
  /** 名前をそのメンバーの「ログ名」の下書きに入れる。 */
  onAssign: (discordUserId: string, name: string) => void;
}) {
  const m = useMessages();
  const [names, setNames] = useState<UnresolvedLogName[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchUnresolvedLogNamesAction()
      .then((r) => {
        if (cancelled) return;
        // 取れなかったときは黙って出さない (補助の一覧なので設定画面の
        // 他の操作を邪魔しない。理由はサーバーのログに残る)。
        setNames(r.ok ? r.names : []);
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [members]);

  if (names.length === 0) return null;

  return (
    <div
      data-unresolved-log-names
      className="flex flex-col gap-1.5 rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2"
    >
      <span className="text-[12px] text-amber-200">
        {m.nativeMembers.unresolvedTitle(names.length)}
      </span>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {m.nativeMembers.unresolvedHint}
      </p>
      <ul className="flex flex-col gap-1">
        {names.map((n) => (
          <li
            key={n.name}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span className="font-mono text-[12px] text-foreground">{n.name}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {m.nativeMembers.unresolvedMeta(n.pulls, n.lastSessionDate)}
            </span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onAssign(e.target.value, n.name);
              }}
              disabled={disabled}
              aria-label={m.nativeMembers.unresolvedAssignAria(n.name)}
              className="ml-auto h-7 max-w-[11rem] min-w-0 rounded-md border border-border/50 bg-background/60 px-1 text-xs text-foreground"
            >
              <option value="">{m.nativeMembers.unresolvedAssign}</option>
              {members.map((mem) => (
                <option key={mem.discord_user_id} value={mem.discord_user_id}>
                  {mem.display_name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
