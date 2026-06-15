import { jstTodayStartMs } from "@/lib/schedule/jst-cutoff";
import type {
  ScheduleComment,
  ScheduleSession,
} from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

/**
 * schedule-list.tsx から切り出した純関数ヘルパー群 (C-5)。state 非依存。
 */

/**
 * 元サイトの一覧 URL (`/list`) を本人入力 URL (`/input?userId=...`) に
 * 変換する。1.9.15 以前は date hint などを付けていたが character-sheets
 * が honor しないためノイズだった。dialog 側の CSS 初期スクロール offset
 * (translateY) で代替している。
 */
export function buildEditUrl(
  sourceUrl: string | null | undefined,
  userId: string,
): string | null {
  if (!sourceUrl) return null;
  try {
    const u = new URL(sourceUrl);
    u.pathname = u.pathname.replace(/\/list(\b|$)/, "/input");
    u.searchParams.set("userId", userId);
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Look up the matching videos for a session. Map is rawDate-keyed so the
 * lookup is just a key access here — no timezone math needed. TODO #1:
 * 同日複数動画を許容するため配列で返す (空配列なら「紐付なし」)。
 */
export function lookupVideoLinks(
  session: ScheduleSession,
  links: Record<string, SessionVideoLink[]> | undefined,
): SessionVideoLink[] {
  if (!links) return [];
  return links[session.rawDate] ?? [];
}

export function groupCommentsByAuthor(
  comments: ScheduleComment[],
): Map<string, ScheduleComment[]> {
  const out = new Map<string, ScheduleComment[]>();
  for (const c of comments) {
    const key = c.author.trim();
    if (!key) continue;
    const list = out.get(key);
    if (list) list.push(c);
    else out.set(key, [c]);
  }
  return out;
}

/**
 * Split sessions into upcoming (JST 今日 0:00 以降) と past (前日以前の DECISION のみ)、
 * それぞれ pre-sorted。Limit は upcoming のみに適用 — past は常に新しい順に並べ、
 * "Past" divider の直後に最も関連性の高い日付が表示されるようにする。
 *
 * TODO #80 (2.1, 2026-05-12 part4): cutoff を **JST 今日 0:00** に確定。
 * - 初版 (PR #96): `JST 当月 1 日 00:00` にして「当月分は candidate / DECISION 全部
 *   upcoming」にしたが、本番実機で「過去日程 (例 5/12 視点の 5/07) が upcoming に
 *   並ぶのが直感に反する」とユーザー指摘 (= sync の元サイト挙動と思っていたものと
 *   違った) のため、未来日付のみ並べる方針に再調整。
 * - これにより当月の過去 candidate は再び消える (= TODO #80 起票前の挙動に近い)
 *   が、当月の過去 DECISION 行は past バケット → 過去詳細表 (Table icon) に並ぶ
 *   ので情報自体は失われない。
 */
export function splitSessions(
  sessions: ScheduleSession[],
  limit?: number,
): { upcoming: ScheduleSession[]; past: ScheduleSession[] } {
  // JST 今日 0:00 (UTC ms)。計算は jst-cutoff.ts に一本化 — 過去簡易
  // チップ (schedule-past-simple.tsx) と同じ cutoff を共有し、片方だけ
  // 変更されて past 判定が食い違うのを防ぐ (2.7, 2026-06-11)。
  const cutoff = jstTodayStartMs();
  const upcoming: ScheduleSession[] = [];
  const past: ScheduleSession[] = [];
  for (const s of sessions) {
    if (s.date.getTime() >= cutoff) {
      upcoming.push(s);
      continue;
    }
    // 過去側は「開催確定 (DECISION)」のみ表示。◯ は『参加可投票』であっ
    // て実際に開催された記録ではないので fallback に使えない (流れた候補
    // 日にも投票が残るため、◯ 許可するとノイズが増える)。aged out で
    // DECISION が落ちた分は `mergeStoredPastSessions` 経由で Discord 取
    // り込み / snapshot 行が DECISION 扱いで補完する (TODO #24)。
    if (s.status === "DECISION") past.push(s);
  }
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  past.sort((a, b) => b.date.getTime() - a.date.getTime());
  return {
    upcoming: typeof limit === "number" ? upcoming.slice(0, limit) : upcoming,
    past,
  };
}
