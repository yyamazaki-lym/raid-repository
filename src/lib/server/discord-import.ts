import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchPageTitle } from "@/lib/server/page-title";
import {
  rowToCategory,
  type Category,
  type CategoryLinkKind,
  type CategoryRow,
} from "@/lib/supabase/types";

/**
 * Core Discord-import logic, shared by:
 *   - The cron route (`/api/cron/import-discord`)
 *   - The "Import now" Server Action triggered from the UI
 *
 * Same behavior either way: pull the latest 100 messages from each
 * configured channel, dedupe URLs against existing rows, fetch page
 * titles, and insert as `category_links` with `source = 'discord'`.
 *
 * Categories with `discord_import_enabled = false` are skipped.
 */

const URL_RE = /https?:\/\/[^\s<>"'\]\)]+/g;

type DiscordMessage = {
  id: string;
  content: string;
  author: { id: string; username: string };
  timestamp: string;
};

export type ImportResult = {
  category: string;
  kind: CategoryLinkKind;
  ok: boolean;
  /** Total URLs found in the Discord messages this run. */
  scanned?: number;
  /** Of `scanned`, how many were already in the DB and skipped. */
  duplicates?: number;
  /** Of (scanned - duplicates), how many INSERTs succeeded. */
  inserted?: number;
  /** Of (scanned - duplicates), how many INSERTs failed (DB error). */
  failed?: number;
  /** Set when the most-recent insert failure produced an error message. */
  failReason?: string;
  reason?: string;
  skipped?: "disabled";
};

export async function runDiscordImport(): Promise<{
  ok: boolean;
  reason?: string;
  results: ImportResult[];
}> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return {
      ok: false,
      reason: "DISCORD_BOT_TOKEN not configured",
      results: [],
    };
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("categories")
    .select("*")
    .or(
      "discord_strategy_channel_id.not.is.null,discord_video_channel_id.not.is.null",
    );
  if (error) {
    return {
      ok: false,
      reason: "supabase select failed: " + error.message,
      results: [],
    };
  }

  const categories = (rows ?? []).map((r) => rowToCategory(r as CategoryRow));
  const results: ImportResult[] = [];

  for (const cat of categories) {
    if (!cat.discordImportEnabled) {
      // Skip but record so the UI can show "X paused, Y processed".
      if (cat.discordStrategyChannelId) {
        results.push({
          category: cat.slug,
          kind: "strategy",
          ok: true,
          skipped: "disabled",
        });
      }
      if (cat.discordVideoChannelId) {
        results.push({
          category: cat.slug,
          kind: "video",
          ok: true,
          skipped: "disabled",
        });
      }
      continue;
    }
    if (cat.discordStrategyChannelId) {
      results.push(
        await importChannel(cat, cat.discordStrategyChannelId, "strategy", botToken),
      );
    }
    if (cat.discordVideoChannelId) {
      results.push(
        await importChannel(cat, cat.discordVideoChannelId, "video", botToken),
      );
    }
  }

  return { ok: true, results };
}

async function importChannel(
  cat: Category,
  channelId: string,
  kind: CategoryLinkKind,
  botToken: string,
): Promise<ImportResult> {
  // 1. Fetch last 100 Discord messages.
  let messages: DiscordMessage[];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          // Generic UA — fork deployments shouldn't all impersonate one URL.
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        category: cat.slug,
        kind,
        ok: false,
        reason: `discord ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    messages = (await res.json()) as DiscordMessage[];
  } catch (err) {
    return {
      category: cat.slug,
      kind,
      ok: false,
      reason: "discord fetch error: " + String(err),
    };
  }

  // 2. Extract URLs (oldest first for chronological insertion).
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
    return { category: cat.slug, kind, ok: true, scanned: 0, inserted: 0 };
  }

  // 3. Dedupe vs existing rows.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("category_links")
    .select("url")
    .eq("category_id", cat.id)
    .eq("kind", kind);
  const existingUrls = new Set((existing ?? []).map((r) => r.url as string));
  const fresh = candidates.filter((c) => !existingUrls.has(c.url));
  const duplicates = candidates.length - fresh.length;
  if (fresh.length === 0) {
    return {
      category: cat.slug,
      kind,
      ok: true,
      scanned: candidates.length,
      duplicates,
      inserted: 0,
      failed: 0,
    };
  }

  // 4. Determine starting sort_order.
  const { data: maxRow } = await supabase
    .from("category_links")
    .select("sort_order")
    .eq("category_id", cat.id)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  // 5. Insert.
  let inserted = 0;
  let failed = 0;
  let lastFailReason: string | undefined;
  for (const c of fresh) {
    const title = (await fetchPageTitle(c.url)) ?? c.url;
    const description = `Discord 取り込み (by ${c.postedBy})`;
    const { error: insertError } = await supabase.from("category_links").insert({
      category_id: cat.id,
      kind,
      title,
      url: c.url,
      description,
      sort_order: nextOrder,
      source: "discord",
    });
    if (insertError) {
      console.warn(
        "[discord-import] insert failed",
        cat.slug,
        kind,
        c.url,
        insertError.message,
      );
      failed += 1;
      lastFailReason = insertError.message;
      continue;
    }
    nextOrder += 1;
    inserted += 1;
  }

  return {
    category: cat.slug,
    kind,
    ok: true,
    scanned: candidates.length,
    duplicates,
    inserted,
    failed,
    failReason: lastFailReason,
  };
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,!?;:'"]+$/, "");
}
