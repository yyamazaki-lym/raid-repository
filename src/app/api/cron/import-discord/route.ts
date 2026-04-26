import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPageTitle } from "@/lib/server/page-title";
import {
  rowToCategory,
  type CategoryLinkKind,
  type CategoryRow,
} from "@/lib/supabase/types";

/**
 * Vercel Cron entrypoint: pulls fresh URLs from configured Discord channels
 * into the matching category's category_links rows.
 *
 * Authorization
 * -------------
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We reject
 * everything else so this can't be triggered from the public internet.
 *
 * Schedule
 * --------
 * Defined in `vercel.json` (currently daily at 00:00 UTC = 09:00 JST).
 *
 * Workflow per category
 * ---------------------
 *   1. If the category has discord_strategy_channel_id  → import strategy
 *   2. If the category has discord_video_channel_id     → import video
 *
 * Per channel
 * -----------
 *   1. GET last 100 messages from Discord API.
 *   2. Extract URLs from message content.
 *   3. Look up existing URLs already in category_links → skip dupes.
 *   4. For each new URL: fetch page title, insert.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generous timeout — Discord + N page-title lookups + N inserts can take a while.
export const maxDuration = 60;

const URL_RE = /https?:\/\/[^\s<>"'\]\)]+/g;

type DiscordMessage = {
  id: string;
  content: string;
  author: { id: string; username: string };
  timestamp: string;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  // Trim — pasted env values sometimes carry a trailing newline/whitespace
  // which makes a strict equality compare with the Bearer header fail.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[cron/discord] CRON_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // Vercel attaches an `x-vercel-cron` header to cron-invoked requests.
  // Treat that as an additional accepted auth path so manual Run from the
  // dashboard still works even if the Authorization header is missing.
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const expected = `Bearer ${secret}`;
  const headerOk = authHeader === expected || authHeader?.trim() === expected;

  if (!headerOk && !isVercelCron) {
    // Server-side diagnostic only — leak just the lengths so log readers can
    // tell at-a-glance whether the env value or the inbound header is the
    // mismatched one (and never reveal the full secret).
    console.warn(
      "[cron/discord] auth failed",
      JSON.stringify({
        receivedHeaderLength: authHeader?.length ?? 0,
        receivedHeaderPrefix: authHeader?.slice(0, 14) ?? null,
        expectedSecretLength: secret.length,
        hasVercelCronHeader: isVercelCron,
      }),
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "DISCORD_BOT_TOKEN not configured" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("categories")
    .select("*")
    .or(
      "discord_strategy_channel_id.not.is.null,discord_video_channel_id.not.is.null",
    );
  if (error) {
    return NextResponse.json(
      { error: "supabase select failed: " + error.message },
      { status: 500 },
    );
  }

  const categories = (rows ?? []).map((r) => rowToCategory(r as CategoryRow));
  const summary: Record<string, unknown>[] = [];

  for (const cat of categories) {
    if (cat.discordStrategyChannelId) {
      summary.push(
        await importChannelForCategory(
          cat.id,
          cat.slug,
          cat.discordStrategyChannelId,
          "strategy",
          botToken,
        ),
      );
    }
    if (cat.discordVideoChannelId) {
      summary.push(
        await importChannelForCategory(
          cat.id,
          cat.slug,
          cat.discordVideoChannelId,
          "video",
          botToken,
        ),
      );
    }
  }

  return NextResponse.json({ ok: true, results: summary });
}

async function importChannelForCategory(
  categoryId: string,
  categorySlug: string,
  channelId: string,
  kind: CategoryLinkKind,
  botToken: string,
): Promise<Record<string, unknown>> {
  // 1. Fetch last 100 Discord messages.
  let messages: DiscordMessage[];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          "User-Agent": "RaidRepositoryBot (https://raid-repository.vercel.app, 0.1)",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        category: categorySlug,
        kind,
        ok: false,
        reason: `discord ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    messages = (await res.json()) as DiscordMessage[];
  } catch (err) {
    return {
      category: categorySlug,
      kind,
      ok: false,
      reason: "discord fetch error: " + String(err),
    };
  }

  // 2. Extract URLs from messages, oldest first so insertion order is sensible.
  type Candidate = { url: string; postedBy: string; postedAt: string };
  const candidates: Candidate[] = [];
  const seenInBatch = new Set<string>();
  for (const m of [...messages].reverse()) {
    const found = m.content.matchAll(URL_RE);
    for (const match of found) {
      const url = stripTrailingPunctuation(match[0]);
      if (!url || seenInBatch.has(url)) continue;
      seenInBatch.add(url);
      candidates.push({
        url,
        postedBy: m.author.username,
        postedAt: m.timestamp,
      });
    }
  }
  if (candidates.length === 0) {
    return { category: categorySlug, kind, ok: true, scanned: 0, inserted: 0 };
  }

  // 3. Dedupe against existing rows.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("category_links")
    .select("url")
    .eq("category_id", categoryId)
    .eq("kind", kind);
  const existingUrls = new Set(
    (existing ?? []).map((r) => (r.url as string)),
  );
  const fresh = candidates.filter((c) => !existingUrls.has(c.url));
  if (fresh.length === 0) {
    return {
      category: categorySlug,
      kind,
      ok: true,
      scanned: candidates.length,
      inserted: 0,
    };
  }

  // 4. Determine starting sort_order.
  const { data: maxRow } = await supabase
    .from("category_links")
    .select("sort_order")
    .eq("category_id", categoryId)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  // 5. For each fresh URL, fetch title (best-effort) and insert.
  let inserted = 0;
  for (const c of fresh) {
    const title = (await fetchPageTitle(c.url)) ?? c.url;
    const description = `Discord 取り込み (by ${c.postedBy})`;
    const { error: insertError } = await supabase
      .from("category_links")
      .insert({
        category_id: categoryId,
        kind,
        title,
        url: c.url,
        description,
        sort_order: nextOrder,
      });
    if (insertError) {
      console.warn(
        "[cron/discord] insert failed",
        categorySlug,
        kind,
        c.url,
        insertError.message,
      );
      continue;
    }
    nextOrder += 1;
    inserted += 1;
  }

  return {
    category: categorySlug,
    kind,
    ok: true,
    scanned: candidates.length,
    inserted,
  };
}

/**
 * URLs in Discord messages often end with stray punctuation that's actually
 * part of the surrounding sentence (e.g., trailing ).,]). Strip the most
 * common offenders.
 */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,!?;:'"]+$/, "");
}
