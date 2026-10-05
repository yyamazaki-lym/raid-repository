"use server";

import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { isSensitiveSettingKey } from "@/lib/data-export";
import {
  IMPORT_KEY_BATCH,
  importKeyColumns,
  keyString,
  type ImportRow,
} from "@/lib/data-import";

/**
 * 書き出したデータの取り込み直し (2026-10-05、監査 F-3 の残り)。admin のみ。
 *
 * ブラウザが書き出しのファイルを読み、表ごとに塊に分けて呼ぶ (作りは
 * `src/lib/data-import.ts`)。どちらも admin を確かめてから service role で
 * 動く — 表によっては policy を張っていない (ミス注釈・出席の実績など。
 * 読み書きは server だけが行う設計) ので、admin の cookie では書けない。
 *
 * ⚠ 上書き (ユーザー決定 A): 主キーが同じ行は上書き、無い行は足す。ファイルに
 * 無い行は消さない。日付メモは件数上限のトリガー (1 人 1 日付 10 件) が
 * 取り込みにも効くので、上限を超える日付の行は失敗として返る。
 */

/** 1 回に受け取る行の数の上限 (塊はバイト数で分けるが、念のため件数でも縛る)。 */
const IMPORT_ROWS_MAX = 5000;
/** `in()` は値を URL に載せるので、確認の照会は小さく分ける。 */
const IN_CHUNK = 100;

type Fail = { ok: false; reason: string };

function checkInput(
  part: unknown,
  table: unknown,
  rows: unknown,
  max: number,
): { ok: true; keyColumns: string[]; rows: ImportRow[] } | Fail {
  if (typeof part !== "string" || typeof table !== "string") {
    return { ok: false, reason: "取り込みの指定が不正です" };
  }
  const keyColumns = importKeyColumns(part, table);
  if (!keyColumns) return { ok: false, reason: "取り込めない表です" };
  if (!Array.isArray(rows) || rows.length > max) {
    return { ok: false, reason: "取り込みの指定が不正です" };
  }
  for (const r of rows) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      return { ok: false, reason: "取り込みの指定が不正です" };
    }
    for (const c of keyColumns) {
      const v = (r as ImportRow)[c];
      if (v === undefined || v === null) {
        return { ok: false, reason: "取り込みの指定が不正です" };
      }
    }
  }
  return { ok: true, keyColumns, rows: rows as ImportRow[] };
}

/**
 * 確認: 送られた主キーのうち、既に DB にある数を返す (= 上書きになる行)。
 * 書き込まない。
 */
export async function countExistingImportRowsAction(input: {
  part: string;
  table: string;
  keys: ImportRow[];
}): Promise<{ ok: true; existing: number } | Fail> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const v = checkInput(input?.part, input?.table, input?.keys, IMPORT_KEY_BATCH);
  if (!v.ok) return v;
  if (v.rows.length === 0) return { ok: true, existing: 0 };

  const db = createSupabaseServiceRoleClient();
  const first = v.keyColumns[0]!;
  const firstValues = [...new Set(v.rows.map((k) => k[first]))];
  const found = new Set<string>();
  for (let i = 0; i < firstValues.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from(input.table)
      .select(v.keyColumns.join(","))
      .in(first, firstValues.slice(i, i + IN_CHUNK) as never[]);
    if (error) return { ok: false, reason: dbError("取り込みの確認", error) };
    for (const row of (data ?? []) as unknown as ImportRow[]) {
      found.add(keyString(row, v.keyColumns));
    }
  }
  const existing = v.rows.filter((k) => found.has(keyString(k, v.keyColumns))).length;
  return { ok: true, existing };
}

/**
 * 取り込み: 1 塊を主キーで upsert する (同じキーは上書き、無い行は足す)。
 * 書いた行の数を返す。参照先が無い (外部キー違反) などで塊ごと失敗したら
 * その理由を返す (呼び出し側は次の塊へ進み、最後にまとめて見せる)。
 */
export async function applyImportBatchAction(input: {
  part: string;
  table: string;
  rows: ImportRow[];
}): Promise<{ ok: true; written: number } | Fail> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const v = checkInput(input?.part, input?.table, input?.rows, IMPORT_ROWS_MAX);
  if (!v.ok) return v;
  // 手で作ったファイルに秘密になり得る設定キーが入っていても書かない。
  const rows =
    input.table === "app_settings"
      ? v.rows.filter((r) => !isSensitiveSettingKey(String(r.key ?? "")))
      : v.rows;
  if (rows.length === 0) return { ok: true, written: 0 };

  const db = createSupabaseServiceRoleClient();
  const { data, error } = await db
    .from(input.table)
    .upsert(rows, { onConflict: v.keyColumns.join(","), ignoreDuplicates: false })
    .select(v.keyColumns.join(","));
  if (error) return { ok: false, reason: dbError("取り込み", error) };
  return { ok: true, written: data?.length ?? 0 };
}
