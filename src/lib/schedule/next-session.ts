/**
 * Server-side fetch + parse of the character-sheets schedule page.
 *
 * Combined entry point — exposes both the full schedule (users + sessions)
 * for the native list view, and a derived "next confirmed session".
 *
 * Result is cached for 30 minutes via Next.js `fetch` revalidate. 旧版は
 * 10 分だったが、TOP の Promise.all 8 fetch のうち最遅 = この外部
 * scrape (1〜3s) が cache miss 時に TTFB を支配していたため TODO #55 で
 * 30 分へ延長。admin 系 mutation (snapshot / カテゴリ編集 / Discord
 * 取込み等) は既に `revalidatePath("/")` で route の Data Cache を
 * 無効化しているので、明示的なフレッシュ更新は従来通り効く (TTL
 * 延長で増えるのは「何もしていない時間帯のキャッシュ命中率」のみ)。
 */

import {
  parseSchedule,
  attachUsersToSessions,
  type ParsedSchedule,
  type ScheduleSession,
} from "./parse";
import { getScheduleSourceUrl } from "./source-url";
import { fetchStoredPastSessions } from "@/lib/server/discord-schedule";

export type {
  ScheduleSession,
  ScheduleUser,
  Attendance,
  ScheduleComment,
} from "./parse";

export type ScheduleFetchResult =
  | { ok: true; data: ParsedSchedule }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

export type NextSessionResult =
  | { ok: true; session: ScheduleSession | null }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

/** "Still relevant" = up to 6 hours past the start time. */
const STILL_RELEVANT_MS = 6 * 60 * 60 * 1000;

/**
 * Fetch + parse character-sheets WITHOUT merging stored past sessions.
 *
 * Used by the snapshot action to get raw upstream data (the merge would
 * create a feedback loop where snapshotted attendance keeps re-saving
 * itself, and complicates "what just changed" logic).
 */
export async function fetchScheduleRaw(): Promise<ScheduleFetchResult> {
  const url = await getScheduleSourceUrl();
  if (!url) return { ok: false, reason: "no-url" };

  let html: string;
  try {
    // TODO #61 temp: bypass Vercel Data Cache to test cache-stale hypothesis
    // (c-1). Revert to `next: { revalidate: 1800 }` once root cause is fixed.
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "RaidRepository/0.1" },
    });
    if (!res.ok) {
      console.warn("[schedule] non-OK response:", res.status);
      return { ok: false, reason: "fetch-failed" };
    }
    html = await res.text();
  } catch (err) {
    console.warn("[schedule] fetch error:", err);
    return { ok: false, reason: "fetch-failed" };
  }

  try {
    const data = attachUsersToSessions(parseSchedule(html));
    // TODO #61 temp: per-fetch summary for cache/UA debug. Captures
    // htmlLen + DECISION/CANDIDATE counts so a single Vercel log line
    // tells us whether the upstream HTML is the right one.
    let decisionCount = 0;
    let candidateCount = 0;
    for (const s of data.sessions) {
      if (s.status === "DECISION") decisionCount++;
      else candidateCount++;
    }
    console.warn("[parse-summary]", {
      htmlLen: html.length,
      usersCount: data.users.length,
      sessionsCount: data.sessions.length,
      decisionCount,
      candidateCount,
    });
    return { ok: true, data };
  } catch (err) {
    console.warn("[schedule] parse error:", err);
    return { ok: false, reason: "parse-failed" };
  }
}

export async function fetchSchedule(): Promise<ScheduleFetchResult> {
  const result = await fetchScheduleRaw();
  if (!result.ok) return result;
  // Merge in past sessions stored from Discord notifications + snapshot
  // mechanism. Stored sessions appear at the bottom of the list (sorted
  // into past); snapshotted ones carry their original attendance.
  try {
    const merged = await mergeStoredPastSessions(result.data);
    return { ok: true, data: merged };
  } catch (err) {
    console.warn("[schedule] merge error:", err);
    return result; // best-effort: live data alone is still useful
  }
}

/**
 * Merge `schedule_past_sessions` rows into the parsed schedule.
 *
 * 設計方針 (TODO #24): 過去日程は Discord 取り込み / snapshot を
 * authoritative source とする。character-sheets HTML は実際は流した
 * 日でも DECISION マーカーが残っていることがあり (固定メンバーが
 * source page を手動で更新しないため)、それを信用すると未開催日が
 * past に紛れ込む。Discord 通知 (本日YYYY/MM/DD...) は実開催の証拠
 * なので、これと snapshot 由来行のみを「実開催」とみなす。
 *
 * - **未来 (date >= cutoff)**: char-sheets をそのまま採用 (出欠表は
 *   live ソースが正)。Discord/snapshot は past 専用なので考慮外。
 * - **過去 (date < cutoff)**: stored (Discord/snapshot) 由来行のみ
 *   採用。char-sheets 由来の過去行は破棄。char-sheets と stored で
 *   rawDate が一致した場合は char-sheets の attendance データを保持
 *   (出欠記号が live data の方が正確) しつつ「verified by import」と
 *   して past に残す。
 */
async function mergeStoredPastSessions(
  parsed: ParsedSchedule,
): Promise<ParsedSchedule> {
  let stored: Awaited<ReturnType<typeof fetchStoredPastSessions>>;
  try {
    stored = await fetchStoredPastSessions();
  } catch {
    return parsed; // best-effort merge — return raw on DB failure
  }

  // Index current users by name so snapshot attendance (which is
  // name-keyed for stability across userId changes) can be mapped
  // into the parsed user table.
  const userIdByName = new Map(parsed.users.map((u) => [u.name, u.userId]));

  const nowMs = Date.now();
  const cutoffMs = nowMs - 6 * 60 * 60 * 1000;

  // 未来日時の stored 行は概念的に schedule_past_sessions に居るべき
  // ではない (importer 側のバリデーション不足で混入したケース)。past
  // 化してから表示されると「実開催してない日」が紛れ込むので merge
  // 時にもう一度ガード。
  const validStored = stored.filter((s) => {
    const dateMs = new Date(s.parsedDate).getTime();
    return Number.isFinite(dateMs) && dateMs <= nowMs;
  });
  const verifiedRawDates = new Set(validStored.map((s) => s.rawDate));

  // char-sheets セッション: 未来はそのまま、過去は verified だった
  // ら DECISION 扱いで残す (出欠記号は char-sheets 側の方が新しい /
  // 正確なので維持)、verified でなければ past から除外。
  const charSheetsKept: ScheduleSession[] = [];
  for (const s of parsed.sessions) {
    if (s.date.getTime() >= cutoffMs) {
      charSheetsKept.push(s);
      continue;
    }
    if (verifiedRawDates.has(s.rawDate)) {
      // Live char-sheets row backed by Discord/snapshot evidence — keep
      // attendances but force DECISION (aged out rows lose dateStatus).
      charSheetsKept.push({ ...s, status: "DECISION" });
    }
    // それ以外の char-sheets 過去行は捨てる。
  }

  // stored 行のうち char-sheets で既出ではないものを additions として
  // 追加 (char-sheets と一致するものは上で残しているので skip)。
  const charSheetsRawDates = new Set(parsed.sessions.map((s) => s.rawDate));
  const additions: ScheduleSession[] = [];
  for (const s of validStored) {
    if (charSheetsRawDates.has(s.rawDate)) continue;

    // Convert snapshot attendances (name-keyed) to userId-keyed for the
    // live render. Names not in the current user list are skipped.
    const attendances: Record<string, string> = {};
    if (s.attendances) {
      for (const [name, sym] of Object.entries(s.attendances)) {
        const uid = userIdByName.get(name);
        if (uid) attendances[uid] = sym;
      }
    }

    additions.push({
      rawDate: s.rawDate,
      date: new Date(s.parsedDate),
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      // Discord 通知 / スナップショット由来の行は「実際に announce
      // された開催確定セッション」なので DECISION 扱い。pickNextDecision
      // は date < cutoff で past を弾くので "next confirmed" の誤選択
      // にはならない。
      status: "DECISION",
      attendances: attendances as ParsedSchedule["sessions"][number]["attendances"],
      // No char-sheets `<tr id="row_N">` for synthetic rows — the iframe
      // jump (`#row_N` anchor) doesn't apply.
      rowIndex: null,
    });
  }

  return {
    ...parsed,
    sessions: [...charSheetsKept, ...additions],
  };
}

export async function fetchNextConfirmedSession(): Promise<NextSessionResult> {
  const result = await fetchSchedule();
  if (!result.ok) return result;
  return { ok: true, session: pickNextDecision(result.data.sessions) };
}

export function pickNextDecision(
  sessions: ScheduleSession[],
): ScheduleSession | null {
  const cutoff = Date.now() - STILL_RELEVANT_MS;
  let earliest: ScheduleSession | null = null;
  for (const s of sessions) {
    if (s.status !== "DECISION") continue;
    if (s.date.getTime() < cutoff) continue;
    if (!earliest || s.date < earliest.date) earliest = s;
  }
  return earliest;
}
