"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, ExternalLink, Film } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { safeHref } from "@/lib/url-safe";
import { useScrollClosingMenu } from "@/lib/use-scroll-closing-menu";
import type { SessionLogEntry } from "@/lib/schedule/session-logs";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

/**
 * Action icons (Film + BarChart3) for a session row's date cell.
 * 1.9.27 仕様で 2 スロット分は常に確保 (透明 spacer で揃える)。
 *
 * TODO #1 (2.1, 2026-05-01): 同日複数動画 / 複数 Logs を扱えるように
 * 単一リンク or DropdownMenu を分岐:
 * - 0 件: 透明 spacer
 * - 1 件: 従来通り `<a>` / `<Link>` で 1 クリック直行
 * - 2+ 件: DropdownMenu に切替、各候補をリスト表示
 *
 * Logs 候補は次の和集合 + URL dedup:
 * (A) 各動画の `logsUrl` (= category_links.logs_url 由来)
 * (B) `sessionLogs[]` (= schedule_past_session_logs 由来、TODO #64 で
 *     1:N 化。auto / manual 両方を平等に candidate に積む)
 */
export function SessionActionIcons({
  videoLinks,
  sessionLogs,
  isPast,
  displayDate,
  size = "default",
  placeholder = true,
}: {
  videoLinks: SessionVideoLink[];
  sessionLogs: SessionLogEntry[];
  isPast: boolean;
  displayDate: string;
  /**
   * `default` (h-5 w-5 trigger / h-3 w-3 icon) for the detail table.
   * `compact` (h-4 w-4 trigger / h-2.5 w-2.5 icon) for tight chips
   * (TODO #65: schedule-past-simple).
   */
  size?: "default" | "compact";
  /**
   * When `true` (default), empty slots render an invisible spacer so
   * adjacent rows stay column-aligned. Chips disable this so the chip
   * doesn't grow when there's no video / Logs URL for the date.
   */
  placeholder?: boolean;
}) {
  // TODO #65 (2.1, 2026-05-02 part6): non-modal dropdowns that close
  // on page scroll. `useScrollClosingMenu` returns `{open, onOpenChange,
  // modal:false}` — spread once per dropdown.
  const filmMenu = useScrollClosingMenu();
  const logsMenu = useScrollClosingMenu();
  const triggerSizeClass = size === "compact" ? "h-4 w-4" : "h-5 w-5";
  const iconSizeClass = size === "compact" ? "h-2.5 w-2.5" : "h-3 w-3";
  // -- Film slot: 動画候補 --
  let filmSlot: ReactNode;
  if (videoLinks.length === 0) {
    filmSlot = placeholder ? (
      <span aria-hidden className={`inline-block ${triggerSizeClass} shrink-0`} />
    ) : null;
  } else if (videoLinks.length === 1) {
    filmSlot = renderSingleVideoLink(videoLinks[0]!, isPast, size);
  } else {
    filmSlot = (
      <DropdownMenu {...filmMenu}>
        <DropdownMenuTrigger
          aria-label={`${displayDate} の動画 ${videoLinks.length} 件から選択`}
          title={`動画 ${videoLinks.length} 件 — クリックで選択`}
          className={`relative inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)] data-popup-open:bg-[var(--neon-cyan)]/15 data-popup-open:text-[var(--neon-cyan)]`}
        >
          <Film className={iconSizeClass} aria-hidden />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-[var(--neon-cyan)] px-0.5 font-mono text-[8px] leading-none text-background"
          >
            {videoLinks.length}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} disableAnchorTracking>
          {videoLinks.map((v) => {
            // TODO #65 (2.1, 2026-05-02 part6): native `title` tooltip
            // on each row so hovering reveals the full label even when
            // the visible text is `truncate`-ellipsized. Mirrors the
            // 1-link case which already gets tooltip via `<a title>`.
            const itemTitle = `${v.categoryName}/動画 → 「${v.videoTitle}」${isPast ? " (外部リンク)" : ""}`;
            return (
            <DropdownMenuItem
              key={v.url}
              render={(props) => {
                if (isPast) {
                  return (
                    <a
                      {...props}
                      href={safeHref(v.url) ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={itemTitle}
                    />
                  );
                }
                return (
                  <Link
                    {...props}
                    href={v.href}
                    prefetch={false}
                    title={itemTitle}
                  />
                );
              }}
            >
              <Film className="h-3.5 w-3.5 text-[var(--neon-cyan)]/85" aria-hidden />
              <span className="truncate">
                {v.categoryName} / {v.videoTitle}
              </span>
              {isPast && (
                <ExternalLink
                  className="ml-auto h-3 w-3 text-muted-foreground/60"
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // -- Logs slot: Logs URL 候補 (動画の logsUrl 集約 + sessionLogs[])
  // を URL で dedup し、出現順を維持 --
  const logsCandidates: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const v of videoLinks) {
    const safe = safeHref(v.logsUrl);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    logsCandidates.push({
      url: safe,
      label: `${v.categoryName} / ${v.videoTitle}`,
    });
  }
  for (const entry of sessionLogs) {
    const safe = safeHref(entry.url);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    logsCandidates.push({
      url: safe,
      label:
        entry.source === "auto"
          ? "セッション登録分 (auto)"
          : "セッション登録分",
    });
  }

  let logsSlot: ReactNode;
  if (logsCandidates.length === 0) {
    logsSlot = placeholder ? (
      <span aria-hidden className={`inline-block ${triggerSizeClass} shrink-0`} />
    ) : null;
  } else if (logsCandidates.length === 1) {
    logsSlot = (
      <a
        href={logsCandidates[0]!.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${displayDate} の FFLogs を開く`}
        title="FFLogs"
        className={`inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded text-amber-300/85 transition-all hover:bg-amber-400/15 hover:text-amber-200 hover:shadow-[0_0_10px_-2px_rgba(251,191,36,0.6)]`}
      >
        <BarChart3 className={iconSizeClass} aria-hidden />
      </a>
    );
  } else {
    logsSlot = (
      <DropdownMenu {...logsMenu}>
        <DropdownMenuTrigger
          aria-label={`${displayDate} の FFLogs ${logsCandidates.length} 件から選択`}
          title={`FFLogs ${logsCandidates.length} 件 — クリックで選択`}
          className={`relative inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded text-amber-300/85 transition-all hover:bg-amber-400/15 hover:text-amber-200 hover:shadow-[0_0_10px_-2px_rgba(251,191,36,0.6)] data-popup-open:bg-amber-400/15 data-popup-open:text-amber-200`}
        >
          <BarChart3 className={iconSizeClass} aria-hidden />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-amber-300 px-0.5 font-mono text-[8px] leading-none text-background"
          >
            {logsCandidates.length}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} disableAnchorTracking>
          {logsCandidates.map((c) => {
            // TODO #65 (2.1, 2026-05-02 part6): show full label (and the
            // raw URL as a secondary line) on hover so the truncated row
            // is still discoverable. Mirrors the 1-link case.
            const itemTitle = `FFLogs → ${c.label}\n${c.url}`;
            return (
            <DropdownMenuItem
              key={c.url}
              render={(props) => (
                <a
                  {...props}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={itemTitle}
                />
              )}
            >
              <BarChart3 className="h-3.5 w-3.5 text-amber-300/85" aria-hidden />
              <span className="truncate">{c.label}</span>
              <ExternalLink
                className="ml-auto h-3 w-3 text-muted-foreground/60"
                aria-hidden
              />
            </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      {filmSlot}
      {logsSlot}
    </>
  );
}

/**
 * 単一動画リンク描画 (TODO #1 dropdown 化前の従来挙動)。
 * past = 外部新規タブ、upcoming = portal 内動画ページへ soft-nav。
 * size: TODO #65 — chip 用に compact (h-4/h-2.5) も切替可能。
 */
function renderSingleVideoLink(
  v: SessionVideoLink,
  isPast: boolean,
  size: "default" | "compact" = "default",
) {
  const triggerSizeClass = size === "compact" ? "h-4 w-4" : "h-5 w-5";
  const iconSizeClass = size === "compact" ? "h-2.5 w-2.5" : "h-3 w-3";
  const externalVideoUrl = isPast ? safeHref(v.url) : null;
  if (externalVideoUrl) {
    return (
      <a
        href={externalVideoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${v.categoryName}/動画「${v.videoTitle}」を新規タブで開く`}
        title={`${v.categoryName}/動画 → 「${v.videoTitle}」 (外部リンク)`}
        className={`inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)]`}
      >
        <Film className={iconSizeClass} aria-hidden />
      </a>
    );
  }
  // upcoming は `<Link>` で portal 内 soft-nav (TODO #54 part2-d:
  // prefetch={false} で cold start 時の RSC 投機ロード一斉発動を抑制)。
  return (
    <Link
      href={v.href}
      prefetch={false}
      aria-label={`${v.categoryName}/動画「${v.videoTitle}」を開く`}
      title={`${v.categoryName}/動画 → 「${v.videoTitle}」`}
      className={`inline-flex ${triggerSizeClass} shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)]`}
    >
      <Film className={iconSizeClass} aria-hidden />
    </Link>
  );
}
