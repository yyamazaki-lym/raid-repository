/**
 * 書き出したデータの取り込み直し (2026-10-05、監査 F-3 の残り、純モジュール)。
 *
 * `/api/admin/export` が書き出した JSON (`data-export.ts`) を、設定画面から
 * 本番の DB に書き戻す。ユーザー決定 (2026-10-05):
 *
 * - **上書き (A)**: ファイルの行を主キーで照合し、同じキーは上書き、無い行は
 *   足す。**ファイルに無い行は消さない**
 * - **確認画面あり**: 書き込む前に、表ごとに「追加 / 上書き」の件数を見せる
 *
 * ## 作り
 *
 * ブラウザがファイルを読み (`parseExportFile`)、表ごとに 1MB 未満の塊に分けて
 * Server Action に送る (`chunkRowsBySize`。Server Action の受け取りの既定上限が
 * 1MB)。確認は主キーだけを送って既存の件数を数え、取り込みは塊ごとに upsert
 * する (`src/lib/server/data-import-actions.ts`)。
 *
 * ## 書き戻さないもの
 *
 * - `secrets` 表 (書き出しにも含まれない)
 * - `app_settings` の秘密になり得るキー (`isSensitiveSettingKey`)。手で作った
 *   ファイルに入っていても飛ばす
 * - その種類に含まれない表 (ファイルの `part` と表の組が書き出しと一致しない行)
 *
 * `@/` を import しない (`scripts/check-data-import.mjs` が tsc で動かす)。
 */
import {
  EXPORT_FORMAT,
  EXPORT_PARTS,
  EXPORT_VERSION,
  isSensitiveSettingKey,
  type ExportPart,
} from "./data-export";

/** 1 回の Server Action で送る行の上限 (UTF-8 のバイト数)。既定上限 1MB に余裕を残す。 */
export const IMPORT_BATCH_MAX_BYTES = 700_000;
/** 確認で 1 回に送る主キーの数。 */
export const IMPORT_KEY_BATCH = 500;

/**
 * 取り込む順番の案内。表どうしの参照 (外部キー) があるので、参照される側から
 * 入れる。種類の中の表は `EXPORT_PARTS` の並び (参照される側が先) で入れる。
 */
export const IMPORT_PART_ORDER: ReadonlyArray<ExportPart["id"]> = [
  "settings",
  "content",
  "schedule",
  "loot",
  "logs",
  "fights",
];

export type ImportRow = Record<string, unknown>;

export type ParsedImportTable = {
  table: string;
  /** upsert の照合と既存の数えに使う主キー (書き出しの並びと同じ列)。 */
  keyColumns: string[];
  rows: ImportRow[];
  /** 飛ばした行 (秘密になり得る設定キー・主キーが欠けた行・オブジェクトでない行)。 */
  skipped: number;
};

export type ParsedImport = {
  part: ExportPart["id"];
  exportedAt: string | null;
  tables: ParsedImportTable[];
  /** 書き出しのときに失敗していた表 (ファイルの `errors`)。 */
  exportErrors: string[];
  /** ファイルにあったが、この種類に含まれないので読まなかった表。 */
  ignoredTables: string[];
};

/** 表の主キー (知らない種類・この種類に含まれない表は null)。外から来た値をそのまま渡せる。 */
export function importKeyColumns(part: string, table: string): string[] | null {
  const p = EXPORT_PARTS.find((x) => x.id === part);
  const t = p?.tables.find((x) => x.table === table);
  return t ? [...t.order] : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 書き出しのファイルを読む。形が違う・別のアプリの JSON・知らない種類は
 * 理由つきで弾く。表は **その種類の並び** に並べ直して返す (参照される側が先)。
 */
export function parseExportFile(
  data: unknown,
): { ok: true; value: ParsedImport } | { ok: false; reason: "format" | "version" | "part" } {
  if (!isPlainObject(data) || data.format !== EXPORT_FORMAT) {
    return { ok: false, reason: "format" };
  }
  if (data.version !== EXPORT_VERSION) return { ok: false, reason: "version" };
  const part = EXPORT_PARTS.find((p) => p.id === data.part);
  if (!part) return { ok: false, reason: "part" };
  const tablesIn = isPlainObject(data.tables) ? data.tables : {};
  const known = new Set(part.tables.map((t) => t.table));
  const tables: ParsedImportTable[] = [];
  for (const t of part.tables) {
    const raw = tablesIn[t.table];
    if (!Array.isArray(raw)) continue;
    const rows: ImportRow[] = [];
    let skipped = 0;
    for (const r of raw) {
      if (!isPlainObject(r)) {
        skipped += 1;
        continue;
      }
      if (t.order.some((c) => r[c] === undefined || r[c] === null)) {
        skipped += 1;
        continue;
      }
      if (t.table === "app_settings" && isSensitiveSettingKey(String(r.key ?? ""))) {
        skipped += 1;
        continue;
      }
      rows.push(r);
    }
    tables.push({ table: t.table, keyColumns: [...t.order], rows, skipped });
  }
  const errorsIn = Array.isArray(data.errors) ? data.errors : [];
  return {
    ok: true,
    value: {
      part: part.id,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null,
      tables,
      exportErrors: errorsIn
        .map((e) => (isPlainObject(e) && typeof e.table === "string" ? e.table : null))
        .filter((t): t is string => t !== null),
      ignoredTables: Object.keys(tablesIn).filter((k) => !known.has(k)),
    },
  };
}

/** 行から主キーの値だけを取り出す (確認で送る形)。 */
export function pickKey(row: ImportRow, keyColumns: readonly string[]): ImportRow {
  const out: ImportRow = {};
  for (const c of keyColumns) out[c] = row[c];
  return out;
}

/** 主キーの値を比べられる 1 本の文字列にする。 */
export function keyString(row: ImportRow, keyColumns: readonly string[]): string {
  return JSON.stringify(keyColumns.map((c) => row[c] ?? null));
}

/**
 * 行を、JSON にしたときのバイト数が `maxBytes` を超えない塊に分ける。
 * 1 行だけで上限を超える行は、その 1 行で 1 塊にする (送ってみて、Server
 * Action の上限で失敗したらその塊の失敗として見せる)。
 */
export function chunkRowsBySize<T>(
  rows: readonly T[],
  maxBytes: number = IMPORT_BATCH_MAX_BYTES,
): T[][] {
  const enc = new TextEncoder();
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 2; // "[]"
  for (const r of rows) {
    const n = enc.encode(JSON.stringify(r)).length + 1; // 区切りの ","
    if (cur.length > 0 && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 決まった数ずつに分ける (確認で主キーを送るとき)。 */
export function chunkByCount<T>(rows: readonly T[], size: number = IMPORT_KEY_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
