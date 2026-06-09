import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
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
  /**
   * Total URLs found in the Discord messages this run.
   * Phase 13.2: `discord_*_filter_keywords` が設定されたカテゴリでは
   * フィルタ通過後の件数になる (= 本文/URL/動画タイトル のいずれかが
   * キーワードに部分一致した URL のみカウント、video kind ではタイトルも対象)。
   */
  scanned?: number;
  /**
   * Phase 13.1 (2.1, 2026-05-13): フィルタ判定前にメッセージ本文から抽出された
   * ユニーク URL 数。`scanned` は「フィルタ通過後」のため、フィルタ設定済カテゴリで
   * `scanned === 0` のとき "チャンネル空 or Bot 権限不足" なのか "フィルタが
   * 効きすぎて全部弾かれた" のかを UI が区別するために使う。
   */
  prefilteredCount?: number;
  /**
   * Phase 13.3 (2.1, 2026-05-13): enrichment 段階で `fetchPageTitle` が成功した
   * URL 数 (DB 未登録の fresh URL のみが対象)。フィルタが効きすぎる場合に「タイトル
   * 取得が失敗していた」のか「取得できているがフィルタワードと一致しない」のかを
   * 切り分けるため UI にも表示する。dedup で除外された既存 URL は含まれない。
   */
  titleFetchedCount?: number;
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

  const supabase = createSupabaseServiceRoleClient();
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
  // 1. Fetch Discord messages with pagination.
  // Phase 13.4 (2.1, 2026-05-13): 旧実装は最新 100 件のみ。Pandæmonium 辺獄編
  // のような古いコンテンツでは、その後の練習動画が積み上がってチャンネル内の
  // 100 件 limit を押し出してしまい、取り込み不可だった。`?before=<message_id>`
  // で過去メッセージを遡れるよう pagination 対応。上限 MAX_MESSAGE_PAGES で
  // Vercel function timeout (Hobby plan 25s, Pro plan 60s+) に到達しない範囲に
  // 抑える。100 件未満が返ったら終端 (= チャンネル全件取得済) として break。
  const MAX_MESSAGE_PAGES = 5;
  let messages: DiscordMessage[];
  try {
    const all: DiscordMessage[] = [];
    let beforeId: string | undefined = undefined;
    for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
      const params = new URLSearchParams({ limit: "100" });
      if (beforeId) params.set("before", beforeId);
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages?${params.toString()}`,
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
        // 2.x (2026-06-09): Discord error body を response/JSON に直接
        // 載せるのを止め、構造化メッセージ (status + page) のみ返す。
        // 詳細は console.warn にだけ吐く (Vercel ログ画面共有時に
        // token 断片 / rate-limit 詳細が漏れるリスクを避ける)。
        const body = await res.text().catch(() => "");
        console.warn("[discord-import] discord api error", {
          category: cat.slug,
          kind,
          channelId,
          page: page + 1,
          status: res.status,
          bodyPreview: body.slice(0, 200),
        });
        return {
          category: cat.slug,
          kind,
          ok: false,
          reason: `discord api ${res.status} (page ${page + 1})`,
        };
      }
      const batch = (await res.json()) as DiscordMessage[];
      if (batch.length === 0) break;
      all.push(...batch);
      // Discord は新しい順 (descending) で返すので、最後の要素 = batch 内で最古。
      // 次ページの `before` に渡せばそれより古いメッセージを遡って取得できる。
      if (batch.length < 100) break;
      beforeId = batch[batch.length - 1].id;
    }
    messages = all;
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
  // Phase 13.2 (2.1, 2026-05-13): フィルタ判定は enrichment (動画タイトル取得)
  // の後ろに移動。ここでは抽出と dedupe だけ行い、本文/URL/タイトル の 3 つで
  // 一括判定する。動画 URL しか投稿されないチャンネル (本文 = URL 文字列のみ)
  // でも、動画タイトルでフィルタワードにマッチできるようにするのが目的。
  // 元メッセージ本文も candidate に持ち回し、enrichment 後の判定で使う。
  type Candidate = {
    url: string;
    postedBy: string;
    postedAt: string;
    messageContent: string;
  };
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
        messageContent: content,
      });
    }
  }
  // Phase 13.1: prefilteredCount = フィルタ判定前のユニーク URL 数。案 A 移行に
  // 伴い「抽出 dedupe 後のユニーク URL 数 = candidates.length」と一致する。
  // フィルタ設定済カテゴリで scanned===0 となった場合、prefilteredCount>0 なら
  // 「フィルタで全部弾かれた」、=0 なら「チャンネル空 or Bot 権限不足」と区別できる。
  const prefilteredCount = candidates.length;
  if (candidates.length === 0) {
    return {
      category: cat.slug,
      kind,
      ok: true,
      scanned: 0,
      inserted: 0,
      prefilteredCount,
    };
  }

  // 3. Dedupe vs existing rows.
  const supabase = createSupabaseServiceRoleClient();
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
      prefilteredCount,
    };
  }

  // 4. Determine starting sort_order.
  // 2.x (2026-06-09) TODO #10: schema 側 RPC で 1 round-trip 化。Discord
  // cron は同カテゴリ内で strategy / video を順次実行するため自身との
  // race は無いが、admin が同時に「Import now」を押したケース等で
  // category_links の sort_order が衝突するのを抑える。
  const { data: nextOrderData } = await supabase.rpc(
    "next_category_link_sort_order",
    { p_category_id: cat.id, p_kind: kind },
  );
  const nextOrder = typeof nextOrderData === "number" ? nextOrderData : 0;

  // 5. Enrich (fetch title + YouTube meta) in parallel, then bulk insert.
  // Concurrency cap of 6 keeps us well under any per-host rate limits
  // while massively beating sequential fetches (8s × N → ~8s × ⌈N/6⌉).
  const FETCH_CONCURRENCY = 6;
  // Phase 13.3 (2.1, 2026-05-13): title を nullable のまま保持する。元の
  // `title ?? c.url` フォールバックを enrichment で行うと、フィルタ判定段階で
  // 「タイトル取得失敗 → title === URL」となり、URL haystack と区別がつかなく
  // なってフィルタが事実上無効になる。フォールバックは rowsToInsert 直前まで
  // 遅らせ、フィルタ判定では `null = タイトル取得失敗 = マッチ不可` として扱う。
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
      messageContent: c.messageContent,
      title,
      durationSeconds: meta.durationSeconds,
    };
  });

  // Phase 13.2 (2.1, 2026-05-13): enrichment 後にフィルタ判定。
  // 「本文 OR URL OR タイトル」のいずれかが、kind 別フィルタワードのいずれかに
  // 部分一致 (大小無視) すれば取り込み対象。フィルタ未設定 (空配列) なら
  // matchesAnyKeyword が常に true を返し、フィルタは透過する (後方互換)。
  // タイトルを haystack に加えるのは video kind のみ — strategy kind では
  // fetchPageTitle がサイト共通タイトル ("Google Docs" 等) を返す事が多く、
  // 誤マッチの温床になりやすいため除外する。
  const filterKeywords =
    kind === "video"
      ? cat.discordVideoFilterKeywords
      : cat.discordStrategyFilterKeywords;
  const filtered = enriched.filter((e) => {
    if (matchesAnyKeyword(e.messageContent, filterKeywords)) return true;
    if (matchesAnyKeyword(e.url, filterKeywords)) return true;
    if (
      kind === "video" &&
      e.title !== null &&
      matchesAnyKeyword(e.title, filterKeywords)
    ) {
      return true;
    }
    return false;
  });
  // Phase 13.3: タイトル取得成功数を統計として返値に載せる。フィルタが効きすぎる
  // と見えた場合に、portal の取り込み結果パネルから「タイトル取得が失敗していた
  // のか / 取得できているがワードが合わないだけか」を切り分けられるようにする。
  const titleFetchedCount = enriched.filter((e) => e.title !== null).length;
  if (filtered.length === 0) {
    // Vercel ログで実際のタイトルを確認できるようサンプルを warn 出力。
    // フィルタ設定済 (filterKeywords > 0) のときだけ、出力 (運用ノイズ低減)。
    if (filterKeywords.length > 0) {
      console.warn(
        "[discord-import] all candidates filtered out — フィルタ全件除外",
        {
          category: cat.slug,
          kind,
          total: enriched.length,
          titleFetched: titleFetchedCount,
          titleNull: enriched.length - titleFetchedCount,
          filterKeywords,
          sample: enriched
            .slice(0, 8)
            .map((e) => ({ url: e.url, title: e.title })),
        },
      );
    }
    return {
      category: cat.slug,
      kind,
      ok: true,
      scanned: 0,
      duplicates,
      inserted: 0,
      failed: 0,
      prefilteredCount,
      titleFetchedCount,
    };
  }

  // Allocate sort_orders deterministically so chronological insertion
  // order is preserved even though fetches finished out-of-order.
  const startSortOrder = nextOrder;
  const rowsToInsert = filtered.map((e, i) => ({
    category_id: cat.id,
    kind,
    // Phase 13.3: タイトル取得失敗 (null) のときだけ URL 文字列で埋める
    // フォールバック。フィルタ判定はもう終わっているので URL ↔ タイトル混同の
    // 心配なし。DB の title カラムは NOT NULL のためフォールバック必要。
    title: e.title ?? e.url,
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
  // Phase 13.2: フィルタで弾かれた URL は insert されていないので、走査対象は
  // enriched ではなく filtered (= 実際に insert 対象になった行) を使う。
  if (kind === "video" && !cat.firstClearAt && inserted > 0) {
    let earliestClearPostedAt: string | null = null;
    for (const e of filtered) {
      // 1.9.16: tier-aware — Savage requires "4 層" + clear keyword.
      // Phase 13.3: title が null (取得失敗) のときは判定不可能なので skip。
      if (!e.title) continue;
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
    scanned: filtered.length,
    duplicates,
    inserted,
    failed,
    failReason: lastFailReason,
    prefilteredCount,
    titleFetchedCount,
  };
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[)\].,!?;:'"]+$/, "");
}

/**
 * Phase 13 (2.1, 2026-05-13): カテゴリ別の Discord 取り込みフィルタ判定。
 *
 * `keywords` が空配列なら「フィルタ無効 = 通す」を意味し、常に true を返す。
 * これにより既存カテゴリ (新カラム NULL → rowToCategory で [] に正規化) は
 * 何も設定しなくても従来通り全件取り込みされる (後方互換)。
 *
 * 非空のときは「配列内のいずれかが `haystack` に部分一致 (大小無視) すれば
 * true」の OR マッチ。trim/空除去は UI 層で済んでいる前提だが、defensive に
 * もう一度ここでも空文字を弾く。
 */
function matchesAnyKeyword(haystack: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = haystack.toLowerCase();
  for (const kw of keywords) {
    const trimmed = kw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (lower.includes(trimmed)) return true;
  }
  return false;
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

    const supabase = createSupabaseServiceRoleClient();
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
