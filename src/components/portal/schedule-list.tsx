import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarX2,
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { CommentPopover } from "./comment-popover";
import { ScheduleEditFrameDialog } from "./schedule-edit-frame-dialog";
import { toast } from "sonner";
import Link from "next/link";
import {
  clearScheduleTopTextOverride,
  setScheduleTopTextOverride,
} from "@/lib/schedule-top-text-store";
import {
  SessionMemoDot,
  SessionMemoPopover,
  type SessionMemoPopoverHandle,
} from "./session-memo-popover";
import {
  useRealtimeAllScheduleMemos,
  type ScheduleSessionMemo,
} from "@/lib/schedule-memos-client";
import {
  getJapaneseHolidayName,
  isJapaneseHoliday,
} from "@/lib/japanese-holidays";
import { safeHref } from "@/lib/url-safe";
import type { JapaneseHolidaysMap } from "@/lib/japanese-holidays";
import type {
  Attendance,
  ScheduleComment,
  ScheduleFetchResult,
  ScheduleSession,
  ScheduleUser,
} from "@/lib/schedule/next-session";
import type { SessionVideoLink } from "@/lib/server/session-video-link";

// Stable reference for the realtime hook's initial param — `[]` inline
// would be a fresh array on every render and trip the hook's
// "initial-changed" guard, clobbering fetched memos with empty.
const EMPTY_MEMOS: ScheduleSessionMemo[] = [];

const ATT_TONE: Record<Attendance, string> = {
  "◯": "text-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 border-[var(--neon-cyan)]/30",
  "⏰": "text-amber-300 bg-amber-300/10 border-amber-300/30",
  "△": "text-[var(--neon-violet)] bg-[var(--neon-violet)]/10 border-[var(--neon-violet)]/30",
  "×": "text-rose-400 bg-rose-400/10 border-rose-400/30",
  "－": "text-muted-foreground bg-secondary/30 border-border/50",
};

const ATT_LEGEND: { symbol: Attendance; label: string }[] = [
  { symbol: "◯", label: "参加可" },
  { symbol: "⏰", label: "遅刻" },
  { symbol: "△", label: "未定" },
  { symbol: "×", label: "不可" },
  { symbol: "－", label: "未回答" },
];

type Props = {
  result: ScheduleFetchResult;
  /** Maximum sessions to render. Defaults to all upcoming + a small past buffer. */
  limit?: number;
  /**
   * When true, render the FULL detailed past-sessions table at the
   * bottom (with participant columns + time-of-day). The simple
   * date-only strip lives in a separate component (SchedulePastSimple)
   * inserted between the next-session card and the upcoming table.
   */
  showDetailedPast?: boolean;
  /** Source schedule URL — used to derive the per-user edit URL on hover/click. */
  scheduleUrl?: string | null;
  /**
   * Pre-fetched Japanese-holiday map (date → holiday name) passed down
   * from the server page. Used to color holiday rows red and surface
   * the holiday name in the date-cell tooltip. When undefined, the
   * synchronous hardcoded fallback is used.
   */
  holidays?: JapaneseHolidaysMap;
  /**
   * Pre-built `YYYY-MM-DD` → matching-video-link map. When a past
   * session has an entry, its date cell becomes a Link to that
   * video; otherwise the cell renders as plain text.
   */
  sessionVideoLinks?: Record<string, SessionVideoLink>;
  /**
   * Pre-built `rawDate` → FFLogs URL map for past sessions. Lets the
   * UI show a Logs icon next to a date even when there's no matching
   * video for that session.
   */
  sessionLogsByDate?: Record<string, string>;
  /**
   * True if the group has at least one Ultimate cleared. Drives the
   * legend label MEMBERS → LEGENDS swap (1.9.16). Default false.
   */
  hasUltimateClear?: boolean;
  /**
   * 運用ルール / 注意事項のローカル override (Supabase
   * `app_settings.schedule_top_text_override`)。設定済みなら scraped
   * `result.data.topText` より優先表示。Legend popup 内の「編集」ボタンで
   * 上書き可能。
   */
  topTextOverride?: string | null;
  /** TODO #11: server prefetch した memos (rawDate → memos[]) */
  initialMemosByDate?: Record<string, import("@/lib/schedule-memos-client").ScheduleSessionMemo[]>;
};

export function ScheduleList({
  result,
  limit,
  showDetailedPast = false,
  scheduleUrl,
  holidays,
  sessionVideoLinks,
  sessionLogsByDate,
  hasUltimateClear = false,
  topTextOverride = null,
  initialMemosByDate = {},
}: Props) {
  // TODO #11 phase 7: 全 memo を 1 channel で監視し、各 SessionRow には
  // 該当 rawDate の slice + refetchAll を props で配る (旧: 各行が個別
  // subscribe → N リスナー × N refetch の問題)。
  const { memosByDate, refetchAll: refetchMemos } =
    useRealtimeAllScheduleMemos(initialMemosByDate);

  // 1.9.13: replace `target="_blank"` external nav with an in-portal
  // iframe overlay. Tapping a username header or per-session attendance
  // cell now sets `editTarget`, which mounts the dialog. State lives at
  // the top level so a single dialog instance is reused across rows.
  //
  // 2.1+ (TODO #44): a per-session attendance click also passes an
  // `upcomingIndex` (0 = nearest future session). The dialog uses it to
  // clip its iframe so the target date row roughly lines up with the
  // top of the dialog. cross-origin iframe scripting / hash anchors
  // aren't honored by character-sheets so we use a heuristic:
  //   offset = MID + index * APPROX_ROW_HEIGHT
  const [editTarget, setEditTarget] = useState<{
    url: string;
    title: string;
    targetOffsetPx: number | null;
  } | null>(null);
  const openEditFrame = useCallback(
    (url: string, title: string, targetOffsetPx: number | null = null) => {
      setEditTarget({ url, title, targetOffsetPx });
    },
    [],
  );

  // 1.9.28: refresh button next to the legend lets the user pull the
  // latest schedule data on demand (no need to reload the page).
  // useTransition gives the spinner a `pending` flag so the button can
  // show a loader while server-side data is being re-fetched.
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refreshSchedule = useCallback(() => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  // 2.1 (2026-04-29): 詳細過去日程の 2 ヶ月以上前は初期非表示。
  // Past リストは年月が経つほど縦に長くなるが、最近の数試合分しか
  // 普段は参照しないので、デフォルトでは直近 2 ヶ月までを表示し、
  // それ以前は折り畳む。展開ボタンで切り替え可能 (state はここに置
  // いてマウント期間中保持)。
  const [showOlderPast, setShowOlderPast] = useState(false);
  // 2.1 (2026-04-29) hot-fix v2: トグル時にユーザの「視点」(= window.scrollY)
  // を保つ。前バージョン (PR #8) はボタンの rect.top を保つ実装にしていたが、
  // 展開時はボタンが下へ移動するためページが下方向に大量スクロールしてしまい、
  // ユーザが見ていた行が画面外に追い出される事象があった (例: 2/28 で押す
  // と最古の 2/9 まで一気に飛ぶ)。
  //
  // 正しい挙動: 展開しても、ユーザが見ている絶対位置 (= recentPast の中の
  // どこか) はそのまま。展開行 (olderPast) は画面外下方に挿入され、ユーザは
  // スクロールダウンで読みに行く。畳み時も同じく絶対位置を保つ (ドキュメント
  // 高が縮むので、ブラウザが scroll max に clamp する場合あり)。
  //
  // また、押下後フォーカスがボタンに残ると一部ブラウザが auto-scroll で
  // ボタンを viewport に入れに行くため、明示的に blur() してから scrollY
  // を復元することでこれも抑える。
  const olderToggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const onToggleOlderPast = useCallback(() => {
    const beforeScrollY = window.scrollY;
    olderToggleBtnRef.current?.blur();
    setShowOlderPast((v) => !v);
    // React commit → ブラウザ paint 後に scrollY を復元。
    // rAF 1 回だと稀に layout 反映前の値で復元してしまう (ブラウザの
    // scroll-anchoring と競合) ため 2 段重ね。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (window.scrollY !== beforeScrollY) {
          window.scrollTo({ top: beforeScrollY, behavior: "instant" });
        }
      });
    });
  }, []);

  if (!result.ok) {
    return (
      <Card className="glass flex flex-col items-center gap-3 border-destructive/40 p-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-destructive/40 bg-background/40 text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">スケジュール取得失敗</p>
        <p className="text-xs text-muted-foreground">
          {result.reason === "no-url"
            ? "NEXT_PUBLIC_SCHEDULE_URL が設定されていません。"
            : result.reason === "fetch-failed"
              ? "スケジュールサイトに接続できませんでした。"
              : "ページ構造の解析に失敗しました。"}
        </p>
      </Card>
    );
  }

  const { users, sessions, comments } = result.data;
  const commentsByAuthor = groupCommentsByAuthor(comments);

  const { upcoming, past } = splitSessions(sessions, limit);
  // Past sessions newest-first (already sorted by splitSessions). The
  // most-recent past sits at the top of the detail table — reads as
  // "what happened most recently" first.
  const renderedPast = showDetailedPast ? past : [];
  // 2.1 (2026-04-29): split into "recent" (≤ 60 days ago) and "older"
  // for the fold UX. cutoff は描画時点の Date.now なので、ページが
  // 長時間開きっぱなしでも問題なし (再 render で更新される)。
  const PAST_FOLD_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;
  const pastCutoffMs = Date.now() - PAST_FOLD_THRESHOLD_MS;
  const recentPast = renderedPast.filter(
    (s) => s.date.getTime() >= pastCutoffMs,
  );
  const olderPast = renderedPast.filter(
    (s) => s.date.getTime() < pastCutoffMs,
  );

  if (upcoming.length === 0 && renderedPast.length === 0) {
    return (
      <Card className="glass flex flex-col items-center gap-3 p-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-md border border-border/60 bg-background/40 text-muted-foreground">
          <CalendarX2 className="h-4 w-4" aria-hidden />
        </span>
        <p className="font-display text-foreground text-sm">予定なし</p>
        <p className="text-xs text-muted-foreground">
          表示できる予定が見つかりませんでした。
        </p>
      </Card>
    );
  }

  // Header row factory. The past table omits the "確定" column since
  // every past session was de facto held — the column only carries
  // signal for upcoming dates that may still slip. 確定 column has
  // 0 horizontal padding so the 16px badge sits flush against the
  // adjacent columns. Users get a min-width so name length doesn't
  // shift the table layout between rows / between the upcoming and
  // past tables.
  // 過去詳細表ではユーザー名横のメモアイコン (CommentPopover) を出さない
  // — 過去日のヘッダーで毎回メモが目に入って情報過多になっていたのを
  // 解消する (ユーザー要望)。upcoming は引き続きメモを出す。
  const tableHead = (showDecided: boolean, showComments = true) => (
    <thead>
      <tr className="border-b border-border/60 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
        <th scope="col" className="pl-3 pr-1 py-2.5">
          日程
        </th>
        {showDecided && (
          <th scope="col" className="px-1 py-2.5 text-center">
            確定
          </th>
        )}
        {users.map((u) => (
          <UserHeaderCell
            key={u.userId}
            user={u}
            comments={
              showComments ? (commentsByAuthor.get(u.name) ?? []) : []
            }
            editUrl={buildEditUrl(scheduleUrl, u.userId)}
            onOpenEditFrame={openEditFrame}
          />
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Upcoming sessions — primary card. Layout untouched. */}
      <Card className="glass overflow-hidden p-0">
        <Legend
          hasUltimateClear={hasUltimateClear}
          onRefresh={refreshSchedule}
          refreshing={refreshing}
          /* オリジナル (元サイトから取り込み) */
          topTextScraped={result.data.topText ?? null}
          /* 編集後 (Supabase app_settings.schedule_top_text_override)。
             同期で上書きされないので、運用ルールを portal 側で
             カスタマイズしてもそのまま残る。 */
          topTextOverride={topTextOverride}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            {tableHead(true)}
            <tbody>
              {upcoming.map((s, idx) => (
                <SessionRow
                  key={s.rawDate}
                  session={s}
                  users={users}
                  holidays={holidays}
                  videoLink={lookupVideoLink(s, sessionVideoLinks)}
                  sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
                  scheduleUrl={scheduleUrl}
                  onOpenEditFrame={openEditFrame}
                  memos={memosByDate[s.rawDate] ?? EMPTY_MEMOS}
                  onRefreshMemos={refetchMemos}
                  upcomingIndex={idx}
                />
              ))}
              {upcoming.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + users.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    今後の予定はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* インライン編集ダイアログ — ユーザー名 / 出欠セルをタップすると
          ここがマウントされ、character-sheets の編集 URL を iframe で
          表示します。閉じるとスクロール位置などポータル側の状態は維持。 */}
      <ScheduleEditFrameDialog
        url={editTarget?.url ?? null}
        title={editTarget?.title ?? ""}
        targetOffsetPx={editTarget?.targetOffsetPx ?? null}
        onClose={() => setEditTarget(null)}
      />

      {/* Past sessions — separate card so the visual break is unmistakable.
          Hidden until the user enables the detail toggle. The "確定"
          column is dropped here since past sessions were all held.
          Manual snapshot trigger lives in the settings dialog now.
          2.1 (2026-04-29): 2 ヶ月以上前の行はデフォルト畳み、ボタンで
          展開できる UX に変更。直近 2 ヶ月の行は常時表示。 */}
      {showDetailedPast && renderedPast.length > 0 && (
        <Card className="glass overflow-hidden p-0">
          <header className="flex items-center justify-between gap-2 border-b border-border/40 bg-secondary/20 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              Past
              <span className="font-sans text-[11px] tracking-normal normal-case text-muted-foreground/85">
                · 詳細ログ (出欠表)
              </span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {showOlderPast || olderPast.length === 0
                ? `${renderedPast.length} 件`
                : `直近 ${recentPast.length} 件 / 全 ${renderedPast.length} 件`}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              {tableHead(false, false)}
              <tbody>
                {recentPast.map((s) => (
                  <SessionRow
                    key={s.rawDate}
                    session={s}
                    users={users}
                    isPast
                    holidays={holidays}
                    showDecided={false}
                    videoLink={lookupVideoLink(s, sessionVideoLinks)}
                    sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
                    scheduleUrl={scheduleUrl}
                    onOpenEditFrame={openEditFrame}
                    memos={memosByDate[s.rawDate] ?? EMPTY_MEMOS}
                  onRefreshMemos={refetchMemos}
                  />
                ))}
                {olderPast.length > 0 && showOlderPast &&
                  olderPast.map((s) => (
                    <SessionRow
                      key={s.rawDate}
                      session={s}
                      users={users}
                      isPast
                      holidays={holidays}
                      showDecided={false}
                      videoLink={lookupVideoLink(s, sessionVideoLinks)}
                      sessionLogsUrl={sessionLogsByDate?.[s.rawDate] ?? null}
                      scheduleUrl={scheduleUrl}
                      onOpenEditFrame={openEditFrame}
                      memos={memosByDate[s.rawDate] ?? EMPTY_MEMOS}
                  onRefreshMemos={refetchMemos}
                    />
                  ))}
                {olderPast.length > 0 && (
                  <tr>
                    <td
                      colSpan={1 + users.length}
                      className="border-t border-border/40 bg-secondary/10 px-3 py-2 text-center"
                    >
                      <button
                        ref={olderToggleBtnRef}
                        type="button"
                        onClick={onToggleOlderPast}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-background/30 px-3 py-1 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
                        aria-expanded={showOlderPast}
                      >
                        {showOlderPast ? (
                          <>
                            <ChevronUp className="h-3 w-3" aria-hidden />
                            2 ヶ月以上前を畳む
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3" aria-hidden />
                            2 ヶ月以上前を表示 ({olderPast.length} 件)
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function UserHeaderCell({
  user,
  comments,
  editUrl,
  onOpenEditFrame,
}: {
  user: ScheduleUser;
  comments: ScheduleComment[];
  editUrl: string | null;
  /** Open the in-portal iframe dialog for the given URL. */
  onOpenEditFrame: (
    url: string,
    title: string,
    targetOffsetPx?: number | null,
  ) => void;
}) {
  const hasComments = comments.length > 0;

  // Username is a clickable button that opens the in-portal iframe
  // dialog (1.9.13). Comments live in a separate small button →
  // Popover. This works on both touch (tap) and mouse (click).
  //
  // Cap the inline width at 7rem and let CSS truncate with ellipsis when a
  // name is unusually long — prevents one outlier name from blowing out
  // the whole table's layout. The full name is still in the title
  // attribute (tooltip).
  const nameClass =
    "inline-block max-w-[7rem] truncate align-bottom underline decoration-dotted decoration-[var(--neon-cyan)]/60 underline-offset-4 transition-colors hover:decoration-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]";

  const nameNode = editUrl ? (
    <button
      type="button"
      onClick={() => onOpenEditFrame(editUrl, `${user.name} の出欠を編集`)}
      className={nameClass}
      title={`${user.name} の出欠をその場で編集`}
    >
      {user.name}
    </button>
  ) : (
    <span className={nameClass} title={user.name}>
      {user.name}
    </span>
  );

  return (
    <th
      scope="col"
      // 1.9.29: px-2 → px-1.5 to bring the first member column closer
      // to the 日程 column. min-w-[5rem] still stabilizes per-column
      // width; max-w on the name (above) caps long names so they
      // ellipsize instead of pushing other columns offscreen.
      className="min-w-[5rem] px-1.5 py-2 text-center font-mono whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1">
        {nameNode}
        {hasComments && <CommentPopover user={user} comments={comments} />}
      </span>
    </th>
  );
}

/**
 * Derive the per-user edit URL from the schedule list URL.
 *   /schedule/list?key=KEY  →  /schedule/input?key=KEY&userId=USERID
 *
 * Returns null if the source URL is missing or malformed.
 *
 * History: 1.9.14 attached `?date=` query + `#date-` hash hints in an
 * attempt to auto-scroll the iframe to the target date, but
 * character-sheets doesn't honor either, so the hints were noise.
 * 1.9.15 removed them; the dialog gained a CSS-based initial scroll
 * offset (translateY) instead.
 */
function buildEditUrl(
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
 * Date cell label — plain colored span, no link. Video / Logs links
 * are rendered separately AFTER the time inside the row so both
 * icons sit at the end of the cell where the eye expects "actions".
 */
function DateLabel({
  text,
  holiday,
  decided,
  holidayName,
}: {
  text: string;
  holiday: boolean;
  decided: boolean;
  holidayName: string | null;
}) {
  const colorClass = holiday
    ? "font-bold text-rose-400 drop-shadow-[0_0_4px_color-mix(in_oklch,oklch(0.65_0.22_25)_40%,transparent)]"
    : decided
      ? "font-bold text-[var(--neon-cyan)] drop-shadow-[0_0_4px_color-mix(in_oklch,var(--neon-cyan)_40%,transparent)]"
      : "";
  return (
    <span className={colorClass} title={holidayName ?? undefined}>
      {text}
    </span>
  );
}

/**
 * Look up a session's matching video. Map is rawDate-keyed (built
 * server-side using the 36h window heuristic) so the lookup is just
 * a key access here — no timezone math needed.
 */
function lookupVideoLink(
  session: ScheduleSession,
  links: Record<string, SessionVideoLink> | undefined,
): SessionVideoLink | null {
  if (!links) return null;
  return links[session.rawDate] ?? null;
}

function SessionRow({
  session,
  users,
  isPast = false,
  holidays,
  showDecided = true,
  videoLink = null,
  sessionLogsUrl = null,
  scheduleUrl,
  onOpenEditFrame,
  memos,
  onRefreshMemos,
  upcomingIndex,
}: {
  session: ScheduleSession;
  users: ScheduleUser[];
  isPast?: boolean;
  holidays?: JapaneseHolidaysMap;
  /** When false, drop the 確定 column entirely (past table). */
  showDecided?: boolean;
  /** When non-null, the date label becomes a Link to that video. */
  videoLink?: SessionVideoLink | null;
  /**
   * FFLogs URL stored on the past-session row. Used as the Logs icon
   * source when no matching video exists for this date (a session
   * happened, was logged on FFLogs, but nobody uploaded a video).
   */
  sessionLogsUrl?: string | null;
  /**
   * Source schedule URL — used to derive each user's character-sheets
   * input page so attendance cells can become "click here to edit"
   * targets.
   */
  scheduleUrl?: string | null;
  /** Open the in-portal iframe dialog for the given URL. */
  onOpenEditFrame: (
    url: string,
    title: string,
    targetOffsetPx?: number | null,
  ) => void;
  /** 親が `useRealtimeAllScheduleMemos` で集約した live slice (TODO #11 phase 7)。 */
  memos: import("@/lib/schedule-memos-client").ScheduleSessionMemo[];
  /** Server-action 後の保険 refetch (旧 useRealtimeScheduleMemos の refetch 互換)。 */
  onRefreshMemos: () => Promise<void>;
  /**
   * TODO #44: 0-based index of this session within the upcoming list.
   * When defined (= upcoming row), attendance-cell clicks pass a
   * heuristic offset so the iframe lands near this date's input row.
   * `undefined` for past rows where the per-date jump isn't useful.
   */
  upcomingIndex?: number;
}) {
  const decided = session.status === "DECISION";
  // Ref so the (separately-rendered) memo dot can open the popover.
  const popoverRef = useRef<SessionMemoPopoverHandle>(null);
  // Japanese national holidays get a red date label — overrides the
  // default and DECISION-cyan styling. Doesn't change the row background
  // so the past/decided treatment still composes underneath.
  const holiday = isJapaneseHoliday(session.date, holidays);
  const holidayName = holiday
    ? getJapaneseHolidayName(session.date, holidays)
    : null;
  return (
    <tr
      className={
        "border-b border-border/30 transition-colors last:border-b-0 " +
        (isPast
          ? "" // past rows render at full opacity with no hover effect — once the past view is open, dimming-then-revealing on hover is just visual noise
          : decided
            ? "bg-[var(--neon-cyan)]/4 hover:bg-[var(--neon-cyan)]/8"
            : "hover:bg-secondary/40")
      }
    >
      <th
        scope="row"
        // 1.9.29: tighten 日程 column right-padding (pr-2 → pr-1) and
        // internal gap (gap-1.5 → gap-1). Cell auto-sizes to widest
        // row content; with both tables sharing identical icon slot
        // reservations the auto-size is consistent across them, so
        // the explicit `min-w-[15rem]` is no longer needed.
        className="pl-3 pr-1 py-2 align-middle font-mono text-[12px] tabular-nums whitespace-nowrap text-foreground"
      >
        <div className="flex items-center gap-1">
          {/* Date label color priority:
                1. Holiday → red glow
                2. DECISION → cyan glow + bold
                3. default → foreground
              Wrapped in a memo popover so any user can leave shared
              notes for this session by clicking the date. */}
          <SessionMemoPopover
            ref={popoverRef}
            rawDate={session.rawDate}
            displayDate={session.rawDate.split(" ")[0] ?? session.rawDate}
            memos={memos}
            onRefresh={onRefreshMemos}
            currentLogsUrl={videoLink?.logsUrl ?? sessionLogsUrl ?? null}
            sessionDetails={{
              parsedDate: session.date.toISOString(),
              startTime: session.startTime,
              endTime: session.endTime,
              dayOfWeek: session.dayOfWeek,
            }}
          >
            <DateLabel
              text={session.rawDate.split(" ")[0]!}
              holiday={holiday}
              decided={decided}
              holidayName={holidayName}
            />
          </SessionMemoPopover>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/85">
            {session.startTime}
            <span className="mx-0.5 opacity-60">~</span>
            {session.endTime}
          </span>
          {/* Memo indicator placed right after the time per user
              request — visible whether or not video/Logs links are
              also rendered for this row. `reserveSpace` keeps an
              invisible placeholder so memo / video / Logs icons sit
              at the same horizontal position across all rows
              (1.9.27). */}
          <SessionMemoDot
            count={memos.length}
            reserveSpace
            onClick={() => popoverRef.current?.open()}
          />
          {/* Action icons — Film slot (left) | BarChart3 slot (right).
              1.9.27: ALWAYS reserve both slots in the detail table so
              icons share vertical column alignment across all rows.
              When a slot has no content, render an invisible h-5 w-5
              placeholder. */}
          {(() => {
            const logsUrl = safeHref(videoLink?.logsUrl ?? sessionLogsUrl);
            // 過去日程の Film アイコンは Logs と同じく直接外部リンクへ
            // (新規タブ、URL は category_links.url)。upcoming は引き続き
            // ポータル内の動画ページへリンクする (動画は通常まだ無いが、
            // 当日分が早めに上がっていたケースで動画一覧に飛びたい)。
            const externalVideoUrl = isPast
              ? safeHref(videoLink?.url)
              : null;
            const filmSlot = videoLink ? (
              externalVideoUrl ? (
                <a
                  href={externalVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を新規タブで開く`}
                  title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」 (外部リンク)`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)]"
                >
                  <Film className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                // 2.1 (2026-04-30): `<Link>` (default prefetch) で soft-nav
                // 復活。viewport 入りで RSC payload が先読みされクリックは
                // 即時遷移。デプロイ後 chunk hash mismatch の silent fail は
                // ChunkErrorHandler (portal layout 常駐) が ChunkLoadError を
                // catch して自動 reload するので保険済 (旧コミット: hard nav
                // 化 fab1d59 / hover prefetch 389b8f8 を撤回)。
                <Link
                  href={videoLink.href}
                  aria-label={`${videoLink.categoryName}/動画「${videoLink.videoTitle}」を開く`}
                  title={`${videoLink.categoryName}/動画 → 「${videoLink.videoTitle}」`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--neon-cyan)]/85 transition-all hover:bg-[var(--neon-cyan)]/15 hover:text-[var(--neon-cyan)] hover:shadow-[0_0_10px_-2px_var(--neon-cyan)]"
                >
                  <Film className="h-3 w-3" aria-hidden />
                </Link>
              )
            ) : (
              <span aria-hidden className="inline-block h-5 w-5 shrink-0" />
            );
            const logsSlot = logsUrl ? (
              <a
                href={logsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${session.rawDate.split(" ")[0]} の FFLogs を開く`}
                title="FFLogs"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-300/85 transition-all hover:bg-amber-400/15 hover:text-amber-200 hover:shadow-[0_0_10px_-2px_rgba(251,191,36,0.6)]"
              >
                <BarChart3 className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span aria-hidden className="inline-block h-5 w-5 shrink-0" />
            );
            return (
              <>
                {filmSlot}
                {logsSlot}
              </>
            );
          })()}
        </div>
      </th>
      {showDecided && (
        <td className="px-1 py-2 text-center align-middle">
          {(() => {
            // TODO #44 (2.1, 2026-04-29 v2): clicking the 確定 cell
            // (either the green badge or the · placeholder) opens the
            // schedule list URL in the iframe dialog, clipped so the
            // matching date row sits near the top. Uses the same
            // translateY heuristic as the per-user edit dialog because
            // cross-origin iframes can't be scripted.
            //   offset = MID_BASE + (upcomingIndex - 1) * ROW_HEIGHT
            // MID_BASE = 280 matches the legacy "mid" landing zone (=
            // skips character-sheets header). ROW_HEIGHT = 36 is the
            // observed row pitch in the list view; tune if upstream
            // layout drifts.
            const targetOffset =
              typeof upcomingIndex === "number"
                ? Math.max(0, 280 + (upcomingIndex - 1) * 36)
                : null;
            const dateLabel =
              session.rawDate.split(" ")[0] ?? session.rawDate;
            const safeScheduleUrl = scheduleUrl ?? null;
            const openTarget = () => {
              if (!safeScheduleUrl) return;
              onOpenEditFrame(
                safeScheduleUrl,
                `スケジュール (${dateLabel} の行へ移動)`,
                targetOffset,
              );
            };
            const sharedClass =
              "inline-flex h-6 items-center justify-center rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60";

            if (decided) {
              const badge = (
                <span
                  aria-label="日程確定"
                  title={
                    safeScheduleUrl
                      ? `日程確定 — クリックで ${dateLabel} の行までスクロール`
                      : "日程確定"
                  }
                  className="inline-flex h-6 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-400/15 px-2 font-mono text-[10px] font-bold tracking-[0.16em] text-emerald-300 uppercase shadow-[0_0_12px_-3px_rgb(52_211_153)]"
                >
                  確定
                </span>
              );
              return safeScheduleUrl ? (
                <button
                  type="button"
                  onClick={openTarget}
                  className={`${sharedClass} hover:scale-105`}
                  aria-label={`スケジュール元サイトの ${dateLabel} の行を開く`}
                >
                  {badge}
                </button>
              ) : (
                badge
              );
            }
            // 未確定 (·): クリックで同じく該当日にスクロール
            return safeScheduleUrl ? (
              <button
                type="button"
                onClick={openTarget}
                title={`未確定 — クリックで ${dateLabel} の行までスクロール`}
                aria-label={`スケジュール元サイトの ${dateLabel} の行を開く`}
                className={`${sharedClass} px-2 text-muted-foreground/40 hover:bg-secondary/40 hover:text-foreground/80`}
              >
                ·
              </button>
            ) : (
              <span
                aria-hidden
                title="未確定"
                className="inline-flex h-6 items-center justify-center text-muted-foreground/40"
              >
                ·
              </span>
            );
          })()}
        </td>
      )}
      {users.map((u) => {
        const att = session.attendances[u.userId] ?? "－";
        const editUrl = buildEditUrl(scheduleUrl, u.userId);
        const dateLabel = session.rawDate.split(" ")[0] ?? session.rawDate;
        const symbol = (
          <span
            // Drop `font-mono` for the symbols — ◯ ⏰ △ × － are CJK
            // full-width / emoji glyphs that fall back to system fonts
            // when JetBrains Mono lacks them. The fallback's vertical
            // metrics differ slightly per glyph (especially ⏰ which
            // sits taller in the line-box), causing perceived
            // misalignment. Using the default sans + `leading-none`
            // forces every cell to render the glyph at the same
            // baseline within a fixed h-5 box.
            className={
              "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-sm border px-1 text-[12px] leading-none transition-transform " +
              ATT_TONE[att]
            }
            aria-label={`${u.name}: ${att}`}
          >
            {att}
          </span>
        );
        // 過去日程の出欠セルは button にしない (ユーザー要望 2026-04-29 v2):
        // 過去の `－` 等を誤クリックすると character-sheets の編集 iframe
        // が開いて遷移してしまうため、past 行は記録としての表示のみに固定。
        // 編集 (= upcoming 全日程の入力) はユーザー名ヘッダーと upcoming
        // 行の出欠セルから引き続きアクセス可能。
        const clickable = Boolean(editUrl) && !isPast;
        return (
          <td key={u.userId} className="px-1.5 py-2 align-middle text-center">
            {clickable && editUrl ? (
              // ボタン化 (1.9.13): その場でインライン iframe ダイアログを
              // 開いて出欠を編集。タブ移動なしで戻れる。hover の scale +
              // focus ring で「タップ可能」のフィードバックを残す。
              // 2.1+ (TODO #44 v2): upcoming 行は per-date offset を渡し、
              // 該当日の入力行近くで iframe が開くようにする。
              <button
                type="button"
                onClick={() =>
                  onOpenEditFrame(
                    editUrl,
                    `${u.name} の出欠を編集 (${dateLabel} を含む)`,
                    typeof upcomingIndex === "number"
                      ? Math.max(0, 280 + (upcomingIndex - 1) * 36)
                      : null,
                  )
                }
                title={`${u.name} の出欠をその場で編集 (${dateLabel} を含む全日程)`}
                className="group/cell inline-flex rounded-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]/60"
              >
                {symbol}
              </button>
            ) : (
              symbol
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Legend({
  hasUltimateClear = false,
  onRefresh,
  refreshing = false,
  topTextScraped = null,
  topTextOverride = null,
}: {
  hasUltimateClear?: boolean;
  /** Called when the user clicks the refresh button at the right end. */
  onRefresh?: () => void;
  /** Show a spinning loader while the refresh transition is pending. */
  refreshing?: boolean;
  /** 元サイトから取り込んだオリジナル運用ルール / 注意事項。同期のたびに
   * 最新のものに更新される。 */
  topTextScraped?: string | null;
  /** Portal 側で編集された override (`app_settings.schedule_top_text_override`)。
   * 同期では上書きされない。トグルボタンで scraped 表示と切り替え可能。 */
  topTextOverride?: string | null;
}) {
  const router = useRouter();
  // Local controlled-popover state for the top-text comment icon.
  const [showTopText, setShowTopText] = useState(false);
  const topTextRef = useRef<HTMLDivElement | null>(null);

  // 楽観的 override 状態: save / clear 直後に prop が更新されるまでの
  // 間 UI を即時反映するためのローカル shadow state。
  //   undefined: prop の `topTextOverride` をそのまま使う (通常時)
  //   null: 「クリア中」を即時反映 (= scraped 表示に戻す)
  //   string: 「保存中」のテキストを即時反映 (= 編集後タブで表示)
  // prop が「楽観値と一致」した時にのみ undefined に戻して prop に追従。
  // prop が予期せず別値 (特に null) で来た場合は optimistic を保持し続ける
  // ので、強制更新やネットワーク不安定時に編集後テキストが消えない。
  const [optimisticOverride, setOptimisticOverride] = useState<
    string | null | undefined
  >(undefined);
  const effectiveOverride =
    optimisticOverride !== undefined ? optimisticOverride : topTextOverride;
  useEffect(() => {
    setOptimisticOverride((curr) => {
      // 既に通常状態 (= optimistic 不在) なら何もしない
      if (curr === undefined) return undefined;
      // server (DB) 側の値が optimistic と一致 → save/clear が確実に
      // 反映されたと判断できるので、楽観 state を畳んで prop に切替。
      if (curr === topTextOverride) return undefined;
      // 不一致 (例: prop が null で帰ってきた、別タブで別の値が保存された)
      // → 楽観 state を保持してユーザーの編集を画面から消さない。
      return curr;
    });
  }, [topTextOverride]);

  // 表示モード: 編集後 (override) があれば default で edited、無ければ scraped。
  // ユーザーがトグル切替したらその選択を尊重するが、override の null/non-null
  // 遷移 (= 新規保存 / 完全クリア) では view を自動追従させる。
  const [view, setView] = useState<"edited" | "scraped">(
    effectiveOverride !== null ? "edited" : "scraped",
  );
  // override の存在状態の遷移を監視: null → non-null で edited、
  // non-null → null で scraped にフリップ。同値での更新 (例: 同期で
  // 同じ override が再取得された場合) は view を変えない (ユーザー選択
  // を維持)。
  const prevHasOverrideRef = useRef<boolean>(effectiveOverride !== null);
  useEffect(() => {
    const has = effectiveOverride !== null;
    if (prevHasOverrideRef.current !== has) {
      setView(has ? "edited" : "scraped");
    }
    prevHasOverrideRef.current = has;
  }, [effectiveOverride]);

  // 編集モード: textarea + save / cancel
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // 表示する text と「rule アイコンを出すか」判定。
  // どちらか一方でも値があればアイコンは出す。
  const hasAny = topTextScraped !== null || effectiveOverride !== null;
  const displayed = view === "edited" ? effectiveOverride : topTextScraped;

  // Click outside to close the popover. 編集中はクリック保護 (誤閉じ防止)
  useEffect(() => {
    if (!showTopText) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (topTextRef.current && topTextRef.current.contains(t)) return;
      if (editing) return; // 編集中は閉じない
      setShowTopText(false);
    };
    const handle = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [showTopText, editing]);
  // 1.9.16: ラベル "MEMBERS" デフォルト、絶クリア達成済みの固定なら
  // "LEGENDS" 表記に昇格 (称号として)。
  const label = hasUltimateClear ? "Legends" : "Members";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/40 bg-secondary/15 px-3 py-2 text-[11px]">
      <span
        className={
          "font-mono text-[10px] tracking-[0.22em] uppercase " +
          (hasUltimateClear
            ? "text-amber-300"
            : "text-muted-foreground")
        }
        title={
          hasUltimateClear
            ? "絶コンテンツをクリアした「Legends」称号で表示中"
            : "通常のメンバー表示 (絶クリアでLegends称号に切替)"
        }
      >
        {label}
      </span>
      {ATT_LEGEND.map((l) => (
        <span key={l.symbol} className="inline-flex items-center gap-1.5">
          <span
            className={
              "inline-flex h-4 w-5 items-center justify-center rounded-sm border text-[11px] leading-none " +
              ATT_TONE[l.symbol]
            }
          >
            {l.symbol}
          </span>
          <span className="text-[11px] text-muted-foreground">{l.label}</span>
        </span>
      ))}
      {/* 1.9.37: ルール / 更新ボタンを右端 1 グループにまとめる。
          ml-auto を group コンテナに付けて全体を右寄せ。ルール
          ボタンの popover は right-0 で button right-edge 揃えに
          開くので、画面右端からの overflow を防げる。 */}
      <div className="ml-auto flex items-center gap-1.5">
        {hasAny && (
          <span className="relative inline-flex">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowTopText((v) => !v);
              }}
              aria-label="運用ルール / 注意事項を表示"
              title="運用ルール / 注意事項"
              aria-expanded={showTopText}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--neon-violet)]/40 bg-[var(--neon-violet)]/8 px-2 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-violet)]/90 uppercase transition-all hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/15 hover:shadow-[0_0_8px_-2px_rgba(167,139,250,0.55)]"
            >
              <MessageSquare className="h-3 w-3" aria-hidden />
              ルール
              {effectiveOverride !== null && (
                <span
                  className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--neon-cyan)]"
                  title="編集済み (override 設定中)"
                  aria-hidden
                />
              )}
            </button>
            {showTopText && (
              <div
                ref={topTextRef}
                role="dialog"
                aria-label="運用ルール / 注意事項"
                className="glass-popup absolute top-full right-0 z-40 mt-1 w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-[var(--neon-violet)]/35 px-3.5 py-3 text-[12px] leading-relaxed text-foreground/85 shadow-[0_12px_40px_-16px_rgba(167,139,250,0.45),0_2px_8px_-2px_rgba(0,0,0,0.4)]"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] tracking-[0.22em] text-[var(--neon-violet)]/85 uppercase">
                    運用ルール / 注意事項
                  </p>
                  {!editing && (
                    <div className="flex items-center gap-1">
                      {/* オリジナル ⇔ 編集後 切替 (両方 null でない時のみ表示) */}
                      {topTextScraped !== null && effectiveOverride !== null && (
                        <div
                          role="tablist"
                          aria-label="表示するテキストを切替"
                          className="inline-flex overflow-hidden rounded-md border border-border/50"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={view === "scraped"}
                            onClick={() => setView("scraped")}
                            title="元サイトから取り込んだ最新のテキスト"
                            className={
                              "px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase transition-colors " +
                              (view === "scraped"
                                ? "bg-[var(--neon-violet)]/25 text-foreground"
                                : "text-muted-foreground hover:bg-secondary/50")
                            }
                          >
                            オリジナル
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={view === "edited"}
                            onClick={() => setView("edited")}
                            title="ポータル側で編集したカスタム版 (同期で上書きされない)"
                            className={
                              "inline-flex items-center gap-0.5 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase transition-colors " +
                              (view === "edited"
                                ? "bg-[var(--neon-cyan)]/25 text-foreground"
                                : "text-muted-foreground hover:bg-secondary/50")
                            }
                          >
                            <span className="text-[var(--neon-cyan)]">★</span>
                            編集後
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // 編集 = override の編集。下敷きは現在表示中のテキスト
                          setDraft(displayed ?? "");
                          setEditing(true);
                        }}
                        aria-label="運用ルール / 注意事項を編集 (override に保存)"
                        title="override として編集 (元サイトには影響しない、同期でも上書きされない)"
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--neon-violet)]/40 bg-[var(--neon-violet)]/10 px-2 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-violet)]/90 uppercase transition-colors hover:border-[var(--neon-violet)]/70 hover:bg-[var(--neon-violet)]/20"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                        編集
                      </button>
                      {/* override クリア (scraped 表示に戻す) */}
                      {effectiveOverride !== null && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "編集後の override を削除して、元サイトのテキスト表示に戻しますか?",
                              )
                            ) {
                              return;
                            }
                            // 楽観的に「クリア済」を即時反映 → 失敗時 revert
                            setOptimisticOverride(null);
                            setView("scraped");
                            const r = await clearScheduleTopTextOverride();
                            if (!r.ok) {
                              setOptimisticOverride(undefined);
                              toast.error("削除失敗: " + r.reason);
                              return;
                            }
                            toast.success(
                              "override を削除し、元サイトの表示に戻しました",
                            );
                            router.refresh();
                          }}
                          aria-label="override を削除して元サイトの表示に戻す"
                          title="override を削除"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-300/40 text-rose-300 transition-colors hover:bg-rose-500/15 hover:text-rose-200"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(
                        Math.max(draft.split("\n").length, 4),
                        14,
                      )}
                      className="w-full rounded-md border border-input bg-background/30 p-2 font-sans text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--neon-cyan)]/40"
                      spellCheck={false}
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setDraft("");
                        }}
                        disabled={saving}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:bg-secondary/40 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" aria-hidden />
                        キャンセル
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          // 編集中の draft を即時 UI に反映 (optimistic) し、
                          // 編集モードを抜けて表示を「編集後」タブに切替。
                          // refresh で prop が追いついたら useEffect が
                          // optimistic を破棄して prop に従う。
                          const text = draft;
                          setOptimisticOverride(text);
                          setView("edited");
                          setEditing(false);
                          setDraft("");
                          setSaving(true);
                          const r = await setScheduleTopTextOverride(text);
                          setSaving(false);
                          if (!r.ok) {
                            // 失敗 → optimistic を破棄して prop 表示に戻す
                            setOptimisticOverride(undefined);
                            toast.error("保存失敗: " + r.reason);
                            return;
                          }
                          toast.success("override を保存しました");
                          router.refresh();
                        }}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--neon-cyan)]/50 bg-[var(--neon-cyan)]/15 px-2 font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)] uppercase transition-colors hover:bg-[var(--neon-cyan)]/25 disabled:opacity-50"
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden />
                        )}
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed">
                    {displayed ?? "（テキストなし）"}
                  </pre>
                )}
              </div>
            )}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="スケジュールを最新の状態に更新"
            title="スケジュールを最新の状態に更新"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background/30 text-muted-foreground transition-all hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/8 hover:text-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function groupCommentsByAuthor(
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
 * Split sessions into upcoming (future + ≤6h-past) and past (everything older),
 * each pre-sorted. Limit is applied to upcoming only — past list is always
 * sorted newest-first so the most relevant past dates appear right after the
 * "Past" divider.
 */
function splitSessions(
  sessions: ScheduleSession[],
  limit?: number,
): { upcoming: ScheduleSession[]; past: ScheduleSession[] } {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
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
