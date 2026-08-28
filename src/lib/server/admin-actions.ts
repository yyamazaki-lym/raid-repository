"use server";

import { revalidatePath } from "next/cache";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import { createClient } from "@/lib/supabase/server";

export type DataInitCounts = {
  tags: number;
  category_macros: number;
  // TODO #94 (2026-08-28) の追加テーブル。categories 経由の CASCADE で
  // 消えるもの (waymarks / bis_links / weekly_checks) も件数を出すため明示。
  category_waymarks: number;
  category_bis_links: number;
  loot_weekly_checks: number;
  // FFLogs 由来の 3 テーブルは categories への FK が SET NULL / FK 無しで、
  // 明示削除しないと category_id=NULL の行として残り続ける (不可視のゴミ)。
  fflogs_fights: number;
  fflogs_report_syncs: number;
  fflogs_report_videos: number;
  recruitment_templates: number;
  strategy_docs: number;
  mitigation_entries: number;
  mitigation_phases: number;
  loot_entries: number;
  loot_items: number;
  category_links: number;
  categories: number;
  schedule_session_memos: number;
  schedule_past_session_logs: number;
  schedule_past_sessions: number;
  app_settings: number;
};

export type DataInitResult =
  | { ok: true; counts: DataInitCounts }
  | { ok: false; reason: string; partial?: Partial<DataInitCounts> };

/**
 * TODO #23 (2.1): サイト全体のアプリデータを削除して初期化する。
 *
 * 削除対象:
 *   - categories + 子テーブル (category_links / loot_items / loot_entries
 *     / mitigation_phases / mitigation_entries / strategy_docs /
 *     category_macros / category_waymarks / category_bis_links /
 *     loot_weekly_checks) ※ FK ON DELETE CASCADE 経由でも消えるが
 *     削除件数を取りたいので明示順に削除する
 *   - fflogs_fights / fflogs_report_syncs (categories への FK が
 *     ON DELETE SET NULL) と fflogs_report_videos (FK 無し) —
 *     **明示削除しないと category_id=NULL の行として残り続ける**
 *     (どの画面にも出ないゴミになり、再構築しても消えない)
 *   - recruitment_templates (categories と FK ON DELETE SET NULL なので
 *     categories を消しても残る → 別途削除)
 *   - tags (FK 無し、target_id で論理参照のみ)
 *   - schedule_past_sessions / schedule_session_memos
 *   - app_settings (Schedule URL / FFLogs username / Discord channel ID
 *     / FFLogs match keywords 等)
 *
 * 残すもの:
 *   - secrets (FFLogs OAuth token / session cookie — 再ログイン省力化)
 *   - storage の category-backgrounds bucket オブジェクト (DB 行が消えれば
 *     参照 URL は無くなる、ガベージとしてストレージ残置でも害なし。
 *     画像クリーンアップは将来 admin Server Action で別途対応する想定)
 *   - auth.users / app_metadata (Discord OAuth セッション)
 *
 * Supabase REST には transaction が無いため部分削除が起こり得る。
 * いずれかのテーブルでエラーが発生した時点で stop し、それまでの
 * 削除済件数を `partial` として返す。完全な atomic delete が必要に
 * なったら PL/pgSQL function (RPC) 化を検討。
 */
export async function initializeAllDataAction(): Promise<DataInitResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) {
    return { ok: false, reason: "ADMIN ロールが必要です" };
  }

  const supabase = await createClient();
  const counts: DataInitCounts = {
    tags: 0,
    category_macros: 0,
    category_waymarks: 0,
    category_bis_links: 0,
    loot_weekly_checks: 0,
    fflogs_fights: 0,
    fflogs_report_syncs: 0,
    fflogs_report_videos: 0,
    recruitment_templates: 0,
    strategy_docs: 0,
    mitigation_entries: 0,
    mitigation_phases: 0,
    loot_entries: 0,
    loot_items: 0,
    category_links: 0,
    categories: 0,
    schedule_session_memos: 0,
    schedule_past_session_logs: 0,
    schedule_past_sessions: 0,
    app_settings: 0,
  };

  // TODO #64 (2.1, 2026-05-02 part5): `schedule_past_session_logs` は
  // schedule_past_sessions に対する子表 (FK ON DELETE CASCADE 設定済)
  // なので CASCADE 任せでも消えるが、削除件数を別カウントとして表示
  // したいので親より先に明示削除。
  const steps: Array<{ table: keyof DataInitCounts; pk: string }> = [
    { table: "tags", pk: "id" },
    { table: "category_macros", pk: "id" },
    { table: "category_waymarks", pk: "id" },
    { table: "category_bis_links", pk: "id" },
    { table: "loot_weekly_checks", pk: "id" },
    { table: "fflogs_fights", pk: "id" },
    { table: "fflogs_report_syncs", pk: "report_code" },
    { table: "fflogs_report_videos", pk: "report_code" },
    { table: "recruitment_templates", pk: "id" },
    { table: "strategy_docs", pk: "id" },
    { table: "mitigation_entries", pk: "id" },
    { table: "mitigation_phases", pk: "id" },
    { table: "loot_entries", pk: "id" },
    { table: "loot_items", pk: "id" },
    { table: "category_links", pk: "id" },
    { table: "categories", pk: "id" },
    { table: "schedule_session_memos", pk: "id" },
    { table: "schedule_past_session_logs", pk: "id" },
    { table: "schedule_past_sessions", pk: "raw_date" },
    { table: "app_settings", pk: "key" },
  ];

  for (const step of steps) {
    const { data, error } = await supabase
      .from(step.table)
      .delete()
      .not(step.pk, "is", null)
      .select(step.pk);
    if (error) {
      return {
        ok: false,
        reason: dbError(`${step.table} 削除`, error),
        partial: { ...counts },
      };
    }
    counts[step.table] = data?.length ?? 0;
  }

  // 関連ページを invalidate。layout 再生成でカテゴリ一覧 / スケジュール
  // 等が空状態にリセットされる。
  try {
    revalidatePath("/", "layout");
  } catch {
    // best-effort
  }

  return { ok: true, counts };
}
