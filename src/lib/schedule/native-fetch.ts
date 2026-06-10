import "server-only";

import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { createClient } from "@/lib/supabase/server";
import {
  FALLBACK_DEFAULT_END_TIME,
  FALLBACK_DEFAULT_START_TIME,
} from "@/lib/server/native-schedule-placeholders";

import type {
  Attendance,
  ParsedSchedule,
  ScheduleSession,
  ScheduleUser,
  SessionStatus,
} from "./parse";
import type { ScheduleFetchResult } from "./next-session";

/**
 * Native (自前) スケジュールの fetcher (TODO #2 phase 2-A 本実装)。
 *
 * `native_schedule_*` テーブルから ScheduleFetchResult 互換の shape を
 * 組み立てて返す。schedule-list.tsx は sync mode と同じ型を受け取れば
 * 描画できるため、UI 側の分岐は最小化される。
 *
 * - `users`        ← native_schedule_members (is_active=true, sort_order ASC)
 * - `sessions`     ← native_schedule_sessions (status != CANCELLED, parsed_date DESC)
 * - `attendances`  ← native_schedule_attendances (session_id IN matrix)
 * - `choices`      ← app_settings.native_schedule_choice_values (CSV) / 既定値
 * - `comments`     ← []  (Phase 2-B で attendance.comment を表示する別経路)
 * - `topText`      ← null (Phase 3 で Discord 通知文等を表示する余地)
 *
 * いずれかの SELECT 失敗時は `{ ok: false, reason: "fetch-failed" }` を返却。
 * `page.tsx` 側で sync 経路と同じ error UI に流れる。
 */

const NATIVE_CHOICE_VALUES_KEY = "native_schedule_choice_values";

/** 凡例マスター未設定時のフォールバック (sync mode の固定 5 種と同じ並び)。 */
const DEFAULT_CHOICES: readonly string[] = ["○", "×", "△", "⏰", "－"];

type NativeMemberRow = {
  discord_user_id: string;
  display_name: string;
  // 2.1 (2026-05-12) PR3-D: メンバー全体コメント (本人 only 編集)。
  comment: string | null;
};

type NativeSessionRow = {
  id: string;
  raw_date: string;
  parsed_date: string;
  // 2.1 (2026-05-12): NULL 許可化。NULL = default 追従、NOT NULL = 日個別 override。
  start_time: string | null;
  end_time: string | null;
  day_of_week: string;
  status: "CANDIDATE" | "DECISION" | "CANCELLED";
  // 2.8 (2026-06-10) TODO #81 follow-up: placeholder 判定 (created_by_id IS NULL = auto)
  // と note 編集 popover の初期値に使う 2 列を SELECT に追加。
  created_by_id: string | null;
  note: string | null;
};

type NativeAttendanceRow = {
  session_id: string;
  discord_user_id: string;
  symbol: string;
  // TODO #2 phase 2-B: popover の textarea 初期値復元 (commentsByPair) に使う。
  comment: string | null;
};

export type FetchNativeScheduleDefaults = {
  startTime?: string | null;
  endTime?: string | null;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export async function fetchNativeSchedule(
  defaults?: FetchNativeScheduleDefaults,
): Promise<ScheduleFetchResult> {
  // 2.1 (2026-05-12): start_time / end_time が NULL の row は default 時刻を
  // 表示用に COALESCE する。default は page.tsx 側で app_settings 経由で取得
  // して引数注入 (placeholder の `ensureNativeMonthlyPlaceholders` と同じ
  // pattern)。不正値や未指定は fallback。
  const defaultStartTime =
    defaults?.startTime && TIME_RE.test(defaults.startTime)
      ? defaults.startTime
      : FALLBACK_DEFAULT_START_TIME;
  const defaultEndTime =
    defaults?.endTime && TIME_RE.test(defaults.endTime)
      ? defaults.endTime
      : FALLBACK_DEFAULT_END_TIME;

  const supabase = await createClient();

  const [membersRes, sessionsRes, choiceCsv] = await Promise.all([
    supabase
      .from("native_schedule_members")
      .select("discord_user_id, display_name, comment")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("native_schedule_sessions")
      .select(
        // 2.8 (2026-06-10): created_by_id / note を追加 (auto 生成判定 + note 編集 popover の初期値)。
        "id, raw_date, parsed_date, start_time, end_time, day_of_week, status, created_by_id, note",
      )
      .neq("status", "CANCELLED")
      .order("parsed_date", { ascending: false }),
    fetchAppSetting(NATIVE_CHOICE_VALUES_KEY),
  ]);

  if (membersRes.error) {
    console.warn("[native-schedule] members fetch error:", membersRes.error);
    return { ok: false, reason: "fetch-failed" };
  }
  if (sessionsRes.error) {
    console.warn("[native-schedule] sessions fetch error:", sessionsRes.error);
    return { ok: false, reason: "fetch-failed" };
  }

  const members = (membersRes.data ?? []) as NativeMemberRow[];
  const sessionRows = (sessionsRes.data ?? []) as NativeSessionRow[];

  const users: ScheduleUser[] = members.map((m) => ({
    userId: m.discord_user_id,
    name: m.display_name,
    comment: m.comment,
  }));

  // attendances を session_id IN(...) で一括 fetch → session_id ごとに matrix 構築。
  // TODO #2 phase 2-B: comment 列も fetch して `commentsByPair` に蓄積、
  // popover の textarea 初期値復元に使う。
  const attendancesBySession = new Map<string, Record<string, Attendance>>();
  const commentsByPair: Record<string, string> = {};
  if (sessionRows.length > 0) {
    const sessionIds = sessionRows.map((s) => s.id);
    const { data: attData, error: attErr } = await supabase
      .from("native_schedule_attendances")
      .select("session_id, discord_user_id, symbol, comment")
      .in("session_id", sessionIds);
    if (attErr) {
      console.warn("[native-schedule] attendances fetch error:", attErr);
      return { ok: false, reason: "fetch-failed" };
    }
    for (const row of (attData ?? []) as NativeAttendanceRow[]) {
      const map = attendancesBySession.get(row.session_id) ?? {};
      map[row.discord_user_id] = row.symbol;
      attendancesBySession.set(row.session_id, map);
      // 空文字列は entry を持たない (popover 側 `?? ""` で fallback)。
      if (row.comment && row.comment.trim()) {
        commentsByPair[`${row.session_id}__${row.discord_user_id}`] = row.comment;
      }
    }
  }

  const sessions: ScheduleSession[] = sessionRows.map((s) => ({
    rawDate: s.raw_date,
    date: new Date(s.parsed_date),
    dayOfWeek: s.day_of_week,
    // 2.1 (2026-05-12): start_time / end_time が NULL の row は default 時刻に
    // 追従させる。session-time-edit-popover で日個別 override を入れた場合は
    // NOT NULL がそのまま表示される。
    startTime: s.start_time ?? defaultStartTime,
    endTime: s.end_time ?? defaultEndTime,
    // CANCELLED は SELECT で除外済 (filter neq) なので CANDIDATE | DECISION
    // のみが残る。SessionStatus 型に narrow するため as でキャスト。
    status: s.status as SessionStatus,
    attendances: attendancesBySession.get(s.id) ?? {},
    // native では character-sheets `<tr id="row_N">` 概念がないため null。
    // schedule-list の iframe edit jump 経路は sync 専用なので影響なし。
    rowIndex: null,
  }));

  const choices = parseChoiceValues(choiceCsv);

  // TODO #2 phase 2-B: native UI (popover / status toggle) に DB id を渡すための
  // map。`ScheduleSession.rowIndex` は character-sheets 由来で native では常に
  // null のため、別 channel として `nativeMeta` に同梱する。
  const sessionIdByRawDate: Record<string, string> = {};
  // 2.1 (2026-05-12): session-time-edit-popover が「override 有無 + default 表示」
  // を出すため、表示用 COALESCE 後の値ではなく生の DB 値 (NULL 含む) を別マップで保持。
  const timeOverridesByRawDate: Record<
    string,
    { start: string | null; end: string | null }
  > = {};
  // 2.8 (2026-06-10) TODO #81 follow-up:
  // - autoGeneratedByRawDate: created_by_id IS NULL = placeholder (auto-insert)、
  //   NOT NULL = admin が CandidateDateDialog から手動追加。chip 表示判定に使う。
  // - noteByRawDate: session-time-edit-popover の Textarea 初期値 / 空判定に使う。
  const autoGeneratedByRawDate: Record<string, boolean> = {};
  const noteByRawDate: Record<string, string | null> = {};
  for (const s of sessionRows) {
    sessionIdByRawDate[s.raw_date] = s.id;
    timeOverridesByRawDate[s.raw_date] = {
      start: s.start_time,
      end: s.end_time,
    };
    autoGeneratedByRawDate[s.raw_date] = s.created_by_id === null;
    noteByRawDate[s.raw_date] = s.note;
  }

  const data: ParsedSchedule = {
    users,
    sessions,
    comments: [],
    topText: null,
    attendanceOptions: {
      choices: choices.values,
      source: choices.source,
    },
    nativeMeta: {
      sessionIdByRawDate,
      commentsByPair,
      timeOverridesByRawDate,
      defaultStartTime,
      defaultEndTime,
      autoGeneratedByRawDate,
      noteByRawDate,
    },
  };

  return { ok: true, data };
}

function parseChoiceValues(csv: string | null): {
  values: string[];
  source: "edit-page" | "fallback-from-list";
} {
  if (csv) {
    const items = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length > 0) {
      return { values: items, source: "edit-page" };
    }
  }
  return { values: [...DEFAULT_CHOICES], source: "fallback-from-list" };
}
