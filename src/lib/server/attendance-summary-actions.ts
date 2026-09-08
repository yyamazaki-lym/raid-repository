"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { jstYmdString } from "@/lib/jst-date";
import {
  summarizeAttendanceHistory,
  type AttendanceHistory,
  type HistorySessionInput,
} from "@/lib/schedule/attendance-history";

/**
 * 出席サマリー (W-19、2026-09-08) の読み出し。
 *
 * ## 可視範囲 (調査ノート 6-2)
 *
 * - **幹部 (admin)**: 全員の集計とズレ一覧
 * - **本人 (非 admin)**: 自分の行と、自分に関するズレだけ
 *
 * 公開ランキングと連続記録は作らない (`attendance-history.ts` の docstring)。
 * 絞り込みは **server 側で行う** — client に全員分を送って隠すのでは、
 * ネットワークを見れば読めてしまう。
 *
 * ## なぜ service role か
 *
 * `fflogs_attendance_actuals` は RLS 有効 + policy 0 本 (schema.sql 6b-9 /
 * 7 章) で、anon / authenticated からは 1 行も読めない。可視範囲の適用を
 * この関数に集約するための設計なので、読み出しは service role で行う。
 *
 * ## 日付の突き合わせ
 *
 * ⚠ `fflogs_fights.session_date` は**書式が混在する** — 日程ログ由来の
 * `2026/09/09(水) 21:00~23:00` と、レポート開始時刻由来の `2026-09-09` の
 * 両方が入る (`collectReportRefs` / `syncFflogsFights` を参照)。そのため
 * この関数は session_date を突き合わせに**使わない**。レポートの
 * `start_ms` から JST 暦日を計算し、`report_code` 経由で出席行と結ぶ。
 */

/** 集計する期間 (日)。直近 3 か月。 */
const WINDOW_DAYS = 90;
/** ズレ一覧の表示上限 (多すぎると読まれない)。 */
const MISMATCH_LIMIT = 40;

export type AttendanceSummaryResult =
  | {
      ok: true;
      /** 本人だけの表示か (非 admin)。 */
      selfOnly: boolean;
      history: AttendanceHistory;
      /** 集計対象の期間 (日)。 */
      windowDays: number;
    }
  | { ok: false; reason: string };

export async function fetchAttendanceSummaryAction(): Promise<AttendanceSummaryResult> {
  const user = await requireDiscordMember();
  const isAdmin = userIsAdmin(user.roles);
  const selfOnly = !isAdmin;

  try {
    const db = createSupabaseServiceRoleClient();
    const cutoffMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const [sessionsRes, membersRes, fightsRes] = await Promise.all([
      db
        .from("native_schedule_sessions")
        .select("id, raw_date, parsed_date, status, is_optional")
        .gte("parsed_date", cutoffIso)
        .lte("parsed_date", new Date().toISOString())
        .order("parsed_date", { ascending: false }),
      db
        .from("native_schedule_members")
        .select("discord_user_id, display_name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      // 期間内の pull。report_code → JST 暦日 と、日ごとの pull 数に使う。
      db
        .from("fflogs_fights")
        .select("report_code, start_ms")
        .gte("start_ms", cutoffMs),
    ]);

    // ⚠ **読み取りの失敗を「不在」として扱わない。** PostgREST は失敗を
    // 例外ではなく `{ error }` で返すため、素通しすると出席の行が 0 件に
    // なり、**参加可と答えた全員が「不在」に化ける** (schema 未適用の
    // デプロイで実際に踏んだ)。1 本でも落ちたらエラーとして返す。
    const firstError =
      sessionsRes.error ?? membersRes.error ?? fightsRes.error;
    if (firstError) {
      console.warn("[attendance-summary] read failed:", firstError.message);
      return { ok: false, reason: "出席サマリーの取得に失敗しました" };
    }

    const sessionRows = (sessionsRes.data ?? []) as Array<{
      id: string;
      raw_date: string;
      parsed_date: string;
      status: "CANDIDATE" | "DECISION" | "CANCELLED";
      is_optional?: boolean;
    }>;
    const memberRows = (membersRes.data ?? []) as Array<{
      discord_user_id: string;
      display_name: string;
    }>;
    if (sessionRows.length === 0 || memberRows.length === 0) {
      return {
        ok: true,
        selfOnly,
        windowDays: WINDOW_DAYS,
        history: {
          rows: [],
          mismatches: [],
          sessions: 0,
          noLog: sessionRows.length,
          unmatched: 0,
          excluded: 0,
        },
      };
    }

    // レポート → JST 暦日 / 暦日 → pull 数。
    const dayOfReport = new Map<string, string>();
    const pullsPerDay = new Map<string, number>();
    for (const f of (fightsRes.data ?? []) as Array<{
      report_code: string;
      start_ms: number;
    }>) {
      const day = jstYmdString(new Date(Number(f.start_ms)));
      dayOfReport.set(f.report_code, day);
      pullsPerDay.set(day, (pullsPerDay.get(day) ?? 0) + 1);
    }

    const codes = [...dayOfReport.keys()];
    const [attendancesRes, actualsRes] = await Promise.all([
      db
        .from("native_schedule_attendances")
        .select("session_id, discord_user_id, symbol")
        .in(
          "session_id",
          sessionRows.map((s) => s.id),
        ),
      codes.length > 0
        ? db
            .from("fflogs_attendance_actuals")
            .select("report_code, discord_user_id, pulls")
            .in("report_code", codes.slice(0, 300))
        : Promise.resolve({ data: [] as never[], error: null }),
    ]);

    // 同じ理由 (上のコメント参照) で、出席と回答の読み取り失敗もエラーにする。
    const readError = attendancesRes.error ?? actualsRes.error;
    if (readError) {
      console.warn("[attendance-summary] read failed:", readError.message);
      return { ok: false, reason: "出席サマリーの取得に失敗しました" };
    }

    const symbolsBySession = new Map<string, Record<string, string>>();
    for (const a of (attendancesRes.data ?? []) as Array<{
      session_id: string;
      discord_user_id: string;
      symbol: string;
    }>) {
      const bag = symbolsBySession.get(a.session_id) ?? {};
      bag[a.discord_user_id] = a.symbol;
      symbolsBySession.set(a.session_id, bag);
    }

    const pullsByDay = new Map<string, Record<string, number>>();
    for (const r of (actualsRes.data ?? []) as Array<{
      report_code: string;
      discord_user_id: string;
      pulls: number;
    }>) {
      const day = dayOfReport.get(r.report_code);
      if (!day) continue;
      const bag = pullsByDay.get(day) ?? {};
      bag[r.discord_user_id] =
        (bag[r.discord_user_id] ?? 0) + (Number(r.pulls) || 0);
      pullsByDay.set(day, bag);
    }

    const sessions: HistorySessionInput[] = sessionRows.map((s) => {
      const day = jstYmdString(new Date(s.parsed_date));
      return {
        sessionDate: day,
        rawDate: s.raw_date,
        status: s.status,
        isOptional: s.is_optional === true,
        dayPulls: pullsPerDay.get(day) ?? 0,
        symbols: symbolsBySession.get(s.id) ?? {},
        pullsBy: pullsByDay.get(day) ?? {},
      };
    });

    const members = memberRows
      .filter((mem) => isAdmin || mem.discord_user_id === user.discordId)
      .map((mem) => ({
        discordUserId: mem.discord_user_id,
        displayName: mem.display_name ?? "",
      }));

    const history = summarizeAttendanceHistory({ sessions, members });
    return {
      ok: true,
      selfOnly,
      windowDays: WINDOW_DAYS,
      history: {
        ...history,
        mismatches: history.mismatches.slice(0, MISMATCH_LIMIT),
      },
    };
  } catch (e) {
    console.warn("[attendance-summary] failed:", e);
    return { ok: false, reason: "出席サマリーの取得に失敗しました" };
  }
}
