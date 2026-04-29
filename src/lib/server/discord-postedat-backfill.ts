import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";

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

  const result: PostedAtBackfillResult = {
    ok: true,
    scannedMessages: 0,
    scannedUrls: 0,
    matched: 0,
    updated: 0,
    channels: [],
  };

  for (const cat of cats) {
    for (const kind of ["strategy", "video"] as const) {
      const channelId =
        kind === "strategy"
          ? (cat.discord_strategy_channel_id as string | null)
          : (cat.discord_video_channel_id as string | null);
      if (!channelId) continue;

      const channelDetail = await processChannel(
        supabase,
        botToken,
        cat.id as string,
        cat.slug as string,
        kind,
        channelId,
      );
      result.scannedMessages += channelDetail.scanned;
      result.scannedUrls += channelDetail.scannedUrls;
      result.matched += channelDetail.matched;
      result.updated += channelDetail.updated;
      result.channels.push({
        categorySlug: cat.slug as string,
        kind,
        ok: channelDetail.ok,
        reason: channelDetail.reason,
        scanned: channelDetail.scanned,
        updated: channelDetail.updated,
      });
    }
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

  // 3. For each URL, update the matching category_links row IF
  //    posted_at is currently NULL. Best-effort — failures per URL
  //    don't fail the whole backfill.
  let matched = 0;
  let updated = 0;
  for (const [url, timestamp] of urlToTimestamp) {
    const { data: rows, error: selErr } = await supabase
      .from("category_links")
      .select("id, posted_at")
      .eq("category_id", categoryId)
      .eq("kind", kind)
      .eq("url", url);
    if (selErr || !rows || rows.length === 0) continue;
    matched += rows.length;
    for (const row of rows) {
      if (row.posted_at) continue; // already set, never overwrite
      const { error: updErr } = await supabase
        .from("category_links")
        .update({ posted_at: timestamp })
        .eq("id", row.id as string)
        .is("posted_at", null);
      if (updErr) {
        console.warn(
          "[postedat-backfill] update failed",
          categorySlug,
          url,
          updErr.message,
        );
        continue;
      }
      updated += 1;
    }
  }

  return {
    ok: true,
    scanned: messages.length,
    scannedUrls: urlToTimestamp.size,
    matched,
    updated,
  };
}
