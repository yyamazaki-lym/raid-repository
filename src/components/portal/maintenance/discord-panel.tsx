"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { type ImportNowItem } from "@/lib/server/categories-actions";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/** Discord 取り込みの結果パネル (maintenance-menu から分離、C-5)。 */
export function DiscordPanel({ items }: { items: ImportNowItem[] }) {
  const m = useMessages();
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        {m.maintenancePanels.discordTitle}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{m.maintenancePanels.discordNoChannels}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <DiscordIcon item={it} />
              <div className="flex-1 leading-relaxed">
                <span className="font-mono text-foreground">
                  {it.category}/{it.kind}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {describeDiscord(it, m)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DiscordIcon({ item }: { item: ImportNowItem }) {
  if (!item.ok)
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden />;
  if (item.skipped === "disabled")
    return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
  if (item.failed > 0)
    return <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden />;
  if (item.inserted > 0)
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden />;
  return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
}

function describeDiscord(it: ImportNowItem, m: Messages): string {
  const t = m.maintenancePanels;
  if (!it.ok) return t.discordError(it.reason ?? t.discordUnknownReason);
  if (it.skipped === "disabled") return t.discordPaused;
  if (it.scanned === 0) {
    // Phase 13.1: フィルタ判定前に URL は見つかっていたが全件フィルタで弾かれた
    // ケースを「Bot 権限不足」と誤判定しない。prefilteredCount > 0 なら原因は
    // フィルタ設定なので、その旨を表示してユーザーに見直しを促す。
    if ((it.prefilteredCount ?? 0) > 0) {
      // Phase 13.3: フィルタ全件除外時、タイトル取得成功数も併記して
      // 「タイトル取得失敗 (0/N) が原因」なのか「ワード不一致が原因」なのかを
      // 区別できるようにする。titleFetchedCount は fresh (DB 未登録) URL 限定
      // なので、`prefilteredCount` (= 抽出ユニーク総数) と必ずしも一致しない。
      const tail =
        typeof it.titleFetchedCount === "number"
          ? t.discordTitleFetched(it.titleFetchedCount)
          : "";
      return t.discordAllFiltered(it.prefilteredCount ?? 0, tail);
    }
    return t.discordNoUrls;
  }
  if (it.failed > 0)
    return t.discordFailed(it.scanned, it.failed, it.reason ? " — " + it.reason : "");
  if (it.inserted > 0) return t.discordInserted(it.inserted, it.duplicates);
  return t.discordAllDup(it.duplicates);
}
