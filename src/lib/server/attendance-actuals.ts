import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  resolveParticipants,
  type ActualParticipant,
  type MemberNameRef,
} from "@/lib/schedule/attendance-actuals";

/**
 * 出席の自動突合 (W-6、2026-09-08) の書き込み側。
 *
 * FFLogs の同期 (`fflogs-fights.ts`) が pull ごとに拾った参加者名を、ここで
 * メンバーキーに解決して `fflogs_attendance_actuals` に保存する。
 *
 * ⚠ **名前はこの関数から出ない。** 引数で受け取った名前は
 * `resolveParticipants` でメンバーキーに変換され、保存されるのは
 * `(レポートコード, メンバーキー, pull 数)` だけ。解決できなかった名前だけは
 * `fflogs_attendance_unresolved` に控える (admin が対応表を埋めるための一覧。
 * pull 単位の情報を持たないので死亡イベントと結合できない)。
 *
 * 書き込みは service role — この 2 表は RLS 有効 + policy 0 本で、
 * anon / authenticated からは読み書きできない (schema.sql 6b-9 / 7 章)。
 */

/** 1 レポートぶんの参加者 (名前 → そのレポートで映った pull 数)。 */
export type ReportParticipants = {
  reportCode: string;
  sessionDate: string | null;
  participants: ActualParticipant[];
};

export type RecordActualsResult = {
  /** 書き込んだレポート数。 */
  reports: number;
  /** メンバーに解決できた (レポート × 人) の行数。 */
  matched: number;
  /** 解決できなかった名前の数 (重複を除く)。 */
  unresolved: number;
  /** 解決できなかった名前 (admin への提示用、最大 12 件)。 */
  unresolvedNames: string[];
};

const UNRESOLVED_SHOW_LIMIT = 12;

/**
 * 参加者を解決して保存する。
 *
 * 失敗しても throw しない — 同期本体 (pull の取り込み) は成功しているので、
 * 突合だけが落ちても同期を失敗にはしない。
 */
export async function recordAttendanceActuals(
  reports: ReportParticipants[],
): Promise<RecordActualsResult> {
  const empty: RecordActualsResult = {
    reports: 0,
    matched: 0,
    unresolved: 0,
    unresolvedNames: [],
  };
  if (reports.length === 0) return empty;
  try {
    const db = createSupabaseServiceRoleClient();
    // is_active で絞らない — 抜けたメンバーの過去の出席も突合できる方がよい
    // (W-19 の履歴は過去のセッションを含む)。
    const { data: memberRows, error: memberErr } = await db
      .from("native_schedule_members")
      .select("discord_user_id, display_name, fflogs_character_name");
    if (memberErr) {
      console.warn("[attendance-actuals] member fetch failed:", memberErr.message);
      return empty;
    }
    const members: MemberNameRef[] = (
      (memberRows ?? []) as Array<{
        discord_user_id: string;
        display_name: string;
        fflogs_character_name?: string | null;
      }>
    ).map((r) => ({
      discordUserId: r.discord_user_id,
      displayName: r.display_name ?? "",
      characterName: r.fflogs_character_name ?? null,
    }));

    const rows: Array<{
      report_code: string;
      discord_user_id: string;
      session_date: string | null;
      pulls: number;
    }> = [];
    // 未解決の名前は「最後に見た pull 数 / 日」でまとめる (同じ名前が複数
    // レポートに出るのが普通なので、レポートごとに行を作らない)。
    const unresolvedBy = new Map<
      string,
      { pulls: number; lastSessionDate: string | null }
    >();
    const emptyReports: string[] = [];

    for (const rep of reports) {
      const { matched, unresolved } = resolveParticipants(
        rep.participants,
        members,
      );
      if (matched.length === 0 && unresolved.length === 0) {
        emptyReports.push(rep.reportCode);
      }
      for (const m of matched) {
        rows.push({
          report_code: rep.reportCode,
          discord_user_id: m.discordUserId,
          session_date: rep.sessionDate,
          pulls: m.pulls,
        });
      }
      for (const u of unresolved) {
        const prev = unresolvedBy.get(u.name);
        unresolvedBy.set(u.name, {
          pulls: Math.max(prev?.pulls ?? 0, u.pulls),
          lastSessionDate: rep.sessionDate ?? prev?.lastSessionDate ?? null,
        });
      }
    }

    if (rows.length > 0) {
      // レポート単位なので、同じレポートを取り直したときは同じ行が上書き
      // される (冪等)。1 レポート = 最大 8 行なので分割は不要。
      const { error } = await db
        .from("fflogs_attendance_actuals")
        .upsert(rows, { onConflict: "report_code,discord_user_id" });
      if (error) {
        console.warn("[attendance-actuals] upsert failed:", error.message);
        return empty;
      }
    }

    // 解決できた名前は未解決リストから消す (対応表を埋めた後の掃除)。
    const resolvedNames = new Set<string>();
    for (const rep of reports) {
      for (const p of rep.participants) {
        if (!unresolvedBy.has(p.name.trim())) resolvedNames.add(p.name.trim());
      }
    }
    if (resolvedNames.size > 0) {
      await db
        .from("fflogs_attendance_unresolved")
        .delete()
        .in("character_name", [...resolvedNames].slice(0, 200));
    }
    if (unresolvedBy.size > 0) {
      await db.from("fflogs_attendance_unresolved").upsert(
        [...unresolvedBy.entries()].slice(0, 200).map(([name, v]) => ({
          character_name: name,
          pulls: v.pulls,
          last_session_date: v.lastSessionDate,
        })),
        { onConflict: "character_name" },
      );
    }

    if (emptyReports.length > 0) {
      // 「名前が 1 つも取れなかった」= Summary table が名前を持たない形
      // だった可能性がある (実 API でしか確かめられない、W-6 の既知の
      // 不確実性)。同期のたびに 1 行だけ残して切り分けできるようにする。
      console.warn(
        `[attendance-actuals] 参加者名が 0 件のレポート ${emptyReports.length} 件: ` +
          emptyReports.slice(0, 5).join(", "),
      );
    }

    return {
      reports: reports.length,
      matched: rows.length,
      unresolved: unresolvedBy.size,
      unresolvedNames: [...unresolvedBy.keys()].slice(0, UNRESOLVED_SHOW_LIMIT),
    };
  } catch (e) {
    console.warn("[attendance-actuals] failed:", e);
    return empty;
  }
}

/**
 * レポート削除 (`deleteFflogsReportAction`) に合わせて突合結果も消す。
 *
 * 呼び出し側は admin スコープのクライアントを使っているが、この表は
 * policy 0 本なので **service role で消す必要がある** (admin クライアントで
 * DELETE すると 0 行で静かに成功し、消えたレポートの出席が残る)。
 */
export async function deleteAttendanceActualsForReport(
  reportCode: string,
): Promise<void> {
  try {
    const db = createSupabaseServiceRoleClient();
    await db
      .from("fflogs_attendance_actuals")
      .delete()
      .eq("report_code", reportCode);
  } catch (e) {
    console.warn("[attendance-actuals] delete failed:", e);
  }
}
