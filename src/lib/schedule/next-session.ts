/**
 * Server-side fetch + parse of the character-sheets schedule page.
 *
 * Combined entry point — exposes both the full schedule (users + sessions)
 * for the native list view, and a derived "next confirmed session".
 *
 * **Cache 戦略 (TODO #55 part3)**: `next: { revalidate: 60, tags: [SCHEDULE_CACHE_TAG] }`。
 * 60 秒 TTL の Vercel Data Cache に乗せて FCP を短縮しつつ、portal 経由の
 * iframe edit dialog 閉じる時に Server Action `invalidateScheduleCache`
 * (`updateTag(SCHEDULE_CACHE_TAG)`) で read-your-own-writes 即時無効化する。
 * TODO #61 で `revalidatePath("/")` が fetch cache key を外せないケースに
 * 遭遇し `cache: "no-store"` に逃げていたが、tag-based 無効化は cache key
 * に直接効くので stale 問題を回避できる。外部編集 (portal を介さない
 * character-sheets 直接編集) は最大 60s lag。
 */

import { unstable_rethrow } from "next/navigation";
import {
  parseSchedule,
  attachUsersToSessions,
  type ParsedSchedule,
  type ScheduleSession,
} from "./parse";
import { getScheduleSourceUrl } from "./source-url";
import {
  fetchExcludedPastSessions,
  fetchMemberNameAliases,
  fetchStoredPastSessions,
} from "@/lib/server/discord-schedule";
import { buildSheetAttendanceMapper } from "./attendance-sync-symbols";
import { planPastSessionMerge } from "./past-session-dedup";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { assertPublicResolution } from "@/lib/server/safe-fetch";

export type {
  ScheduleSession,
  ScheduleUser,
  Attendance,
  ScheduleComment,
  ScheduleAttendanceOptions,
  NativeScheduleMeta,
} from "./parse";

export type ScheduleFetchResult =
  | { ok: true; data: ParsedSchedule }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

export type NextSessionResult =
  | { ok: true; session: ScheduleSession | null }
  | { ok: false; reason: "no-url" | "fetch-failed" | "parse-failed" };

/**
 * Vercel Data Cache tag for character-sheets fetches。
 * iframe edit dialog 閉じる時に server action から `updateTag` で
 * 明示無効化される (`@/lib/server/schedule-cache-actions`、Next.js 16 の
 * read-your-own-writes 向け API)。
 */
export const SCHEDULE_CACHE_TAG = "schedule";

/** "Still relevant" = up to 6 hours past the start time. */
const STILL_RELEVANT_MS = 6 * 60 * 60 * 1000;

/**
 * character-sheets fetch の上限 (2026-07-12 監査)。Data Cache は
 * stale-while-revalidate なので通常はブロックしないが、cold cache と
 * `updateTag` 直後の同期再取得だけは応答をそのまま待つ。外部サイトが
 * 「遅いが生きている」状態のとき TOP 描画が関数タイムアウトまで張り付く
 * のを防ぐ。8s 超は既存の catch → fetch-failed カードに落ち、60s 以内の
 * 再訪 (revalidate) で自然回復する。
 */
const SCHEDULE_FETCH_TIMEOUT_MS = 8_000;

/**
 * 過去セッション merge の読み込み窓 (2026-07-12 監査 A-4、ユーザー決定)。
 *
 * `schedule_past_sessions` は追記のみで無制限成長するため、全件 merge だと
 * DB 読み・RSC ペイロード・過去詳細表の DOM が年単位で線形に重くなる。
 * 直近 12 ヶ月に絞る (それより古い行は DB に残る — 削除はしない。表示が
 * 必要になったら「もっと見る」の遅延取得を別途足す)。副次効果として
 * `buildSessionVideoLinkMap` の posted_at 窓 (セッション日付範囲 ±7d) も
 * 全履歴の min に引きずられなくなり、video クエリが有界になる。
 */
const PAST_MERGE_WINDOW_MONTHS = 12;

/**
 * Fetch + parse character-sheets WITHOUT merging stored past sessions.
 *
 * Used by the snapshot action to get raw upstream data (the merge would
 * create a feedback loop where snapshotted attendance keeps re-saving
 * itself, and complicates "what just changed" logic).
 */
/**
 * `/schedule/list?key=...` URL から `/schedule/edit?key=...` を派生。
 * 凡例 (出欠選択肢マスター) は edit ページのフォーム input にしか
 * 載っていないので、list と並列に取得する。失敗時は null。
 */
function deriveEditUrl(listUrl: string): string | null {
  try {
    const u = new URL(listUrl);
    if (!/\/list(\b|$)/.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\/list(\b|$)/, "/edit");
    return u.toString();
  } catch {
    return null;
  }
}

/** リダイレクトを手で辿る最大段数 (http → https の 1 段 + 余裕)。 */
const SCHEDULE_MAX_REDIRECT_HOPS = 3;

async function fetchHtmlOrNull(target: string): Promise<string | null> {
  // SSRF defense-in-depth: schedule_url は admin が設定する DB 値だが、
  // 内部 IP / loopback / link-local への fetch を明示的に弾く。
  if (!isPublicHttpUrl(target)) {
    console.warn("[schedule] blocked non-public url:", target);
    return null;
  }
  try {
    // 2026-10-01 監査 S-2: `isPublicHttpUrl` は IP リテラルしか見ないので、
    // 内部 IP に解決するホスト名 (`127.0.0.1.nip.io` 等) を素通りしていた。
    // Data Cache (`next.tags` + `updateTag` の即時無効化) を保つため `fetch`
    // は替えず、接続前に解決先を検査する (`assertPublicResolution`)。
    // リダイレクトも自動では辿らず、行き先を同じ検査にかけてから辿る。
    let current = target;
    for (let hop = 0; hop < SCHEDULE_MAX_REDIRECT_HOPS; hop++) {
      await assertPublicResolution(current);
      // `signal` 付き fetch は request memoization の対象外になる (Next.js 16
      // fetch docs) が、fetchSchedule の呼び出しは page.tsx の 1 箇所のみで
      // 同一 render 内の重複 fetch が無く、Data Cache (revalidate/tags) は
      // signal の有無に関係なく効くため実害なし。
      const res = await fetch(current, {
        next: { revalidate: 60, tags: [SCHEDULE_CACHE_TAG] },
        headers: { "User-Agent": "RaidRepository/0.1" },
        signal: AbortSignal.timeout(SCHEDULE_FETCH_TIMEOUT_MS),
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        const next = loc ? new URL(loc, current).toString() : null;
        if (!next || !isPublicHttpUrl(next)) {
          console.warn("[schedule] blocked redirect:", res.status, current);
          return null;
        }
        current = next;
        continue;
      }
      if (!res.ok) {
        console.warn("[schedule] non-OK response:", res.status, target);
        return null;
      }
      return await res.text();
    }
    console.warn("[schedule] too many redirects:", target);
    return null;
  } catch (err) {
    console.warn("[schedule] fetch error:", err, target);
    return null;
  }
}

export async function fetchScheduleRaw(): Promise<ScheduleFetchResult> {
  const url = await getScheduleSourceUrl();
  if (!url) return { ok: false, reason: "no-url" };

  const editUrl = deriveEditUrl(url);
  // list と edit を並列 fetch。edit 失敗は致命的でない (parse 側で
  // sessions 由来 fallback / 固定凡例にデグレする) ので Promise.all
  // でなく allSettled 相当の null 許容で受ける。
  const [listHtml, editHtml] = await Promise.all([
    fetchHtmlOrNull(url),
    editUrl ? fetchHtmlOrNull(editUrl) : Promise.resolve(null),
  ]);

  if (listHtml === null) return { ok: false, reason: "fetch-failed" };

  try {
    const data = attachUsersToSessions(parseSchedule(listHtml, editHtml));
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
    // 2026-10-05: Next.js の合図は投げ直す (mergeStoredPastSessions の catch を参照)。
    unstable_rethrow(err);
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
 *
 * 2026-10-05: 「一致」を rawDate の完全一致から **同じ JST 暦日で時間帯が
 * 重なる** に広げた (`planPastSessionMerge`)。開催時刻を後から変える
 * (22:00 → 21:30) と、スナップショット / Discord 取り込みの古い時刻の行が
 * 残り、同じ日が 2 行並んでいた (本番の 10/02・10/04)。まとめた rawDate は
 * `rawDateAliases` で返し、Logs・メモの付け先を残した行に寄せる。
 */
async function mergeStoredPastSessions(
  parsed: ParsedSchedule,
): Promise<ParsedSchedule> {
  let stored: Awaited<ReturnType<typeof fetchStoredPastSessions>>;
  let excluded: Awaited<ReturnType<typeof fetchExcludedPastSessions>>;
  let memberAliases: Awaited<ReturnType<typeof fetchMemberNameAliases>>;
  try {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - PAST_MERGE_WINDOW_MONTHS);
    // 2026-10-06: 除外した行も読む。除外した行と同じ開催 (時刻違いの重複) も
    // 表示から外すため (`planPastSessionMerge` の `excluded`)。読めなければ
    // 空として扱う (従来どおり除外した rawDate の行だけが消える)。
    // メンバーのシートでの旧名も読む (名前が変わる前の日の回答を結びつける)。
    [stored, excluded, memberAliases] = await Promise.all([
      fetchStoredPastSessions({ sinceIso: since.toISOString() }),
      fetchExcludedPastSessions({ sinceIso: since.toISOString() }),
      fetchMemberNameAliases(),
    ]);
  } catch (e) {
    // 2026-10-05: ビルド時の静的描画の試行で cookies() が投げる Next.js の合図
    // (DYNAMIC_SERVER_USAGE) は握らずに投げ直す。DB の失敗だけを best-effort で吸う。
    unstable_rethrow(e);
    return parsed; // best-effort merge — return raw on DB failure
  }

  // Index current users by name so snapshot attendance (which is
  // name-keyed for stability across userId changes) can be mapped
  // into the parsed user table.
  // 2026-10-06: 今のシートの名前と一致しなければ、メンバーのシートでの旧名で
  // 引く (9/11 まで「Lym」、9/18 から「Lym.sln」のように名前が変わった場合)。
  // 今のシートの名前と完全一致した回答が優先 (旧名の回答は、その人の回答が
  // 無いときだけ使う)。
  const mapSheetAttendances = buildSheetAttendanceMapper(parsed.users, memberAliases);

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
  const toCandidate = (x: {
    rawDate: string;
    startMs: number;
    startTime: string;
    endTime: string;
  }) => ({ rawDate: x.rawDate, startMs: x.startMs, startTime: x.startTime, endTime: x.endTime });
  // 同じ開催 (同じ JST 暦日 + 時間帯が重なる) を 1 つにまとめる計画。char-sheets
  // の行が残す側の最優先 (未来の行も含めて渡す — 未来の行に重なる stored の
  // スナップショット行を、表示に二重に足さないため)。
  const plan = planPastSessionMerge({
    sheet: parsed.sessions.map((s) =>
      toCandidate({ ...s, startMs: s.date.getTime() }),
    ),
    stored: validStored.map((s) => ({
      ...toCandidate({ ...s, startMs: new Date(s.parsedDate).getTime() }),
      hasAttendances: s.attendances !== null && Object.keys(s.attendances).length > 0,
      createdAt: s.createdAt,
      source: s.source,
    })),
    excluded: excluded.map((e) =>
      toCandidate({ ...e, startMs: new Date(e.parsedDate).getTime() }),
    ),
  });

  // char-sheets セッション: 未来はそのまま、過去は同じ開催の stored 行が
  // あれば DECISION 扱いで残す (出欠記号は char-sheets 側の方が新しい /
  // 正確なので維持)、無ければ past から除外。
  const charSheetsKept: ScheduleSession[] = [];
  for (const s of parsed.sessions) {
    if (s.date.getTime() >= cutoffMs) {
      charSheetsKept.push(s);
      continue;
    }
    if (plan.verifiedSheetRawDates.has(s.rawDate)) {
      // Live char-sheets row backed by Discord/snapshot evidence — keep
      // attendances but force DECISION (aged out rows lose dateStatus).
      charSheetsKept.push({ ...s, status: "DECISION" });
    }
    // それ以外の char-sheets 過去行は捨てる。
  }

  // stored 行のうち char-sheets のどの行とも同じ開催でないものを、開催 1 つに
  // つき 1 行だけ additions として足す (`plan.additions`)。char-sheets と同じ
  // 開催の stored 行は、未来・過去の cutoff に関係なく足さない (旧実装の
  // 「rawDate 一致行は無条件 skip」と同じ不変条件を、同じ開催の単位で保つ)。
  const storedByRawDate = new Map(validStored.map((s) => [s.rawDate, s]));
  const additions: ScheduleSession[] = [];
  for (const c of plan.additions) {
    const s = storedByRawDate.get(c.rawDate);
    if (!s) continue;

    // Convert snapshot attendances (name-keyed) to userId-keyed for the
    // live render. Names not in the current user list are skipped.
    const attendances: Record<string, string> = s.attendances
      ? mapSheetAttendances(s.attendances)
      : {};

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
    rawDateAliases: plan.aliasOf,
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
