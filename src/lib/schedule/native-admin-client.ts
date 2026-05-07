"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * TODO #2 phase 2-C (2026-05-07): settings-dialog の admin section 用に
 * native_schedule_* テーブルから「管理 UI が必要とする集合」を browser から
 * 直接 SELECT する client-side reader。
 *
 * - `allMembers`        ← native_schedule_members 全件 (is_active=false 含む)
 * - `cancelledSessions` ← native_schedule_sessions の status='CANCELLED' のみ
 * - `currentChoiceCsv`  ← app_settings.native_schedule_choice_values の現値
 *
 * `fetchNativeSchedule()` (server-only) は schedule-list が要求する集合
 * (is_active=true / status≠CANCELLED) に絞っているため、settings UI とは
 * 別経路で fetch する必要がある。RLS は SELECT を anon/authenticated 双方
 * `USING (true)` で開放しているため (`schema.sql` 7 章ループ)、client から
 * の直接 SELECT で問題なし。書き込みは server actions (admin gate) 経由。
 *
 * `schedule-url-store.ts` と同じ「use client + supabase/client」パターン。
 */

const NATIVE_CHOICE_VALUES_KEY = "native_schedule_choice_values";

export type NativeMemberRowFull = {
  discord_user_id: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
};

export type NativeCancelledSessionRow = {
  id: string;
  raw_date: string;
  parsed_date: string;
  start_time: string;
  end_time: string;
  day_of_week: string;
  note: string | null;
};

export type NativeAdminAux = {
  allMembers: NativeMemberRowFull[];
  cancelledSessions: NativeCancelledSessionRow[];
  currentChoiceCsv: string | null;
};

export async function fetchNativeScheduleAdminAux(): Promise<NativeAdminAux> {
  const supabase = createClient();
  const [membersRes, cancelledRes, choiceRes] = await Promise.all([
    supabase
      .from("native_schedule_members")
      .select("discord_user_id, display_name, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase
      .from("native_schedule_sessions")
      .select(
        "id, raw_date, parsed_date, start_time, end_time, day_of_week, note",
      )
      .eq("status", "CANCELLED")
      .order("parsed_date", { ascending: false }),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", NATIVE_CHOICE_VALUES_KEY)
      .maybeSingle(),
  ]);

  return {
    allMembers: (membersRes.data ?? []) as NativeMemberRowFull[],
    cancelledSessions: (cancelledRes.data ?? []) as NativeCancelledSessionRow[],
    currentChoiceCsv:
      (choiceRes.data?.value as string | null | undefined) ?? null,
  };
}
