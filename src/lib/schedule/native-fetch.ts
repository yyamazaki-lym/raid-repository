import "server-only";
import type { ScheduleFetchResult } from "./next-session";

/**
 * Native (自前) スケジュールの fetcher (TODO #2 phase 1 skeleton)。
 *
 * Phase 1 では `native_schedule_*` テーブルへの SELECT 実装はせず、空の
 * `ParsedSchedule` を返すスケルトン。Phase 2 で:
 *   - `native_schedule_sessions` から rows を SELECT
 *   - `native_schedule_members` で users 列を構築
 *   - `native_schedule_attendances` を session_id でグルーピング
 *   - `app_settings.native_schedule_choice_values` で凡例を構築
 * を実装し、`ScheduleFetchResult` 互換の shape を返すことで
 * `schedule-list.tsx` は無改修のまま native mode で再利用できる。
 *
 * 戻り値型を sync 側 (`fetchSchedule`) と完全互換にすることで、
 * `schedule-page-body.tsx` 側の分岐は最小化される。
 */
export async function fetchNativeSchedule(): Promise<ScheduleFetchResult> {
  return {
    ok: true,
    data: {
      users: [],
      sessions: [],
      comments: [],
      topText: null,
      attendanceOptions: { choices: [], source: "unavailable" },
    },
  };
}
