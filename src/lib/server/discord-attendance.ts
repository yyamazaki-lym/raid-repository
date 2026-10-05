import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getScheduleSourceMode } from "@/lib/schedule/source-mode";
import { parseChoiceValues } from "@/lib/schedule/native-fetch";
import { NATIVE_CHOICE_VALUES_KEY } from "@/lib/schedule/settings-keys";
import { symbolAllowsTimes } from "@/lib/schedule/attendance-times";
import { attendanceButtonChoices, sessionButtonLabel } from "@/lib/discord-interactions";
import { maybeAutoConfirmSession } from "./native-schedule-auto-confirm";

/**
 * Discord の回答ボタンが押されたときの書き込み (W-21、2026-10-05)。
 * 署名の検証は route (`/api/discord/interactions`) が済ませてから呼ぶ。
 *
 * Web の出欠の保存 (`upsertNativeScheduleAttendanceAction`) は本人の JWT + RLS
 * で「自分の行だけ」を守るが、こちらはログインが無いので service role で書く。
 * 代わりに次をここで確かめる (どれかが外れたら書かない):
 *   - いまのスケジュールが自前作成式
 *   - 予定があり、中止になっていない
 *   - 押した人 (署名された要求の中の ID) が有効なポータルのメンバー
 *   - 記号が **いまの** 選択肢のボタンにある (送った後に選択肢が変わったら弾く)
 * 書くのは押した本人の行だけ (`discord_user_id` は押した人の ID 以外を使わない)。
 *
 * 戻り値は押した本人にだけ見せる返事。Discord は 3 秒以内の応答を求めるので、
 * 読み取りは並べて投げる。
 */
export async function answerAttendanceFromDiscord(input: {
  discordUserId: string;
  sessionId: string;
  symbol: string;
}): Promise<string> {
  const mode = await getScheduleSourceMode();
  if (mode !== "native") {
    return "いまのスケジュールは自前作成式ではないため、ボタンでは回答できません。ポータルから入力してください。";
  }
  const db = createSupabaseServiceRoleClient();
  const [sessionRes, memberRes, choicesRes] = await Promise.all([
    db
      .from("native_schedule_sessions")
      .select("id, raw_date, status, schedule_id")
      .eq("id", input.sessionId)
      .maybeSingle(),
    db
      .from("native_schedule_members")
      .select("discord_user_id, is_active")
      .eq("discord_user_id", input.discordUserId)
      .maybeSingle(),
    db.from("app_settings").select("value").eq("key", NATIVE_CHOICE_VALUES_KEY).maybeSingle(),
  ]);
  if (sessionRes.error || memberRes.error || choicesRes.error) {
    console.warn(
      "[discord-attendance] read failed:",
      sessionRes.error?.message ?? memberRes.error?.message ?? choicesRes.error?.message,
    );
    return "読み取りに失敗しました。少し待ってからもう一度押すか、ポータルから入力してください。";
  }
  const session = sessionRes.data as {
    id: string;
    raw_date: string;
    status: string;
    schedule_id: string | null;
  } | null;
  if (!session) return "この予定は見つかりません (削除された可能性があります)。";
  if (session.status === "CANCELLED") return "この予定は中止になりました。";
  const member = memberRes.data as { discord_user_id: string; is_active: boolean } | null;
  if (!member || member.is_active !== true) {
    return "ポータルのメンバーに登録されていないため回答できません。管理者に Discord ID の登録を頼んでください。";
  }
  const choices = parseChoiceValues(
    (choicesRes.data as { value: string | null } | null)?.value ?? null,
  ).values;
  if (!attendanceButtonChoices(choices).includes(input.symbol)) {
    return "出欠の選択肢が変わったため、このボタンは使えません。ポータルから入力してください。";
  }

  const { error } = await db.from("native_schedule_attendances").upsert(
    {
      session_id: session.id,
      discord_user_id: member.discord_user_id,
      symbol: input.symbol,
      // 出られない記号に変えたら遅刻 / 早退の予定時刻は消す (Web の保存と同じ)。
      // それ以外はコメント・予定時刻を触らない (列を送らなければ上書きしない)。
      ...(symbolAllowsTimes(input.symbol) ? {} : { arrive_at: null, leave_at: null }),
    },
    { onConflict: "session_id,discord_user_id" },
  );
  if (error) {
    console.warn("[discord-attendance] upsert failed:", error.message);
    return "保存に失敗しました。少し待ってからもう一度押すか、ポータルから入力してください。";
  }
  // Web の保存と同じく、全員回答で開催を自動確定する設定 (既定 OFF) を見る。
  await maybeAutoConfirmSession(session.id);
  try {
    revalidatePath("/");
  } catch {
    // best-effort
  }
  return `${sessionButtonLabel(session.raw_date, null)} を「${input.symbol}」で回答しました。変えるときは別のボタンを押すか、ポータルから入力してください。`;
}
