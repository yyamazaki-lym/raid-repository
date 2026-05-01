"use server";

import { revalidatePath } from "next/cache";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import { createClient } from "@/lib/supabase/server";

export type DataInitCounts = {
  tags: number;
  category_macros: number;
  recruitment_templates: number;
  strategy_docs: number;
  mitigation_entries: number;
  mitigation_phases: number;
  loot_entries: number;
  loot_items: number;
  category_links: number;
  categories: number;
  schedule_session_memos: number;
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
 *     category_macros) ※ FK ON DELETE CASCADE 経由でも消えるが
 *     削除件数を取りたいので明示順に削除する
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
    recruitment_templates: 0,
    strategy_docs: 0,
    mitigation_entries: 0,
    mitigation_phases: 0,
    loot_entries: 0,
    loot_items: 0,
    category_links: 0,
    categories: 0,
    schedule_session_memos: 0,
    schedule_past_sessions: 0,
    app_settings: 0,
  };

  const steps: Array<{ table: keyof DataInitCounts; pk: string }> = [
    { table: "tags", pk: "id" },
    { table: "category_macros", pk: "id" },
    { table: "recruitment_templates", pk: "id" },
    { table: "strategy_docs", pk: "id" },
    { table: "mitigation_entries", pk: "id" },
    { table: "mitigation_phases", pk: "id" },
    { table: "loot_entries", pk: "id" },
    { table: "loot_items", pk: "id" },
    { table: "category_links", pk: "id" },
    { table: "categories", pk: "id" },
    { table: "schedule_session_memos", pk: "id" },
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
