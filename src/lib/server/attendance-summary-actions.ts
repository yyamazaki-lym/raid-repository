"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  fetchAttendanceActualsByReports,
  type ActualRow,
} from "@/lib/schedule/attendance-actuals-paging";
import { requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { jstYmdString } from "@/lib/jst-date";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
// L-14: 同期式のスナップショット (名前 → 記号) をメンバーキーに直す層。
import {
  buildMemberKeyByName,
  syncSymbolsFromSnapshot,
} from "@/lib/schedule/attendance-sync-symbols";
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
 * ## 同期式でも使える (L-14、2026-09-09 実機報告「出席サマリーは同期式の
 * 場合使えないか」)
 *
 * 自前作成式は `native_schedule_sessions` + `native_schedule_attendances`
 * (メンバーキー → 記号) を持つが、同期式にはそれが無い。代わりに
 * `schedule_past_sessions.attendances` (`{"名前": "◯", ...}`) がある。
 *
 * ⚠ **持っているのは character-sheets のスナップショット由来の日だけ。**
 * Discord の投稿だけから作られた日は `attendances` が NULL で、回答が
 * 分からない。**「全員不在」にはしない** — 集計から外して
 * `noAttendanceData` として数を出す (黙って母数を減らさない)。
 *
 * ⚠ **回答の主キーが名前**なので、メンバー一覧の表示名と突き合わせる
 * (`normalizeName`)。同じキーに 2 人当たったらどちらにも解決しない
 * (取り違えるより未解決の方がまし — W-6 と同じ方針)。実績側 (pull) は
 * メンバーキーなので、`native_schedule_members` が空の固定では
 * 突合そのものができない。
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

    // L-14: 同期式は `schedule_past_sessions` (スナップショットの回答) から作る。
    const sourceMode = await getScheduleSourceMode();
    if (sourceMode === "disabled") {
      return { ok: false, reason: "スケジュール機能が無効です" };
    }
    const syncMode = sourceMode === "sync";

    const [sessionsRes, membersRes, fightsRes] = await Promise.all([
      syncMode
        ? db
            .from("schedule_past_sessions")
            .select("raw_date, parsed_date, attendances")
            .gte("parsed_date", cutoffIso)
            .lte("parsed_date", new Date().toISOString())
            .order("parsed_date", { ascending: false })
        : db
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
      // 期間内の pull を **レポート単位に畳んで** 引く (2026-09-09)。
      // ⚠ 以前は `fflogs_fights` の生行を `.select("report_code, start_ms")`
      // で読んでいたが、**PostgREST の既定 1000 行上限**に当たっていた
      // (90 日 = 週 3 日 × 40 pull で約 1,540 行。`order` も無かったので
      // どの 1000 行が返るかも不定)。切れた行の pull は突合から落ちるので、
      // 出席が静かに間違う。返る行数を数十に落とす RPC に置き換えた
      // (schema.sql 13c-4 節)。
      db.rpc("fflogs_report_days", { p_from_ms: cutoffMs }),
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
      /** 自前作成式のみ。 */
      id?: string;
      raw_date: string;
      parsed_date: string;
      /** 自前作成式のみ (同期式の過去日は確定済みとして扱う)。 */
      status?: "CANDIDATE" | "DECISION" | "CANCELLED";
      is_optional?: boolean;
      /** 同期式のみ: `{"名前": "◯", ...}`。Discord 由来の日は null。 */
      attendances?: Record<string, string> | null;
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
          noAttendanceData: 0,
        },
      };
    }

    // レポート → JST 暦日 / 暦日 → pull 数。
    // ⚠ 暦日は **レポート内の最初の pull** で決める。以前は生行を回して
    // 「行ごとの暦日」で数えていたため、日を跨いだレポートの pull が
    // `dayOfReport` の指す日とは別の日に積まれ、**その日の総 pull 数
    // (`dayPulls`) とメンバー別の pull 数 (`pullsBy`、レポート経由で
    // 日に結ぶ) が食い違っていた**。レポート単位に揃える。
    const dayOfReport = new Map<string, string>();
    const pullsPerDay = new Map<string, number>();
    for (const f of (fightsRes.data ?? []) as Array<{
      report_code: string;
      first_start_ms: number;
      pulls: number;
    }>) {
      const day = jstYmdString(new Date(Number(f.first_start_ms)));
      dayOfReport.set(f.report_code, day);
      pullsPerDay.set(day, (pullsPerDay.get(day) ?? 0) + (Number(f.pulls) || 0));
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
      // 出席実績は上限で切れないよう塊 + ページで取り切る (2026-09-09)。
      // ⚠ **order を外さないこと** — 順序なしの range() は行の重複 / 抜けを
      // 生む。順序が付いているかは check-attendance-actuals-paging.mjs が
      // このファイルを見て確かめる。
      fetchAttendanceActualsByReports(
        async ({ codes: chunk, from, to }) => {
          const { data, error } = await db
            .from("fflogs_attendance_actuals")
            .select("report_code, discord_user_id, pulls")
            .in("report_code", chunk)
            .order("report_code", { ascending: true })
            .order("discord_user_id", { ascending: true })
            .range(from, to);
          return { rows: data as ActualRow[] | null, error };
        },
        codes,
      ),
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
    for (const r of actualsRes.rows) {
      const day = dayOfReport.get(r.report_code);
      if (!day) continue;
      const bag = pullsByDay.get(day) ?? {};
      bag[r.discord_user_id] =
        (bag[r.discord_user_id] ?? 0) + (Number(r.pulls) || 0);
      pullsByDay.set(day, bag);
    }

    // L-14: 同期式は回答が**名前**キーなので、メンバーの表示名から引く
    // (対応表の作り方と未解決の扱いは `attendance-sync-symbols.ts`)。
    const keyByName = syncMode
      ? buildMemberKeyByName(
          memberRows.map((mem) => ({
            discordUserId: mem.discord_user_id,
            displayName: mem.display_name ?? null,
          })),
        )
      : new Map<string, string | null>();

    /** 同期式で回答スナップショットが無く、集計に入れられなかった日の数。 */
    let noAttendanceData = 0;
    const sessions: HistorySessionInput[] = [];
    for (const s of sessionRows) {
      const day = jstYmdString(new Date(s.parsed_date));
      let symbols: Record<string, string | undefined>;
      if (syncMode) {
        const mapped = syncSymbolsFromSnapshot(s.attendances, keyByName);
        if (mapped === null) {
          // Discord の投稿だけから作られた日。回答が分からないので外す。
          noAttendanceData += 1;
          continue;
        }
        symbols = mapped;
      } else {
        symbols = symbolsBySession.get(s.id ?? "") ?? {};
      }
      sessions.push({
        sessionDate: day,
        rawDate: s.raw_date,
        // 同期式の過去日は確定済みとして扱う (候補 / 中止の概念が無い)。
        status: s.status ?? "DECISION",
        isOptional: s.is_optional === true,
        dayPulls: pullsPerDay.get(day) ?? 0,
        symbols,
        pullsBy: pullsByDay.get(day) ?? {},
      });
    }

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
        noAttendanceData,
        mismatches: history.mismatches.slice(0, MISMATCH_LIMIT),
      },
    };
  } catch (e) {
    console.warn("[attendance-summary] failed:", e);
    return { ok: false, reason: "出席サマリーの取得に失敗しました" };
  }
}
