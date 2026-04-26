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

export type Attendance = "◯" | "⏰" | "△" | "×" | "－";
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
};

const NAMELINK_USER_RE =
  /<a\s+class="namelink"\s+href="[^"]*userId=([^"&]+)[^"]*"[^>]*>([^<]+)<\/a>/g;

const ROW_RE = /<tr id="row_\d+">([\s\S]*?)<\/tr>/g;
const DATETITLE_RE = /<th class="datetitle">\s*([^<]+?)\s*</;
// Permissive: extract any value, then bucket as DECISION/CANDIDATE later.
// Past rows on character-sheets sometimes have a different (or empty) value
// once a session has aged past its date — we still want to display them.
const DATESTATUS_RE = /class="dateStatus"[\s\S]{0,200}?value="([^"]*)"/;
const ATTENDANCE_RE =
  /<span\s+class="tag statustag[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g;

const RAW_DATE_RE =
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})\(([日月火水木金土])\)\s*(\d{1,2}):(\d{2})\s*[~〜]\s*(\d{1,2}):(\d{2})$/;

export function parseSchedule(html: string): ParsedSchedule {
  const users = parseUsers(html);
  const sessions = parseSessions(html, users.length);
  const comments = parseComments(html);
  return { users, sessions, comments };
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
    const rowHtml = rowMatch[1];
    const dateMatch = DATETITLE_RE.exec(rowHtml);
    const statusMatch = DATESTATUS_RE.exec(rowHtml);
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
      status: statusMatch[1] as SessionStatus,
      attendances,
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
  return { users: parsed.users, sessions, comments: parsed.comments };
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
  // The schedule labels are JST. Build a UTC instant directly so the result
  // is timezone-independent — `Date.UTC(...)` plus a -9h shift represents
  // "JST clock time" → "the same moment expressed as UTC". This means the
  // returned Date works correctly whether the server runs on UTC (Vercel) or
  // local Asia/Tokyo (developer machine).
  const date = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(sh),
      Number(sm),
      0,
      0,
    ) - JST_OFFSET_MS,
  );
  return {
    date,
    dayOfWeek: dow,
    startTime: `${sh}:${sm}`,
    endTime: `${eh}:${em}`,
  };
}

function isAttendance(s: string): s is Attendance {
  return s === "◯" || s === "⏰" || s === "△" || s === "×" || s === "－";
}

/**
 * HTML entity decoder. Handles the named refs we've seen on the source page
 * plus generic numeric refs (&#NN; / &#xHH;) so unanticipated emoji/symbols
 * survive without us having to enumerate every possible entity.
 *
 * `&amp;` is processed first so something like `&amp;hellip;` (rare, but
 * possible if the upstream double-encodes) decodes correctly.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&times;/g, "×")
    .replace(/&hellip;/g, "…")
    .replace(/&yen;/g, "¥")
    .replace(/&copy;/g, "©")
    .replace(/&reg;/g, "®")
    .replace(/&trade;/g, "™")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&middot;/g, "·")
    .replace(/&hearts;/g, "♥")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try {
        return String.fromCodePoint(parseInt(num, 10));
      } catch {
        return "";
      }
    });
}
