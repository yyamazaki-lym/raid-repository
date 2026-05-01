/**
 * Parser for the character-sheets.appspot.com schedule HTML.
 *
 * The page is a static HTML table with consistent structure:
 *   - <tr id="namerow"> contains user header cells (`<a class="namelink" href="...userId=ID">NAME</a>`).
 *   - <tr id="row_N"> contains one session per row, with:
 *       - <th class="datetitle">DATE TEXT ...</th>
 *       - <input class="dateStatus" value="CANDIDATE|DECISION" />
 *       - 5 self-input cells (`<td><span class="choice"></span></td>`)
 *       - One attendance cell per user (`<td><span class="tag statustag is-X is-Y">SYMBOL</span></td>`)
 *
 * Only `value="DECISION"` rows are treated as confirmed. The visual
 * `<i class="fas fa-check-square">` icon appears in every row (CSS toggles
 * its appearance based on dateStatus client-side), so it can't be the marker.
 */
import { decodeHtmlEntities } from "@/lib/html-entities";

/**
 * 出欠記号。標準セットは「◯ / ⏰ / △ / × / －」だが、character-sheets
 * 側では運用カスタムとして「昼 / 夜 / 全」のような任意ラベルも採用される。
 * 表示側 (`ATT_TONE`) は未知ラベルにフォールバック tone を当てるので、
 * parser はここで union を絞らず「空文字以外」を全て通す方針 (TODO #60)。
 */
export type Attendance = string;
export type SessionStatus = "CANDIDATE" | "DECISION";

export type ScheduleUser = {
  userId: string;
  name: string;
};

export type ScheduleSession = {
  /** "2026/04/26(日) 22:00~0:00" — the original Japanese label. */
  rawDate: string;
  /** Local-time start of the session (server timezone). */
  date: Date;
  /** "日", "月", … */
  dayOfWeek: string;
  /** "22:00" */
  startTime: string;
  /** "0:00" */
  endTime: string;
  status: SessionStatus;
  /** Map of userId → attendance symbol. Missing entries = no answer recorded. */
  attendances: Record<string, Attendance>;
  /**
   * N from `<tr id="row_N">` on character-sheets. Used by the in-portal
   * iframe edit dialog to jump directly to this row via `#row_N` URL
   * fragment — replaces the heuristic translateY clipping used pre-2.1.
   * row_0 = oldest session row in DOM order. `null` for synthetic rows
   * (Discord / snapshot-derived past sessions that have no character-
   * sheets DOM row to anchor to).
   */
  rowIndex: number | null;
};

export type ScheduleComment = {
  /** The comment body, with the leading "・" and trailing parens stripped. */
  body: string;
  /** Author display name (best-effort; empty string if we can't extract). */
  author: string;
  /** "2026年01月06日 15時44分03秒" — null if the source didn't include one. */
  timestamp: string | null;
};

export type ParsedSchedule = {
  users: ScheduleUser[];
  sessions: ScheduleSession[];
  /** Free-form comments from the "■コメント" section. */
  comments: ScheduleComment[];
  /**
   * Free-form text extracted from the page header / top section
   * (typically operation rules, group conventions, etc.). `null` when
   * the schedule page has no top text. Used by the schedule legend
   * to surface a clickable comment icon → popover on the portal.
   */
  topText: string | null;
};

const NAMELINK_USER_RE =
  /<a\s+class="namelink"\s+href="[^"]*userId=([^"&]+)[^"]*"[^>]*>([^<]+)<\/a>/g;

const ROW_RE = /<tr id="row_(\d+)">([\s\S]*?)<\/tr>/g;
const DATETITLE_RE = /<th class="datetitle">\s*([^<]+?)\s*</;
// Permissive: extract any value, then bucket as DECISION/CANDIDATE later.
// Past rows on character-sheets sometimes have a different (or empty) value
// once a session has aged past its date — we still want to display them.
const DATESTATUS_RE = /class="dateStatus"[\s\S]{0,200}?value="([^"]*)"/;
const ATTENDANCE_RE =
  /<span\s+class="tag statustag[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g;

// 時間レンジ部分は optional。character-sheets では時間未入力のまま
// 運用するスケジュールが存在し、その場合 datetitle は `2026/05/01(金)`
// のように日付+曜日のみで返される。時間欠落時は startTime/endTime に
// 空文字を入れ、Date は JST 当日 00:00 を使う (2.1 (2026-05-01) TODO #59)。
const RAW_DATE_RE =
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})\(([日月火水木金土])\)(?:\s*(\d{1,2}):(\d{2})\s*[~〜]\s*(\d{1,2}):(\d{2}))?$/;

export function parseSchedule(html: string): ParsedSchedule {
  const users = parseUsers(html);
  const sessions = parseSessions(html, users.length);
  const comments = parseComments(html);
  const topText = parseTopText(html);
  return { users, sessions, comments, topText };
}

/**
 * Pull the page-header free-form text (e.g. operation rules) shown
 * ABOVE the first schedule `<table>`. Heuristic — character-sheets
 * doesn't expose a stable id for this region, so we extract from
 * `<p>` / `<pre>` / `<blockquote>` / `<h2>`-`<h3>` blocks before the
 * first table. Returns `null` when no usable text was found.
 */
function parseTopText(html: string): string | null {
  const tableIdx = html.search(/<table\b/i);
  if (tableIdx < 0) return null;

  // Strip script/style/noscript content so JS literals don't leak in.
  let before = html
    .slice(0, tableIdx)
    .replace(
      /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    );

  // Restrict to inside <body>; the <head> contains meta/title text we
  // don't want.
  const bodyMatch = before.match(/<body\b[^>]*>([\s\S]*)$/i);
  if (bodyMatch) before = bodyMatch[1]!;

  // 1.9.37: truncate at the "■コメント" header so any comments
  // rendered above the schedule table aren't pulled into the top
  // text. Comments are surfaced separately by parseComments() and
  // shown per-author on the schedule, so they don't belong here.
  const commentIdx = before.indexOf("■コメント");
  if (commentIdx > 0) before = before.slice(0, commentIdx);

  // Extract text from prominent block elements before the schedule.
  // We deliberately skip <h1> (typically the static name / title of
  // the page) and <div> (would catch the entire layout container).
  const blocks: string[] = [];
  const seen = new Set<string>();
  const blockRe = /<(p|pre|blockquote|h2|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(before)) !== null) {
    const text = stripHtmlToText(m[2]!).trim();
    if (!text || text.length < 2) continue;
    // Skip duplicates (some templates double-render the same text in
    // hidden vs visible variants).
    if (seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }

  if (blocks.length === 0) return null;
  return blocks.join("\n");
}

/**
 * Strip HTML tags + decode common entities, preserving paragraph-level
 * line breaks. Used by `parseTopText` to clean fragments for popover
 * display.
 *
 * 1.9.36: emoji handling extended:
 *   - Numeric character refs `&#1234;` and `&#xABCD;` decoded to their
 *     Unicode code-points (covers emoji + most non-ASCII)
 *   - `<img alt="...">` replaced by its alt text — many sites
 *     (character-sheets included) use Twemoji-style image emoji
 *     where the visible character is in the `alt` attribute
 *
 * 1.9 (2026-04-28): 名前付きエンティティの decode を `decodeEntities`
 * 共通実装に集約 (TODO #13)。これまで `&times;` などが popup 表示で
 * 生のままになっていた問題を解決。
 */
function stripHtmlToText(html: string): string {
  const stripped = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*\/?>/gi, "$1")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

const COMMENT_HEADER = "■コメント";
const COMMENT_LINE_RE = /<p\s+class="is-size-7">\s*・([^<]+)<\/p>/g;

function parseComments(html: string): ScheduleComment[] {
  const startIdx = html.indexOf(COMMENT_HEADER);
  if (startIdx === -1) return [];
  // The comments block sits between the "■コメント" header and the schedule
  // table container that follows. Slicing the region prevents accidental
  // matches against unrelated `<p class="is-size-7">` elements elsewhere on
  // the page (e.g. legend / rules above).
  const tableIdx = html.indexOf('<div class="table-container', startIdx);
  const region = html.slice(startIdx, tableIdx === -1 ? html.length : tableIdx);

  const out: ScheduleComment[] = [];
  for (const m of region.matchAll(COMMENT_LINE_RE)) {
    const text = decodeEntities(m[1]).trim();
    if (!text) continue;
    out.push(splitComment(text));
  }
  return out;
}

/**
 * Best-effort split of "BODY(AUTHOR)" or "BODY(AUTHOR YYYY年MM月DD日 HH時MM分SS秒)".
 * The body itself may contain parentheses, so we anchor on the LAST `(...)`
 * group at end-of-string.
 */
function splitComment(text: string): ScheduleComment {
  const tailMatch = /^([\s\S]*)\(([^)]+)\)\s*$/.exec(text);
  if (!tailMatch) {
    return { body: text, author: "", timestamp: null };
  }
  const body = tailMatch[1].trim();
  const inside = tailMatch[2].trim();
  // Look for "AUTHOR <whitespace> 4桁年..." → split on the year boundary.
  const tsMatch = /^(.+?)\s+(\d{4}年[\s\S]+)$/.exec(inside);
  if (tsMatch) {
    return {
      body,
      author: tsMatch[1].trim(),
      timestamp: tsMatch[2].trim(),
    };
  }
  return { body, author: inside, timestamp: null };
}

function parseUsers(html: string): ScheduleUser[] {
  const seen = new Set<string>();
  const out: ScheduleUser[] = [];
  for (const m of html.matchAll(NAMELINK_USER_RE)) {
    const userId = m[1];
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, name: decodeEntities(m[2]).trim() });
  }
  return out;
}

function parseSessions(html: string, userCount: number): ScheduleSession[] {
  const out: ScheduleSession[] = [];
  for (const rowMatch of html.matchAll(ROW_RE)) {
    const rowIndex = Number(rowMatch[1]);
    const rowHtml = rowMatch[2];
    const dateMatch = DATETITLE_RE.exec(rowHtml);
    const statusMatch = DATESTATUS_RE.exec(rowHtml);
    // TODO #61 temp debug: capture raw values per row to diagnose
    // why DECISION rows render as CANDIDATE on the demo site. Remove
    // once the root cause is identified.
    const dateRawDebug = dateMatch ? dateMatch[1].trim() : null;
    const statusRawDebug = statusMatch ? statusMatch[1] : null;
    console.warn("[parse-debug]", {
      rowIndex,
      dateRaw: dateRawDebug,
      statusRaw: statusRawDebug,
      statusRawLen: statusRawDebug == null ? null : statusRawDebug.length,
      dateMatched: !!dateMatch,
      statusMatched: !!statusMatch,
    });
    if (!dateMatch || !statusMatch) continue;

    const rawDate = dateMatch[1].trim();
    const parsed = parseRawDate(rawDate);
    if (!parsed) continue;

    // Bucket the dateStatus value:
    //   "DECISION"     → confirmed session
    //   anything else  → CANDIDATE (default; covers empty / past / future)
    const statusRaw = statusMatch ? statusMatch[1] : "";
    const status: SessionStatus =
      statusRaw === "DECISION" ? "DECISION" : "CANDIDATE";

    // Attendance symbols, in document order. We only collect entries up to
    // the user count to avoid accidentally consuming extra spans elsewhere.
    const symbols: Attendance[] = [];
    for (const attMatch of rowHtml.matchAll(ATTENDANCE_RE)) {
      const symbol = decodeEntities(attMatch[1]).trim();
      if (isAttendance(symbol)) symbols.push(symbol);
      if (symbols.length >= userCount) break;
    }

    const attendances: Record<string, Attendance> = {};
    for (let i = 0; i < symbols.length; i++) {
      attendances[`__index_${i}`] = symbols[i];
    }

    out.push({
      rawDate,
      ...parsed,
      status,
      attendances,
      rowIndex,
    });
  }
  return out;
}

/**
 * Re-key attendance maps from positional indexes to actual userIds.
 * (Done as a post-process so `parseSessions` doesn't need to know users.)
 */
export function attachUsersToSessions(parsed: ParsedSchedule): ParsedSchedule {
  const sessions = parsed.sessions.map((s) => {
    const attendances: Record<string, Attendance> = {};
    parsed.users.forEach((user, i) => {
      const v = s.attendances[`__index_${i}`];
      if (v) attendances[user.userId] = v;
    });
    return { ...s, attendances };
  });
  return {
    users: parsed.users,
    sessions,
    comments: parsed.comments,
    topText: parsed.topText,
  };
}

/** JST has no DST so a fixed offset is always correct. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseRawDate(raw: string): {
  date: Date;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
} | null {
  const m = RAW_DATE_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, dow, sh, sm, eh, em] = m;
  const hasTime = sh !== undefined && sm !== undefined;
  // The schedule labels are JST. Build a UTC instant directly so the result
  // is timezone-independent — `Date.UTC(...)` plus a -9h shift represents
  // "JST clock time" → "the same moment expressed as UTC". This means the
  // returned Date works correctly whether the server runs on UTC (Vercel) or
  // local Asia/Tokyo (developer machine). Time 未入力時は当日 JST 00:00。
  const date = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      hasTime ? Number(sh) : 0,
      hasTime ? Number(sm) : 0,
      0,
      0,
    ) - JST_OFFSET_MS,
  );
  return {
    date,
    dayOfWeek: dow,
    startTime: hasTime ? `${sh}:${sm}` : "",
    endTime: eh !== undefined && em !== undefined ? `${eh}:${em}` : "",
  };
}

function isAttendance(s: string): s is Attendance {
  return s !== "";
}

/**
 * HTML エンティティ decode の薄い wrapper。実体は `@/lib/html-entities` の
 * `decodeHtmlEntities` に集約 (1.9 (2026-04-28) で散在していた 3 種の
 * 不完全 decoder を統合)。`parseTopText` / `parseComments` /
 * `parseUsers` / `parseAttendance` などこのファイル内のすべてのテキスト
 * 抽出経路で共有して使う。
 */
const decodeEntities = decodeHtmlEntities;
