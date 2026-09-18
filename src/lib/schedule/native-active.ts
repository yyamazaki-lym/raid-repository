import "server-only";
import { cache } from "react";
import { getPortalSetting } from "@/lib/supabase/app-settings";
import {
  DEFAULT_NATIVE_SCHEDULE_ID,
  NATIVE_ACTIVE_SCHEDULE_ID_KEY,
  isNativeScheduleId,
} from "./settings-keys";

/**
 * native モードで **いま表示しているスケジュール** の id (2026-09-18 段階 1)。
 *
 * 同期式の `getScheduleSourceUrl()` と対になる関数で、役割も同じ:
 * 「一覧はテーブル (`native_schedules`) が持ち、今どれを見るかはこの 1 キー」。
 * 予定表の描画・候補日の自動生成・Discord 通知・自動確定・催促・出席サマリーは
 * すべてこの id で絞る。
 *
 * app_settings の値は admin が書けるので**そのまま信用しない**。uuid の形を
 * していなければ既定スケジュール (schema が固定 id で作る行) に落とす。
 * 存在しない id が入っていた場合は「セッションが 1 件も無いスケジュール」に
 * 見えるだけで、データは壊れない (設定から選び直せば戻る)。
 *
 * `React.cache` で同一 render 内の重複読みを 1 回にまとめる。値自体は
 * `fetchPortalSettings()` の一括 SELECT に相乗りする。
 */
export const getActiveNativeScheduleId = cache(async (): Promise<string> => {
  const v = await getPortalSetting(NATIVE_ACTIVE_SCHEDULE_ID_KEY);
  return isNativeScheduleId(v) ? v.trim() : DEFAULT_NATIVE_SCHEDULE_ID;
});
