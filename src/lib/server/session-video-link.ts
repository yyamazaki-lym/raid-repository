import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Match each schedule session to the most likely video — the one
 * uploaded within ~36h of session start. The previous "same JST day"
 * heuristic missed common cases where the video was uploaded the
 * morning AFTER a late-night session.
 *
 * Match rule:
 *   - kind = 'video'
 *   - posted_at (or created_at fallback) within
 *     [session.date, session.date + 36h]
 *   - Earliest matching video wins
 *   - Each video matches at most one session (used-set), so two
 *     adjacent sessions don't both link to the same recording
 *
 * Output is keyed by `session.rawDate` (the original schedule label)
 * so the consumer just does `map[session.rawDate]` — no timezone math
 * on the client side.
 */

export type SessionVideoLink = {
  /** Path the schedule page should link to. */
  href: string;
  /** Category name shown in the tooltip ("ヘビー級 → 動画"). */
  categoryName: string;
  /** Video title for tooltip / accessibility. */
  videoTitle: string;
  /** FFLogs URL associated with the video, if set. */
  logsUrl: string | null;
};

const MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;

type SessionLite = { rawDate: string; date: Date };

export async function buildSessionVideoLinkMap(
  sessions: SessionLite[],
): Promise<Record<string, SessionVideoLink>> {
  if (sessions.length === 0) return {};

  const supabase = await createClient();
  type Row = {
    id: string;
    title: string;
    posted_at: string | null;
    created_at: string;
    logs_url: string | null;
    categories:
      | { slug: string; name: string }
      | { slug: string; name: string }[]
      | null;
  };
  const { data, error } = await supabase
    .from("category_links")
    .select(
      "id, title, posted_at, created_at, logs_url, " +
        "categories!inner(slug, name)",
    )
    .eq("kind", "video")
    .order("posted_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return {};
  const videos = data as unknown as Row[];

  // Pre-compute each video's effective timestamp once.
  const videoEntries = videos
    .map((v) => {
      const ts = v.posted_at ?? v.created_at;
      const tMs = new Date(ts).getTime();
      if (Number.isNaN(tMs)) return null;
      const cat = Array.isArray(v.categories) ? v.categories[0] : v.categories;
      if (!cat?.slug) return null;
      return {
        id: v.id,
        title: v.title,
        logsUrl: v.logs_url ?? null,
        categorySlug: cat.slug,
        categoryName: cat.name ?? cat.slug,
        ts: tMs,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Process sessions oldest-first so videos are claimed by the
  // chronologically earliest plausible session.
  const sortedSessions = [...sessions].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const used = new Set<string>();
  const out: Record<string, SessionVideoLink> = {};
  for (const s of sortedSessions) {
    const start = s.date.getTime();
    const end = start + MATCH_WINDOW_MS;
    // Earliest unused video whose timestamp falls in the window.
    const match = videoEntries.find(
      (v) => !used.has(v.id) && v.ts >= start && v.ts <= end,
    );
    if (!match) continue;
    used.add(match.id);
    out[s.rawDate] = {
      href: `/category/${match.categorySlug}/videos?focus=${match.id}`,
      categoryName: match.categoryName,
      videoTitle: match.title,
      logsUrl: match.logsUrl,
    };
  }
  return out;
}
