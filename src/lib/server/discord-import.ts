import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/server/db-error";
import { fetchPageTitle } from "@/lib/server/page-title";
import {
  fetchYouTubeMeta,
  pmap,
} from "@/lib/server/youtube-duration";
import { isClearTitleForCategory } from "@/lib/clear-detection";
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
      reason: dbError("カテゴリ取得", error),
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

  // 5. Enrich (fetch title + YouTube meta) in parallel, then bulk insert.
  // Concurrency cap of 6 keeps us well under any per-host rate limits
  // while massively beating sequential fetches (8s × N → ~8s × ⌈N/6⌉).
  const FETCH_CONCURRENCY = 6;
  const enriched = await pmap(fresh, FETCH_CONCURRENCY, async (c) => {
    const [title, meta] = await Promise.all([
      fetchPageTitle(c.url),
      kind === "video"
        ? fetchYouTubeMeta(c.url)
        : Promise.resolve({ durationSeconds: null, uploadDate: null }),
    ]);
    return {
      url: c.url,
      postedBy: c.postedBy,
      postedAt: c.postedAt,
      title: title ?? c.url,
      durationSeconds: meta.durationSeconds,
    };
  });

  // Allocate sort_orders deterministically so chronological insertion
  // order is preserved even though fetches finished out-of-order.
  const startSortOrder = nextOrder;
  const rowsToInsert = enriched.map((e, i) => ({
    category_id: cat.id,
    kind,
    title: e.title,
    url: e.url,
    description: `Discord 取り込み (by ${e.postedBy})`,
    sort_order: startSortOrder + i,
    source: "discord" as const,
    duration_seconds: e.durationSeconds,
    // Discord message timestamp — most accurate "when did this video
    // become known to the group" signal we have.
    posted_at: e.postedAt,
  }));

  let inserted = 0;
  let failed = 0;
  let lastFailReason: string | undefined;
  // One bulk insert is dramatically faster than N round-trips, but
  // also fails atomically — if any row's URL violates a unique index
  // we'd lose the rest. We checked dedup earlier so duplicates aren't
  // expected; a constraint violation here would indicate a race with
  // another import. Fall back to per-row inserts on bulk failure so
  // we still get partial progress.
  const { error: bulkErr } = await supabase
    .from("category_links")
    .insert(rowsToInsert);
  if (bulkErr) {
    console.warn(
      "[discord-import] bulk insert failed, retrying per-row",
      cat.slug,
      bulkErr.message,
    );
    for (const row of rowsToInsert) {
      const { error: rowErr } = await supabase
        .from("category_links")
        .insert(row);
      if (rowErr) {
        console.warn(
          "[discord-import] row insert failed",
          cat.slug,
          row.url,
          rowErr.message,
        );
        failed += 1;
        lastFailReason = rowErr.message;
      } else {
        inserted += 1;
      }
    }
  } else {
    inserted = rowsToInsert.length;
  }

  // 6. First-clear detection: pick the earliest clear-titled video's
  // posted_at out of the just-inserted rows. Only fires if the category
  // doesn't already have first_clear_at set; race-safe via IS NULL guard.
  if (kind === "video" && !cat.firstClearAt && inserted > 0) {
    let earliestClearPostedAt: string | null = null;
    for (const e of enriched) {
      // 1.9.16: tier-aware — Savage requires "4 層" + clear keyword.
      if (!isClearTitleForCategory(e.title, cat.name)) continue;
      if (
        earliestClearPostedAt === null ||
        e.postedAt < earliestClearPostedAt
      ) {
        earliestClearPostedAt = e.postedAt;
      }
    }
    if (earliestClearPostedAt) {
      const { error: clearErr } = await supabase
        .from("categories")
        .update({ first_clear_at: earliestClearPostedAt })
        .eq("id", cat.id)
        .is("first_clear_at", null);
      if (clearErr) {
        console.warn(
          "[discord-import] first_clear_at update failed",
          cat.slug,
          clearErr.message,
        );
      }
    }
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
