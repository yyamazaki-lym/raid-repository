import "server-only";
import { cache } from "react";
import { createClient, createSupabaseServiceRoleClient } from "./server";
import { SCHEDULE_TOP_TEXT_OVERRIDE_KEY } from "@/lib/schedule-top-text-keys";
import {
  NATIVE_DEFAULT_END_TIME_KEY,
  NATIVE_DEFAULT_START_TIME_KEY,
} from "@/lib/schedule/native-defaults";
import {
  NATIVE_CHOICE_VALUES_KEY,
  SCHEDULE_SOURCE_MODE_KEY,
  SCHEDULE_URL_KEY,
} from "@/lib/schedule/settings-keys";

/**
 * app_settings **読み取り専用** の client を返す (2026-08-05 監査 H-2)。
 *
 * この表はサーバー設定であって「セッションの有無に関わらず読む」必要がある:
 *   - cron 4 本はユーザー cookie を持たないので anon ロールになる
 *   - PUBLIC_DEMO_MODE の匿名訪問者も TOP 描画で schedule_url 等を要る
 *
 * H-2 で anon の SELECT を閉じたため、従来の cookie ベース `createClient()`
 * のままだとこの 2 経路が壊れる。読み取りは service role に寄せ、書き込みは
 * 従来どおり RLS の is_admin ポリシーで守る (書き込み経路はこの関数を使わない)。
 *
 * service role key 未設定の fork では cookie ベースに graceful degrade する
 * (ログイン済みメンバーの閲覧は authenticated ロールで従来どおり動く)。
 */
function settingsReadClient() {
  try {
    return createSupabaseServiceRoleClient();
  } catch {
    return createClient();
  }
}

/**
 * 1.9 (2026-04-28) TODO #11: 複数 app_settings キーを 1 round-trip で
 * 取得する bulk 版。`page.tsx` のように 2+ keys を必要とするページで
 * `fetchAppSetting()` を複数呼ぶより 1 SELECT で済ませる方が DB
 * round-trip が削減できる。
 *
 * `React.cache` で memoize してあるので同一 render 内で重複呼び出し
 * してもクエリは 1 度きり。
 */
export const fetchAppSettings = cache(
  async (keys: string[]): Promise<Record<string, string | null>> => {
    if (keys.length === 0) return {};
    try {
      const supabase = await settingsReadClient();
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", keys);
      if (error) {
        console.warn("[app-settings] bulk fetch error:", error.message);
        return Object.fromEntries(keys.map((k) => [k, null]));
      }
      const out: Record<string, string | null> = Object.fromEntries(
        keys.map((k) => [k, null]),
      );
      for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
        out[row.key] = row.value ?? null;
      }
      return out;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string"
      ) {
        const digest = (err as { digest: string }).digest;
        if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
          throw err;
        }
      }
      console.warn("[app-settings] bulk fetch unexpected error:", err);
      return Object.fromEntries(keys.map((k) => [k, null]));
    }
  },
);

/**
 * TOP (スケジュールページ) 描画が必要とする app_settings キーの固定集合
 * (2026-07-12 監査 A-2)。
 *
 * 従来は `getScheduleSourceMode` (mode) → `getScheduleSourceUrl` (url) →
 * `fetchAppSettings([top_text])` (+ native は choice_values / default 時刻)
 * が別々の React.cache エントリになり、TOP 1 リクエストで app_settings に
 * 3〜4 本の SELECT が直列/並列に飛んでいた。`fetchAppSettings` は引数配列の
 * **参照 identity** が cache キーになるため、呼び出し元ごとの配列リテラルでは
 * 共有されない。引数なしの `fetchPortalSettings()` に束ねることで
 * リクエスト毎ちょうど 1 SELECT になる。
 *
 * キーを増やす際の注意: ここは「TOP 描画パスで参照するキー」だけを足す。
 * cron / 通知系 (native-schedule-discord.ts 等) は従来どおり
 * `fetchAppSetting()` を個別に呼ぶ (描画パスと違い RTT が問題にならない)。
 */
const PORTAL_SETTING_KEYS: string[] = [
  SCHEDULE_SOURCE_MODE_KEY,
  SCHEDULE_URL_KEY,
  SCHEDULE_TOP_TEXT_OVERRIDE_KEY,
  NATIVE_DEFAULT_START_TIME_KEY,
  NATIVE_DEFAULT_END_TIME_KEY,
  NATIVE_CHOICE_VALUES_KEY,
];

/**
 * TOP 描画用の app_settings 一括リーダー。モジュールレベルの固定配列を
 * `fetchAppSettings` に渡すため、どの呼び出し元から呼んでも同一 cache
 * エントリ = リクエスト毎 1 SELECT。
 */
export function fetchPortalSettings(): Promise<Record<string, string | null>> {
  return fetchAppSettings(PORTAL_SETTING_KEYS);
}

/** `fetchPortalSettings()` から単一キーを取り出す convenience リーダー。 */
export async function getPortalSetting(key: string): Promise<string | null> {
  return (await fetchPortalSettings())[key] ?? null;
}

/**
 * Server-side reader for the shared `app_settings` table.
 *
 * This replaces the previous per-browser cookie approach for the schedule
 * URL — the value lives in Supabase so registering it once makes it
 * visible to everyone in the固定.
 *
 * Cached per request via React.cache so the same key isn't fetched twice
 * within a single render tree.
 */
export const fetchAppSetting = cache(
  async (key: string): Promise<string | null> => {
    try {
      const supabase = await settingsReadClient();
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        console.warn("[app-settings] fetch error:", key, error.message);
        return null;
      }
      return (data?.value as string | null | undefined) ?? null;
    } catch (err) {
      // Re-throw Next.js prerender bailouts.
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest?: unknown }).digest === "string"
      ) {
        const digest = (err as { digest: string }).digest;
        if (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_")) {
          throw err;
        }
      }
      console.warn("[app-settings] unexpected error:", err);
      return null;
    }
  },
);
