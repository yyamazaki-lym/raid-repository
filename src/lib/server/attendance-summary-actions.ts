"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  fetchAttendanceActualsByReports,
  type ActualRow,
} from "@/lib/schedule/attendance-actuals-paging";
import { assertAdminResult, requireDiscordMember } from "./auth";
import { userIsAdmin } from "./admin-roles";
import { syncFflogsFights } from "./fflogs-fights";
import {
  selectRefetchTargets,
  type RefetchLedgerRow,
} from "@/lib/schedule/attendance-refetch";
import { jstYmdString } from "@/lib/jst-date";
import {
  countedAttendancePulls,
  type ReportDay,
} from "@/lib/schedule/attendance-counted-pulls";
import { planPastSessionMerge } from "@/lib/schedule/past-session-dedup";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
// L-14: 同期式のスナップショット (名前 → 記号) をメンバーキーに直す層。
import {
  buildMemberNameIndex,
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

    const [sessionsRes, membersRes, fightsRes, duplicateRes] = await Promise.all([
      syncMode
        ? db
            .from("schedule_past_sessions")
            // 2026-10-05: 同じ日の重複をまとめるのに時間帯・出どころ・作成日時を
            // 読む。除外した日 (実施しなかった日) は表示と同じく数えない。
            // 2026-10-06: 除外した行も読み、除外した行と同じ開催 (時刻違いの
            // 重複) も数えない (下の planPastSessionMerge の `excluded`)。
            .select(
              "raw_date, parsed_date, attendances, start_time, end_time, source, created_at, excluded_at",
            )
            .gte("parsed_date", cutoffIso)
            .lte("parsed_date", new Date().toISOString())
            .order("parsed_date", { ascending: false })
        : db
            .from("native_schedule_sessions")
            .select("id, raw_date, parsed_date, status, is_optional")
            // 2026-10-02 (複数スケジュールの段階 2): **全スケジュール** の開催日を
            // 母数にする。段階 1 は表示中のスケジュールだけだった。メンバーは
            // 全スケジュール共通 (ADR-002 の前提「スケジュールが違ってもメンバーは
            // おおむね同じ」) なので、別のスケジュールの開催日に出た人も出席に数える。
            .gte("parsed_date", cutoffIso)
            .lte("parsed_date", new Date().toISOString())
            .order("parsed_date", { ascending: false }),
      db
        .from("native_schedule_members")
        // 2026-10-06: シートでの旧名も読む (同期式で、名前が変わる前の日の
        // 回答をこのメンバーに結びつける)。
        .select("discord_user_id, display_name, sort_order, is_active, schedule_aliases")
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
      // 2026-10-07 C-3: レポートごとの「別のログと同じ pull」の数 (schema.sql
      // 13c-4)。同じ夜を 2 人が上げたログで pull 数が 2 倍にならないよう割り戻す。
      db.rpc("fflogs_report_duplicate_pulls", { p_from_ms: cutoffMs }),
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

    const sessionRowsRaw = (sessionsRes.data ?? []) as Array<{
      /** 自前作成式のみ。 */
      id?: string;
      raw_date: string;
      parsed_date: string;
      /** 自前作成式のみ (同期式の過去日は確定済みとして扱う)。 */
      status?: "CANDIDATE" | "DECISION" | "CANCELLED";
      is_optional?: boolean;
      /** 同期式のみ: `{"名前": "◯", ...}`。Discord 由来の日は null。 */
      attendances?: Record<string, string> | null;
      /** 同期式のみ (同じ日の重複をまとめる判定)。 */
      start_time?: string;
      end_time?: string;
      source?: string | null;
      created_at?: string | null;
      /** 同期式のみ: 過去ログから除外した印 (除外した行は数えない)。 */
      excluded_at?: string | null;
    }>;
    // 2026-10-05: 同期式では、開催時刻を後から変えた日が時刻違いの 2 行になって
    // いる (本番の 10/02・10/04)。表示 (`mergeStoredPastSessions`) と同じく同じ
    // 開催を 1 つにまとめる — まとめないと開催日を 2 回数え、出席率が下がる。
    // 除外した行は数えず、除外した行と同じ開催の行も外す (2026-10-06)。
    const excludedRows = sessionRowsRaw.filter((r) => !!r.excluded_at);
    const sessionRows = syncMode
      ? (() => {
          const keep = new Set(
            planPastSessionMerge({
              sheet: [],
              excluded: excludedRows.map((r) => ({
                rawDate: r.raw_date,
                startMs: new Date(r.parsed_date).getTime(),
                startTime: r.start_time ?? "",
                endTime: r.end_time ?? "",
              })),
              stored: sessionRowsRaw.filter((r) => !r.excluded_at).map((r) => ({
                rawDate: r.raw_date,
                startMs: new Date(r.parsed_date).getTime(),
                startTime: r.start_time ?? "",
                endTime: r.end_time ?? "",
                hasAttendances: !!r.attendances && Object.keys(r.attendances).length > 0,
                createdAt: r.created_at ?? null,
                source: r.source ?? null,
              })),
            }).additions.map((c) => c.rawDate),
          );
          return sessionRowsRaw.filter((r) => keep.has(r.raw_date));
        })()
      : sessionRowsRaw;
    const memberRows = (membersRes.data ?? []) as Array<{
      discord_user_id: string;
      display_name: string;
      schedule_aliases?: string[] | null;
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
    //
    // 2026-10-07 C-3: 別のログと同じ pull の数。⚠ **読めなくても出席サマリーは
    // 出す** (重複を除かない従来の数に戻るだけで、「不在」には化けない)。
    // schema の新しい関数が入る前に新しいコードが配信された間もここを通る。
    const duplicateByReport = new Map<string, number>();
    if (duplicateRes.error) {
      console.warn("[attendance-summary] duplicate pulls read failed:", duplicateRes.error.message);
    } else {
      for (const d of (duplicateRes.data ?? []) as Array<{ report_code: string; duplicate_pulls: number }>) {
        duplicateByReport.set(d.report_code, Number(d.duplicate_pulls) || 0);
      }
    }
    const reportDays: ReportDay[] = ((fightsRes.data ?? []) as Array<{
      report_code: string;
      first_start_ms: number;
      pulls: number;
    }>).map((f) => ({
      reportCode: f.report_code,
      day: jstYmdString(new Date(Number(f.first_start_ms))),
      pulls: Number(f.pulls) || 0,
      duplicatePulls: duplicateByReport.get(f.report_code) ?? 0,
    }));

    const codes = reportDays.map((r) => r.reportCode);
    // L-20 (2026-09-09 実機報告「出席サマリーは取得不可」): **同期式では
    // この表を読まない。** 同期式のセッション行は `schedule_past_sessions`
    // 由来で `id` を持たないため、`.in("session_id", [undefined, ...])` が
    // そのまま送られ **`invalid input syntax for type uuid: "undefined"`**
    // で 3 本まとめて失敗し、画面は「取得に失敗しました」になっていた
    // (本番の runtime log で確認)。同期式の記号は下の
    // `syncSymbolsFromSnapshot` が `attendances` から作るので、そもそも
    // この読み取りは要らない。
    const nativeSessionIds = syncMode
      ? []
      : sessionRows
          .map((s) => s.id)
          .filter((id): id is string => typeof id === "string");
    const [attendancesRes, actualsRes] = await Promise.all([
      nativeSessionIds.length > 0
        ? db
            .from("native_schedule_attendances")
            .select("session_id, discord_user_id, symbol")
            .in("session_id", nativeSessionIds)
        : Promise.resolve({ data: [], error: null }),
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

    // 日の pull 数とメンバーの pull 数を、別のログと同じ pull を除いた数に
    // 割り戻す (`attendance-counted-pulls.ts` の docstring)。
    const { dayPulls: pullsPerDay, pullsByDay } = countedAttendancePulls(
      reportDays,
      actualsRes.rows.map((r) => ({
        reportCode: r.report_code,
        discordUserId: r.discord_user_id,
        pulls: Number(r.pulls) || 0,
      })),
    );

    // L-14: 同期式は回答が**名前**キーなので、メンバーの表示名から引く
    // (対応表の作り方と未解決の扱いは `attendance-sync-symbols.ts`)。
    // 2026-10-06: 旧名でだけ載ったキー (aliasKeys) も受け取り、今の表示名で
    // 当たった回答を優先させる。
    const { keyByName, aliasKeys } = syncMode
      ? buildMemberNameIndex(
          memberRows.map((mem) => ({
            discordUserId: mem.discord_user_id,
            displayName: mem.display_name ?? null,
            scheduleAliases: mem.schedule_aliases ?? [],
          })),
        )
      : { keyByName: new Map<string, string | null>(), aliasKeys: new Set<string>() };

    /** 同期式で回答スナップショットが無く、集計に入れられなかった日の数。 */
    let noAttendanceData = 0;
    const sessions: HistorySessionInput[] = [];
    for (const s of sessionRows) {
      const day = jstYmdString(new Date(s.parsed_date));
      let symbols: Record<string, string | undefined>;
      if (syncMode) {
        const mapped = syncSymbolsFromSnapshot(s.attendances, keyByName, aliasKeys);
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

/** 1 回の取り直しで取りに行くレポート数 (URL を貼る取り込みと同じ上限)。 */
const REFETCH_LIMIT = 25;

export type RefetchUnmatchedResult =
  | {
      ok: true;
      /** 今回実際に取りに行ったレポート数 (失敗を含む)。 */
      requested: number;
      /** 枠に入らず残したレポート数 (もう一度押すと続きを取り直す)。 */
      remaining: number;
      /** 取得に失敗したレポート数。 */
      failed: number;
      attendanceMatched: number;
      attendanceUnresolved: number;
      attendanceUnresolvedNames: string[];
      attendanceNoNameReports: number;
      /**
       * 取り直せなかったレポートと理由 (先頭 10 件)。取り直しでは一時的な
       * 失敗を台帳に書かないので、理由はここでしか分からない (2026-10-06)。
       */
      failures: Array<{ reportCode: string; reason: string }>;
    }
  | { ok: false; reason: string };

/**
 * 出席の突合ができていない日のレポートを取り直す (2026-10-06、admin のみ)。
 *
 * 参加者名は保存しない (W-6) ので、「ログ名」を後から入れても突合は
 * レポートを取り直さないとやり直せない。通常の同期は直近 14 日しか
 * 取り直さないため、出席サマリーの窓 (90 日) のそれより前の日が
 * 「紐づけられなかった日」のまま残っていた。窓の中で突合の行が 1 つも無い
 * レポートを選んで (`selectRefetchTargets`)、URL を貼る取り込みと同じ経路
 * (`onlyCodes`) で取り直す。取り直しは「新しいレポート」の通知に数えない
 * (`fflogs-fights.ts` の台帳判定)。分類 (カテゴリ)・日付・台帳の ok は変えない
 * (`preserveExisting`、URL 取り込みで選んだコンテンツや手動の割り当てを消さない)。
 *
 * `includeMatched` (2026-10-06): 突合の行があるレポートも取り直す。一部の
 * メンバーだけ「ログ名」を後から入れた場合に、その人の古い日を数え直す。
 */
export async function refetchUnmatchedAttendanceAction(input?: {
  includeMatched?: boolean;
}): Promise<RefetchUnmatchedResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  // client からの値なので、boolean 以外は false として扱う。
  const includeMatched = input?.includeMatched === true;
  try {
    const db = createSupabaseServiceRoleClient();
    const nowMs = Date.now();
    const cutoffMs = nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const daysRes = await db.rpc("fflogs_report_days", { p_from_ms: cutoffMs });
    if (daysRes.error) {
      console.warn("[attendance-refetch] report days failed:", daysRes.error.message);
      return { ok: false, reason: "取り直すレポートの選び出しに失敗しました" };
    }
    const reports = ((daysRes.data ?? []) as Array<{
      report_code: string;
      first_start_ms: number;
    }>).map((r) => ({
      reportCode: r.report_code,
      firstStartMs: Number(r.first_start_ms),
    }));
    const codes = reports.map((r) => r.reportCode);
    if (codes.length === 0) {
      return emptyRefetchResult();
    }

    const [actualsRes, ledgerRes] = await Promise.all([
      // 出席サマリーと同じ読み方 (塊 + ページ、order 必須)。
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
      db
        .from("fflogs_report_syncs")
        .select("report_code, ok, reason, synced_at")
        .in("report_code", codes),
    ]);
    // ⚠ 読み取りの失敗を「突合の行が無い」と扱わない (全部を取り直してしまう)。
    const readError = actualsRes.error ?? ledgerRes.error;
    if (readError) {
      console.warn("[attendance-refetch] read failed:", readError.message);
      return { ok: false, reason: "取り直すレポートの選び出しに失敗しました" };
    }
    const matchedCodes = new Set(actualsRes.rows.map((r) => r.report_code));
    const ledger = new Map<string, RefetchLedgerRow>(
      ((ledgerRes.data ?? []) as Array<{
        report_code: string;
        ok: boolean | null;
        reason: string | null;
        synced_at: string | null;
      }>).map((r) => [
        r.report_code,
        { ok: r.ok === true, reason: r.reason ?? null, syncedAt: r.synced_at ?? null },
      ]),
    );
    const targets = selectRefetchTargets({
      reports,
      matchedCodes,
      ledger,
      nowMs,
      limit: REFETCH_LIMIT,
      includeMatched,
    });
    if (targets.codes.length === 0) {
      return emptyRefetchResult();
    }

    // 分類・日付は変えず、参加者名と詳細だけを取り直す (`preserveExisting`)。
    const result = await syncFflogsFights({
      onlyCodes: targets.codes,
      preserveExisting: true,
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      // 実際に取りに行った件数 (ポイント不足・時間切れで止まった分は残りに入る)。
      requested: result.reportsFetched,
      // 時間切れで取り切れなかった分も「残り」に足す (もう一度押せば取る)。
      remaining: targets.remaining + result.remaining,
      failed: result.failed,
      attendanceMatched: result.attendanceMatched,
      attendanceUnresolved: result.attendanceUnresolved,
      attendanceUnresolvedNames: result.attendanceUnresolvedNames,
      attendanceNoNameReports: result.attendanceNoNameReports,
      failures: result.failures.slice(0, 10),
    };
  } catch (e) {
    console.warn("[attendance-refetch] failed:", e);
    return { ok: false, reason: "出席の突合の取り直しに失敗しました" };
  }
}

/** 取り直すレポートが無かったときの結果。 */
function emptyRefetchResult(): RefetchUnmatchedResult {
  return {
    ok: true,
    requested: 0,
    remaining: 0,
    failed: 0,
    attendanceMatched: 0,
    attendanceUnresolved: 0,
    attendanceUnresolvedNames: [],
    attendanceNoNameReports: 0,
    failures: [],
  };
}
