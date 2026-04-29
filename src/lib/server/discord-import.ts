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

  // 2.1 (2026-04-29) v5: カテゴリ間を並列処理化。Hobby plan の Edge
  // function 上限 (25s) に N カテゴリ × (Discord 100 件 fetch + URL
  // enrich + insert) を順次実行で当てるとタイムアウト → "Page Error"。
  // Discord rate limit は per-channel 5 req/sec。別チャンネルは並列で
  // 叩いても問題ない (global 50 req/sec まで余裕)。同カテゴリ内の
  // strategy / video は順次のままにし、カテゴリ間でのみ並列化することで
  // rate limit リスクを最小化。
  const tasks = categories.map(async (cat): Promise<ImportResult[]> => {
    const out: ImportResult[] = [];
    if (!cat.discordImportEnabled) {
      if (cat.discordStrategyChannelId) {
        out.push({
          category: cat.slug,
          kind: "strategy",
          ok: true,
          skipped: "disabled",
        });
      }
      if (cat.discordVideoChannelId) {
        out.push({
          category: cat.slug,
          kind: "video",
          ok: true,
          skipped: "disabled",
        });
      }
      return out;
    }
    if (cat.discordStrategyChannelId) {
      out.push(
        await importChannel(
          cat,
          cat.discordStrategyChannelId,
          "strategy",
          botToken,
        ),
      );
    }
    if (cat.discordVideoChannelId) {
      out.push(
        await importChannel(
          cat,
          cat.discordVideoChannelId,
          "video",
          botToken,
        ),
      );
    }
    return out;
  });

  // Promise.allSettled で 1 カテゴリの failure が他をブロックしない
  // ことを保証。fulfilled な戻り値だけ平坦化して返す。
  const settled = await Promise.allSettled(tasks);
  const results: ImportResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      results.push(...r.value);
    } else {
      console.warn(
        "[discord-import] category task rejected",
        String(r.reason),
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

  // TODO #37 v4 (2.1, 2026-04-29): auto-link helper の呼び出しを
  // 一時的に切る。v1〜v3 でも import が "Page Error" を返す症状が
  // 解消しなかったため、まず helper が原因かどうかを bisect する目的。
  // ユーザー検証後、helper が無罪なら他箇所を調査する。
  // if (kind === "strategy") {
  //   await maybeAutoLinkSheetUrls(cat, messages);
  // }
  void maybeAutoLinkSheetUrls;

  // 2. Extract URLs (oldest first for chronological insertion).
  type Candidate = { url: string; postedBy: string; postedAt: string };
  const candidates: Candidate[] = [];
  const seenInBatch = new Set<string>();
  for (const m of [...messages].reverse()) {
    // Defensive: m.content can be missing/non-string for system /
    // webhook / forwarded messages even though Discord docs say it's
    // always present. Skip silently rather than throw.
    const content = typeof m?.content === "string" ? m.content : "";
    if (!content) continue;
    const found = content.matchAll(URL_RE);
    for (const match of found) {
      const url = stripTrailingPunctuation(match[0]);
      if (!url || seenInBatch.has(url)) continue;
      seenInBatch.add(url);
      candidates.push({
        url,
        postedBy: m.author?.username ?? "unknown",
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

/**
 * TODO #37: scan the strategy channel for "軽減表" / "ロット" keywords
 * adjacent to a Google Sheets URL, and auto-fill the category's
 * `mitigation_sheet_url` / `loot_sheet_url` columns when they are still
 * null. Already-set columns are NEVER overwritten so manual choices
 * survive future imports.
 *
 * Detection is per-line rather than per-message because a single Discord
 * post often lists both URLs on separate lines (e.g.
 *   `軽減表: https://docs.google.com/spreadsheets/d/...`
 *   `ロット管理: https://docs.google.com/spreadsheets/d/...`
 * ). Per-message scanning would falsely cross-link them.
 *
 * Discord returns messages newest-first, and we iterate in that order:
 * the FIRST keyword match per kind wins. Pinned / quote-formatted
 * messages don't get any special handling — whatever Discord sends back
 * is what we read.
 */
async function maybeAutoLinkSheetUrls(
  cat: Category,
  messages: DiscordMessage[],
): Promise<void> {
  // Wrap the whole helper so a malformed message shape can NEVER kill
  // the parent runDiscordImport. The auto-link is a best-effort
  // enhancement; the link import itself must still succeed even if
  // this errors.
  try {
    // 既に両方埋まっているカテゴリは走査自体スキップ。
    if (cat.mitigationSheetUrl && cat.lootSheetUrl) return;
    if (!Array.isArray(messages)) return;

    const SHEET_URL_RE =
      /https?:\/\/docs\.google\.com\/spreadsheets\/[^\s<>"'\]\)]+/;
    const MITIGATION_RE = /軽減(表)?/;
    // 「ロット」だけマッチ (例: 「ロット表」「ロット管理」「分配ロット」)。
    // 「ロット管理」固定だと一般的な「ロット表」を取りこぼすため広め。
    const LOOT_RE = /ロット/;

    let mitigationUrl: string | null = null;
    let lootUrl: string | null = null;

    for (const m of messages) {
      if (
        (cat.mitigationSheetUrl || mitigationUrl) &&
        (cat.lootSheetUrl || lootUrl)
      ) {
        break;
      }
      // Defensive: webhook / system messages can have null/undefined
      // content even though the Discord docs say it's always a string.
      const content = typeof m?.content === "string" ? m.content : "";
      if (!content) continue;
      for (const rawLine of content.split(/\r?\n/)) {
        const urlMatch = rawLine.match(SHEET_URL_RE);
        if (!urlMatch) continue;
        const url = stripTrailingPunctuation(urlMatch[0]);
        if (!url) continue;
        if (
          !cat.mitigationSheetUrl &&
          !mitigationUrl &&
          MITIGATION_RE.test(rawLine)
        ) {
          mitigationUrl = url;
        }
        if (!cat.lootSheetUrl && !lootUrl && LOOT_RE.test(rawLine)) {
          lootUrl = url;
        }
      }
    }

    if (!mitigationUrl && !lootUrl) return;

    const supabase = await createClient();
    // Issue per-kind UPDATEs so each WHERE clause carries the correct
    // `IS NULL` guard. Race-safe: a manual save mid-import that fills
    // the column will make the UPDATE a no-op instead of clobbering.
    if (mitigationUrl) {
      const { error } = await supabase
        .from("categories")
        .update({ mitigation_sheet_url: mitigationUrl })
        .eq("id", cat.id)
        .is("mitigation_sheet_url", null);
      if (error) {
        console.warn(
          "[discord-import] auto-link mitigation_sheet_url failed",
          cat.slug,
          error.message,
        );
      }
    }
    if (lootUrl) {
      const { error } = await supabase
        .from("categories")
        .update({ loot_sheet_url: lootUrl })
        .eq("id", cat.id)
        .is("loot_sheet_url", null);
      if (error) {
        console.warn(
          "[discord-import] auto-link loot_sheet_url failed",
          cat.slug,
          error.message,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[discord-import] auto-link helper threw",
      cat.slug,
      String(err),
    );
  }
}
