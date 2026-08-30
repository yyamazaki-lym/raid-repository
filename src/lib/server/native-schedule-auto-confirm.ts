import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { isUnanswered } from "@/lib/schedule/attendance-reminder-core";

/**
 * 全員入力で開催を自動確定する (2026-08-30、Tier2-8)。
 *
 * 日本の固定運用で広く使われている Google シート + GAS 方式の定番文法
 * 「○×△ を全員が入れたら開催の有無が自動で決まる」を native モードに
 * 取り込んだもの (調査 第3回 D-3)。
 *
 * **既定 OFF**。ユーザーの固定では使わないが機能としては欲しい、という
 * 指定なので設定項目として提供し、既定では一切動かない。
 *
 * 確定条件 (すべて満たしたときだけ CANDIDATE → DECISION):
 *   1. 設定が ON
 *   2. 対象セッションが CANDIDATE (DECISION / CANCELLED は触らない)
 *   3. アクティブメンバー全員が回答済み (未回答が 0)
 *   4. 参加可能な人数 (`×` 以外の回答) が閾値以上
 *      — 全員が「×」でも「全員入力済み」は成立してしまうため、
 *        人数条件が無いと「誰も来られない日」を確定してしまう
 *
 * 書き込みは service role (出欠を入れるのは非 admin のメンバーなので、
 * RLS の admin ポリシーでは status を更新できない)。設定 ON かつ上記
 * 条件成立時のみ、status の 1 列だけを更新する。
 */

export const AUTO_CONFIRM_ENABLED_KEY = "native_schedule_auto_confirm_enabled";
export const AUTO_CONFIRM_MIN_AVAILABLE_KEY =
  "native_schedule_auto_confirm_min_available";

/** 既定の必要人数 (フルパーティ)。 */
export const AUTO_CONFIRM_DEFAULT_MIN_AVAILABLE = 8;

/** 「参加不可」を表す記号。これ以外の回答は参加可能側として数える。 */
const UNAVAILABLE_SYMBOLS = new Set(["×", "x", "X", "✕", "✖"]);

export type AutoConfirmResult = {
  /** 実際に DECISION へ更新したか。 */
  confirmed: boolean;
  /** 判定理由 (ログ / デバッグ用)。 */
  reason: string;
};

export async function maybeAutoConfirmSession(
  sessionId: string,
): Promise<AutoConfirmResult> {
  try {
    const enabled = await fetchAppSetting(AUTO_CONFIRM_ENABLED_KEY);
    if (enabled !== "true") return { confirmed: false, reason: "無効 (OFF)" };

    const minAvailableRaw = await fetchAppSetting(
      AUTO_CONFIRM_MIN_AVAILABLE_KEY,
    );
    const parsed = Number.parseInt(minAvailableRaw ?? "", 10);
    const minAvailable =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 24
        ? parsed
        : AUTO_CONFIRM_DEFAULT_MIN_AVAILABLE;

    const supabase = createSupabaseServiceRoleClient();
    const { data: session } = await supabase
      .from("native_schedule_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return { confirmed: false, reason: "セッション不明" };
    if ((session as { status: string }).status !== "CANDIDATE") {
      return { confirmed: false, reason: "CANDIDATE ではない" };
    }

    const [membersRes, attendancesRes] = await Promise.all([
      supabase
        .from("native_schedule_members")
        .select("discord_user_id, is_active")
        .eq("is_active", true),
      supabase
        .from("native_schedule_attendances")
        .select("discord_user_id, symbol")
        .eq("session_id", sessionId),
    ]);
    const members = (membersRes.data ?? []) as Array<{
      discord_user_id: string;
    }>;
    if (members.length === 0) {
      return { confirmed: false, reason: "アクティブメンバーなし" };
    }
    const symbolBy = new Map<string, string>();
    for (const a of (attendancesRes.data ?? []) as Array<{
      discord_user_id: string;
      symbol: string;
    }>) {
      symbolBy.set(a.discord_user_id, a.symbol);
    }

    let available = 0;
    for (const m of members) {
      const symbol = symbolBy.get(m.discord_user_id);
      // 催促機能と同じ「未入力」判定を共有する (定義が 2 箇所に割れない)。
      if (isUnanswered(symbol)) {
        return { confirmed: false, reason: "未入力のメンバーがいる" };
      }
      if (!UNAVAILABLE_SYMBOLS.has((symbol ?? "").trim())) available += 1;
    }
    if (available < minAvailable) {
      return {
        confirmed: false,
        reason: `参加可能 ${available} 人 < 必要 ${minAvailable} 人`,
      };
    }

    // CANDIDATE のままの行だけを更新する (取得と更新の間に admin が
    // 確定/中止した場合に上書きしないための再ガード)。
    const { data: updated, error } = await supabase
      .from("native_schedule_sessions")
      .update({ status: "DECISION" })
      .eq("id", sessionId)
      .eq("status", "CANDIDATE")
      .select("id")
      .maybeSingle();
    if (error) return { confirmed: false, reason: error.message };
    if (!updated) return { confirmed: false, reason: "先に他経路が更新済み" };
    return { confirmed: true, reason: `参加可能 ${available} 人で自動確定` };
  } catch (e) {
    // 出欠の保存自体は成功しているので、ここでの失敗は握って握りつぶす。
    console.warn("[native-auto-confirm] failed:", e);
    return { confirmed: false, reason: String(e) };
  }
}
