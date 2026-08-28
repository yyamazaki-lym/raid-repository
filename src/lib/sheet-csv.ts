/**
 * Google Sheets の共有 URL を CSV エンドポイントに変換し、CSV をテーブルに
 * パースする純関数群 (TODO #94 / A-3)。
 *
 * 背景: 軽減表 / ロット表は Google Sheets を **編集の正** として iframe で
 * 埋めている (`sheet-iframe.tsx`)。この判断は覆さない — Sheets の同時編集は
 * portal では再現できないし、過去に native テーブル方式から移行した経緯も
 * ある (schema.sql の legacy `mitigation_*` / `loot_*` 参照)。
 *
 * 一方で iframe を 80% スケールしたものはスマホで実質読めず、「開催直前に
 * スマホで一番見たい情報が一番読みにくい」状態だった (調査ノート §2 空白 02)。
 * そこで **読み取り専用のカード表示だけ** を portal 側で生成する。書き込みは
 * 一切しないので Sheets が壊れる余地はなく、パースに失敗したら従来どおり
 * iframe にフォールバックすれば済む。
 */

export type SheetTable = {
  /** 1 行目 (見出し行)。空セルは "" のまま残す。 */
  headers: string[];
  /** 2 行目以降。列数は headers に合わせて揃える。 */
  rows: string[][];
};

/**
 * 対応する URL 形:
 *   1. `https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml?gid=0&single=true`
 *      → `https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv`
 *   2. `https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv` (既に CSV)
 *   3. `https://docs.google.com/spreadsheets/d/<id>/edit#gid=123`
 *      → `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&gid=123`
 *
 * 3 は「リンクを知っている全員が閲覧可」の共有設定でのみ通る (README の
 * 「通常の共有URL」ケースと同条件)。取得できない場合は呼び出し側が
 * iframe fallback に落ちるので、ここでは判定せず URL だけ返す。
 */
export function toSheetCsvUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.hostname !== "docs.google.com") return null;

  // gid は query か hash のどちらかに入る。
  const gid =
    u.searchParams.get("gid") ??
    /(?:^|[#&])gid=(\d+)/.exec(u.hash)?.[1] ??
    null;

  // (1)(2) published-to-web 形: /spreadsheets/d/e/<token>/(pubhtml|pub)
  const pub = /^\/spreadsheets\/d\/e\/([^/]+)\/(pubhtml|pub)\b/.exec(u.pathname);
  if (pub) {
    const out = new URL(
      `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub`,
    );
    if (gid) out.searchParams.set("gid", gid);
    out.searchParams.set("single", "true");
    out.searchParams.set("output", "csv");
    return out.toString();
  }

  // (3) 通常の共有 URL 形: /spreadsheets/d/<id>/...
  const doc = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(u.pathname);
  if (doc) {
    const out = new URL(
      `https://docs.google.com/spreadsheets/d/${doc[1]}/gviz/tq`,
    );
    out.searchParams.set("tqx", "out:csv");
    if (gid) out.searchParams.set("gid", gid);
    return out.toString();
  }

  return null;
}

/**
 * RFC4180 相当の最小 CSV パーサ。Google の CSV 出力は
 *   - フィールドの `"` エスケープ (`""`)
 *   - セル内改行
 * を使うのでその 2 つだけ正しく扱えれば足りる。依存を増やさないため自前。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // BOM 除去。
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // CRLF の CR は読み飛ばす (単独 CR は実質出現しない)。
    } else {
      field += c;
    }
  }
  // 最終行 (末尾改行が無いケース)。
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * 生の CSV 行列を「見出し + 行」に整形する。
 *
 * - 完全に空の行は落とす (Sheets の余白行が大量に付いてくるため)
 * - 全行で空のままの末尾列も落とす
 * - 列数は見出しに合わせて揃える (足りない分は "")
 */
export function toSheetTable(raw: string[][]): SheetTable | null {
  const nonEmpty = raw.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return null;

  // 実際に中身がある最大列数。
  let width = 0;
  for (const r of nonEmpty) {
    for (let i = r.length - 1; i >= 0; i--) {
      if (r[i]!.trim() !== "") {
        width = Math.max(width, i + 1);
        break;
      }
    }
  }
  if (width === 0) return null;

  const norm = (r: string[]) =>
    Array.from({ length: width }, (_, i) => (r[i] ?? "").trim());

  const [head, ...rest] = nonEmpty;
  return { headers: norm(head!), rows: rest.map(norm) };
}

/**
 * 表の中から「その人の担当」に当たる列を探す。
 *
 * 軽減表の作りは固定ごとにバラバラなので、確実な規約は置けない。
 * 見出し行に表示名が一致 (前後空白・全角半角の揺れを吸収) する列があれば
 * その列を、無ければ null を返す — 呼び出し側は null のとき
 * 「自分の担当だけ」フィルタを出さない。
 */
export function findMemberColumn(
  table: SheetTable,
  displayName: string,
): number | null {
  const target = normalizeName(displayName);
  if (!target) return null;
  for (let i = 0; i < table.headers.length; i++) {
    if (normalizeName(table.headers[i]!) === target) return i;
  }
  // 見出しが完全一致しない場合は部分一致も許す (「D3 たろう」等)。
  for (let i = 0; i < table.headers.length; i++) {
    const h = normalizeName(table.headers[i]!);
    if (h && (h.includes(target) || target.includes(h))) return i;
  }
  return null;
}

function normalizeName(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}
