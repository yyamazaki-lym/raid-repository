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
  //     `/d/e/<token>/...` が (1) にマッチしなかった場合、この正規表現は
  //     `e` を doc id として拾ってしまい壊れた URL を作る。実際の Google の
  //     doc id は 40 文字前後なので、下限を設けて弾く。
  const doc = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(u.pathname);
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

export type SheetCardRow = {
  heading: string;
  cells: Array<{ label: string; value: string }>;
};

/**
 * カードに載せる価値の無いセル値の判定。
 *   - 空文字 / 記号 1 個だけ (「-」「ー」等はテンプレの埋め草)
 *   - チェックボックスの内部値 (TRUE / FALSE)。条件付き書式やフラグ用の
 *     列で、テキストとしては意味を持たない
 */
export function isNoiseValue(v: string): boolean {
  if (v === "") return true;
  return /^(?:-|–|—|ー|―|・|\.|true|false)$/i.test(v);
}

/**
 * 行 → カードデータ。タイムライン型の軽減表テンプレート (チェックボックス
 * 列や SPARKLINE 用の数値列を多数持つ) をそのままカード化すると
 * 「(無題) / FALSE ×10」のような意味不明の羅列になる (2026-08-28 実機報告)。
 *   - ノイズセル (`isNoiseValue`) と見出しと同文のセル (見出し行の繰り返し)
 *     は落とす
 *   - 見出し列が空の行は、最初の有効セルをカード見出しに昇格させる
 *     (タイムライン型ならフェーズ / 時刻がタイトルになる)
 *   - それでも中身が残らない行はカード自体を出さない
 */
export function buildSheetCardRows(
  table: SheetTable,
  visibleColumns: number[],
): SheetCardRow[] {
  const out: SheetCardRow[] = [];
  for (const row of table.rows) {
    let heading = row[0]?.trim() ?? "";
    if (isNoiseValue(heading)) heading = "";
    let cells = visibleColumns
      .map((ci) => ({
        label: table.headers[ci]?.trim() ?? "",
        value: row[ci]?.trim() ?? "",
      }))
      .filter((c) => !isNoiseValue(c.value) && c.value !== c.label);
    if (!heading && cells.length > 0) {
      heading = cells[0]!.value;
      cells = cells.slice(1);
    }
    if (!heading && cells.length === 0) continue;
    out.push({ heading, cells });
  }
  return out;
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
  // 完全一致が無ければ部分一致 (「D3 たろう」等)。ただし
  //   - 1 文字の見出し (「T」「H」) は誰の名前にも含まれやすく誤爆するので除外
  //   - 先頭一致ではなく **最長一致** を採る (「T」より「MT」を優先)
  let best: { index: number; length: number } | null = null;
  for (let i = 0; i < table.headers.length; i++) {
    const h = normalizeName(table.headers[i]!);
    if (h.length < 2) continue;
    if (h.includes(target) || target.includes(h)) {
      if (!best || h.length > best.length) best = { index: i, length: h.length };
    }
  }
  return best ? best.index : null;
}

function normalizeName(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}
