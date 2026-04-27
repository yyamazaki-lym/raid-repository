import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * For each past raid session, find a video uploaded on the same JST
 * calendar day so the schedule's date column can deep-link directly
 * to the relevant video card.
 *
 * Match rule:
 *   - kind = 'video'
 *   - Same JST day as the session's parsed date, where the row's
 *     `posted_at` is preferred (Discord message timestamp / YouTube
 *     upload date). Falls back to `created_at` for legacy rows that
 *     never got the posted_at backfill.
 *
 * If multiple videos match a single day, we pick the FIRST one by
 * posted_at — the earliest upload of that session is usually the
 * "main" recording (later ones tend to be POV alts).
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type SessionVideoLink = {
  /** Path the schedule page should link to. */
  href: string;
  /** Category name shown in the tooltip ("ヘビー級 → 動画"). */
  categoryName: string;
  /** Video title for tooltip / accessibility. */
  videoTitle: string;
};

/**
 * Build a `YYYY-MM-DD` → SessionVideoLink map. Schedule page calls
 * this server-side, then passes the map down so the date-cell
 * onClick can resolve to a specific category's video page anchor.
 */
export async function buildSessionVideoLinkMap(): Promise<
  Record<string, SessionVideoLink>
> {
  const supabase = await createClient();
  // Pull all videos with their categories and timestamps. Volume is
  // small enough (hundreds at most for a typical group) to do the
  // grouping in JS rather than a custom RPC.
  type Row = {
    id: string;
    title: string;
    posted_at: string | null;
    created_at: string;
    categories:
      | { slug: string; name: string }
      | { slug: string; name: string }[]
      | null;
  };
  const { data, error } = await supabase
    .from("category_links")
    .select(
      "id, title, posted_at, created_at, category_id, categories!inner(slug, name)",
    )
    .eq("kind", "video")
    .order("posted_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return {};
  // Cast through `unknown` because Supabase's runtime nested-select
  // shape (object for to-one FK) doesn't match the strict generated
  // type (array). The runtime object form is what we actually get.
  const videos = data as unknown as Row[];

  const out: Record<string, SessionVideoLink> = {};
  for (const v of videos) {
    const ts = v.posted_at ?? v.created_at;
    const ymd = jstYmd(ts);
    if (!ymd) continue;
    if (out[ymd]) continue; // earliest already taken
    const catObj = Array.isArray(v.categories)
      ? v.categories[0]
      : v.categories;
    if (!catObj?.slug) continue;
    out[ymd] = {
      href: `/category/${catObj.slug}/videos?focus=${v.id}`,
      categoryName: catObj.name ?? catObj.slug,
      videoTitle: v.title,
    };
  }
  return out;
}
