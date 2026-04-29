import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";
import { pmap } from "@/lib/server/youtube-duration";

/**
 * One-shot backfill for `category_links.posted_at` using the original
 * Discord message timestamps.
 *
 * Why this exists: when the import code originally ran, it stored only
 * `created_at = now()` for every row. A single batch import (cron run
 * picking up months of backlog) gave hundreds of rows the same
 * timestamp, which broke first-clear date detection. The schema later
 * grew a `posted_at` column for the message timestamp, but the
 * already-inserted rows still have NULL there.
 *
 * This action re-scans each category's configured Discord channels
 * (strategy + video), reads the latest 100 messages, and updates rows
 * whose URL matches a message — using that message's timestamp as the
 * authoritative `posted_at`. Race-safe via `IS NULL` guard so manual
 * edits aren't clobbered.
 *
 * Trade-off: only the most recent 100 messages per channel are
 * accessible from Discord's API in one call, so very old URLs may not
 * get matched. Run repeatedly over time as needed (idempotent).
 */

const URL_RE = /https?:\/\/[^\s<>"'\]\)]+/g;

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,!?;:'"]+$/, "");
}

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
};

export type PostedAtBackfillResult = {
  ok: boolean;
  reason?: string;
  /** Total Discord messages fetched across all configured channels. */
  scannedMessages: number;
  /** Distinct URLs encountered in those messages. */
  scannedUrls: number;
  /** category_links rows whose URL was matched in a Discord message. */
  matched: number;
  /** Of `matched`, how many had posted_at filled (was NULL). */
  updated: number;
  /** Per-channel breakdown for the result panel. */
  channels: Array<{
    categorySlug: string;
    kind: "strategy" | "video";
    ok: boolean;
    reason?: string;
    scanned: number;
    updated: number;
  }>;
};

export async function backfillPostedAtFromDiscord(): Promise<PostedAtBackfillResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return {
      ok: false,
      reason: "DISCORD_BOT_TOKEN 未設定",
      scannedMessages: 0,
      scannedUrls: 0,
      matched: 0,
      updated: 0,
      channels: [],
    };
  }

  const supabase = await createClient();
  const { data: cats, error } = await supabase
    .from("categories")
    .select(
      "id, slug, discord_strategy_channel_id, discord_video_channel_id",
    );
  if (error || !cats) {
    return {
      ok: false,
      reason: dbError("カテゴリ取得", error),
      scannedMessages: 0,
      scannedUrls: 0,
      matched: 0,
      updated: 0,
      channels: [],
    };
  }

  // 2.1 (2026-04-30): Vercel Hobby plan の Edge function 25s 上限に
  // 抵触しないよう、(category, kind) チャンネルを並列処理。1 channel
  // あたり Discord fetch (1-2s) + bulk SELECT (1) + per-URL UPDATE pmap
  // でほぼ < 5s に収まる想定。並列度 4 で全 channel を約 N/4 × 5s で完了。
  type ChannelTask = {
    categoryId: string;
    categorySlug: string;
    kind: "strategy" | "video";
    channelId: string;
  };
  const tasks: ChannelTask[] = [];
  for (const cat of cats) {
    for (const kind of ["strategy", "video"] as const) {
      const channelId =
        kind === "strategy"
          ? (cat.discord_strategy_channel_id as string | null)
          : (cat.discord_video_channel_id as string | null);
      if (!channelId) continue;
      tasks.push({
        categoryId: cat.id as string,
        categorySlug: cat.slug as string,
        kind,
        channelId,
      });
    }
  }

  const channelDetails = await pmap(tasks, 4, async (t) =>
    processChannel(
      supabase,
      botToken,
      t.categoryId,
      t.categorySlug,
      t.kind,
      t.channelId,
    ),
  );

  const result: PostedAtBackfillResult = {
    ok: true,
    scannedMessages: 0,
    scannedUrls: 0,
    matched: 0,
    updated: 0,
    channels: [],
  };
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const d = channelDetails[i]!;
    result.scannedMessages += d.scanned;
    result.scannedUrls += d.scannedUrls;
    result.matched += d.matched;
    result.updated += d.updated;
    result.channels.push({
      categorySlug: t.categorySlug,
      kind: t.kind,
      ok: d.ok,
      reason: d.reason,
      scanned: d.scanned,
      updated: d.updated,
    });
  }
  return result;
}

async function processChannel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  botToken: string,
  categoryId: string,
  categorySlug: string,
  kind: "strategy" | "video",
  channelId: string,
): Promise<{
  ok: boolean;
  reason?: string;
  scanned: number;
  scannedUrls: number;
  matched: number;
  updated: number;
}> {
  // 1. Fetch the latest 100 Discord messages.
  let messages: DiscordMessage[];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `discord ${res.status}: ${body.slice(0, 200)}`,
        scanned: 0,
        scannedUrls: 0,
        matched: 0,
        updated: 0,
      };
    }
    messages = (await res.json()) as DiscordMessage[];
  } catch (e) {
    return {
      ok: false,
      reason: "discord fetch error: " + String(e),
      scanned: 0,
      scannedUrls: 0,
      matched: 0,
      updated: 0,
    };
  }

  // 2. Build URL → earliest-timestamp map. If a URL is mentioned
  //    multiple times we want the original posting, not a re-share.
  const urlToTimestamp = new Map<string, string>();
  for (const m of messages) {
    for (const match of m.content.matchAll(URL_RE)) {
      const url = stripTrailingPunctuation(match[0]);
      if (!url) continue;
      const prev = urlToTimestamp.get(url);
      if (!prev || m.timestamp < prev) {
        urlToTimestamp.set(url, m.timestamp);
      }
    }
  }
  if (urlToTimestamp.size === 0) {
    return {
      ok: true,
      scanned: messages.length,
      scannedUrls: 0,
      matched: 0,
      updated: 0,
    };
  }

  // 3. Bulk SELECT all matching rows for this channel in 1 query
  //    (旧: per-URL に SELECT を打っていたため URL 数だけ往復が発生)、
  //    posted_at が NULL の行を pmap で並列 UPDATE。Best-effort —
  //    失敗した行は warn を出して次に進む。
  const urls = Array.from(urlToTimestamp.keys());
  const { data: rows, error: selErr } = await supabase
    .from("category_links")
    .select("id, url, posted_at")
    .eq("category_id", categoryId)
    .eq("kind", kind)
    .in("url", urls);
  if (selErr || !rows) {
    return {
      ok: false,
      reason: dbError("動画行取得", selErr),
      scanned: messages.length,
      scannedUrls: urlToTimestamp.size,
      matched: 0,
      updated: 0,
    };
  }
  const matched = rows.length;
  const targets = rows
    .filter((r) => !r.posted_at)
    .map((r) => ({
      id: r.id as string,
      url: r.url as string,
      timestamp: urlToTimestamp.get(r.url as string)!,
    }))
    .filter((t) => !!t.timestamp);
  const updateOutcomes = await pmap(targets, 6, async (t) => {
    const { error: updErr } = await supabase
      .from("category_links")
      .update({ posted_at: t.timestamp })
      .eq("id", t.id)
      .is("posted_at", null);
    if (updErr) {
      console.warn(
        "[postedat-backfill] update failed",
        categorySlug,
        t.url,
        updErr.message,
      );
      return false;
    }
    return true;
  });
  const updated = updateOutcomes.filter(Boolean).length;

  return {
    ok: true,
    scanned: messages.length,
    scannedUrls: urlToTimestamp.size,
    matched,
    updated,
  };
}
