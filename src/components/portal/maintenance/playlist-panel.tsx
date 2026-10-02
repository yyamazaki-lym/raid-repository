"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { type PlaylistImportNowItem } from "@/lib/server/categories-actions";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/**
 * YouTube 再生リスト取り込みの結果パネル (2026-10-02)。再生リスト 1 本 = 1 行。
 * Discord の結果パネル (`discord-panel.tsx`) と同じ見た目に揃える。
 */
export function PlaylistPanel({ items }: { items: PlaylistImportNowItem[] }) {
  const m = useMessages();
  return (
    <>
      <p className="mb-2 pr-6 text-[11px] font-medium tracking-normal text-muted-foreground">
        {m.maintenancePanels.playlistTitle}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {m.maintenancePanels.playlistNone}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <PlaylistIcon item={it} />
              <div className="min-w-0 flex-1 leading-relaxed">
                <span className="font-mono break-all text-foreground">
                  {it.category}/{it.playlistId}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {describePlaylist(it, m)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlaylistIcon({ item }: { item: PlaylistImportNowItem }) {
  if (!item.ok)
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden />;
  if (item.skipped === "deadline" || item.truncated || (item.failed ?? 0) > 0)
    return <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden />;
  if ((item.inserted ?? 0) > 0)
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden />;
  return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
}

function describePlaylist(it: PlaylistImportNowItem, m: Messages): string {
  const t = m.maintenancePanels;
  if (!it.ok) return t.playlistError(it.reason ?? t.discordUnknownReason);
  if (it.skipped === "deadline") return t.playlistDeadline;
  let text = t.playlistResult(it.found ?? 0, it.inserted ?? 0, it.duplicates ?? 0);
  if ((it.blocked ?? 0) > 0) text += t.playlistBlocked(it.blocked ?? 0);
  if ((it.failed ?? 0) > 0) text += t.playlistFailed(it.failed ?? 0);
  if (it.truncated) text += t.playlistTruncated;
  return text;
}
