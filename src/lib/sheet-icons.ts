/**
 * シート HTML からアイコン画像 (=IMAGE 数式の結果) を抜き出す
 * (2026-08-30 実機情報「アイコンは公式ジョブガイドの画像にリンクされている」)。
 *
 * 背景: CSV エクスポートは **数式の計算結果を文字列化** するため、
 * `=IMAGE("...")` のセルは空文字になる。一方 pubhtml / htmlview は
 * 画像として `<img src="...">` を描画するので、**HTML 側からなら画像 URL を
 * 取り出せる**。列 → 画像 URL が分かれば、
 *   1. 設定画面にアイコンを並べて「どの列が何か」を目で確認できる
 *   2. 画像 URL からアビリティ名を引ければ自動入力もできる
 * という 2 段階の改善につながる。
 *
 * HTML の regex パースは Google 側のマークアップ変更に弱いが、失敗しても
 * 「アイコンが出ないだけ」で従来の手入力に落ちる fail-soft。
 */

export type SheetImageCell = {
  /** 0 始まりの列番号 (colspan を加味した位置)。 */
  column: number;
  /** 画像 URL。 */
  src: string;
};

export type SheetImageRow = {
  /** 0 始まりの行番号 (HTML の tbody 内の並び)。 */
  row: number;
  cells: SheetImageCell[];
};

/** `<td ...>` の属性から colspan を読む (既定 1)。 */
function colspanOf(tdTag: string): number {
  const m = /colspan\s*=\s*"?(\d+)"?/i.exec(tdTag);
  if (!m) return 1;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * pubhtml / htmlview の HTML から「画像が入っているセル」を行ごとに拾う。
 *
 * Google の出力は `<tbody><tr><td ...>…</td>…</tr></tbody>` の素直な表で、
 * 行頭に行番号用の `<th>` が入る。列番号は td の出現順 (colspan 込み) で
 * 数えるため、CSV 側の列番号と一致する。
 */
export function parseSheetImageRows(html: string): SheetImageRow[] {
  const out: SheetImageRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  let rowIndex = 0;
  while ((trMatch = trRe.exec(html)) !== null) {
    const rowHtml = trMatch[1]!;
    const cells: SheetImageCell[] = [];
    let column = 0;
    const tdRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const attrs = tdMatch[1] ?? "";
      const body = tdMatch[2] ?? "";
      // 行番号の <th> は列に数えない (Google は行頭に必ず付ける)。
      const isRowHeader = /class="[^"]*\brow-headers-background\b/i.test(attrs);
      if (isRowHeader) continue;
      const img = /<img[^>]+src\s*=\s*"([^"]+)"/i.exec(body);
      if (img) cells.push({ column, src: decodeHtmlEntities(img[1]!) });
      column += colspanOf(attrs);
    }
    if (cells.length > 0) out.push({ row: rowIndex, cells });
    rowIndex += 1;
  }
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * 「アイコンが並んでいる行」を選ぶ。
 *
 * 軽減表はアビリティ欄の 1 行だけに大量のアイコンが並ぶ作りなので、
 * **画像が最も多い行** を採用する。2 個以上ないと誤検出しやすいので
 * その場合は null。
 */
export function pickIconRow(rows: SheetImageRow[]): SheetImageRow | null {
  let best: SheetImageRow | null = null;
  for (const r of rows) {
    if (r.cells.length < 2) continue;
    if (best === null || r.cells.length > best.cells.length) best = r;
  }
  return best;
}

/**
 * 画像 URL の同一性キー。
 *
 * 公式画像はサイズ違いやクエリ付きで参照されることがあるため、
 * **パスの最後のファイル名 (拡張子なし)** を鍵にする。Google が画像を
 * プロキシしている場合 (`/proxy?url=…`) は元 URL を取り出してから。
 */
export function iconKey(src: string): string | null {
  let url = src.trim();
  if (!url) return null;
  // Google 画像プロキシ経由なら元 URL を取り出す。
  try {
    const u = new URL(url, "https://docs.google.com");
    const inner = u.searchParams.get("url") ?? u.searchParams.get("q");
    if (inner) url = inner;
  } catch {
    // 相対 URL 等はそのまま扱う。
  }
  try {
    const u = new URL(url, "https://docs.google.com");
    const file = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const base = file.replace(/\.[a-z0-9]+$/i, "");
    return base || null;
  } catch {
    const file = url.split("?")[0]!.split("/").filter(Boolean).pop() ?? "";
    const base = file.replace(/\.[a-z0-9]+$/i, "");
    return base || null;
  }
}

/** 一覧ページからジョブ個別ページのパスを拾う (`/jobguide/paladin/` 等)。 */
export function extractJobPaths(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href="(\/jobguide\/[a-z]+\/)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1]!;
    // 一覧そのもの (battle) は対象外。
    if (path === "/jobguide/battle/" || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * ジョブページから「アイコンキー → アクション名」を拾う。
 *
 * ジョブガイドのアクション表は 1 行に `<img src=…>` と名前が入る作りなので、
 * **画像タグの直後 ~600 文字**に現れる最初の「タグに囲まれた日本語の短い
 * 文字列」を名前とみなす。厳密な構造に依存しないぶん取りこぼしはあるが、
 * 誤った名前を大量に作らないよう候補は保守的に絞る。
 */
export function extractIconNamePairs(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const imgRe = /<img[^>]+src\s*=\s*"([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1]!;
    // アクションアイコンは lds-img (公式 CDN) 配信。ロゴ等は除外。
    if (!/lds-img\.finalfantasyxiv\.com/i.test(src)) continue;
    const key = iconKey(src);
    if (!key) continue;
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const name = firstActionName(after);
    if (name) out.push([key, name]);
  }
  return out;
}

/**
 * タグに囲まれたテキストから「アクション名らしい最初の文字列」を拾う。
 * 日本語 (漢字/かな/カナ) を含み、24 文字以内、説明文らしい句読点を
 * 含まないものだけを採用する。
 */
function firstActionName(fragment: string): string | null {
  const re = />([^<>]{1,40})</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const text = m[1]!.replace(/\s+/g, " ").trim();
    if (!text || text.length > 24) continue;
    if (!/[぀-ヿ一-龯]/.test(text)) continue;
    // 説明文・見出し語は弾く。
    if (/[。、：:]/.test(text)) continue;
    if (/^(効果|範囲|詠唱|リキャスト|発動|習得|条件|種別|対象|威力)/.test(text)) {
      continue;
    }
    return text;
  }
  return null;
}

/** 列番号 → `A` / `AA` (診断表示用)。 */
export function letterOf(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** (シート, 行) 単位のアイコン候補。 */
export type IconCandidate = {
  sheet: string;
  row: number;
  cells: Array<{ column: number; src: string }>;
};

/**
 * チェック列との重なりが最大の候補を選ぶ。
 * 重なりが無い候補は**採用しない** (別シートの無関係なアイコンを掴むため)。
 */
export function pickBestCandidate(
  candidates: IconCandidate[],
  checkColumns: number[],
): { best: IconCandidate; overlap: number } | null {
  const set = new Set(checkColumns);
  let best: IconCandidate | null = null;
  let bestOverlap = 0;
  for (const c of candidates) {
    const overlap = c.cells.filter((x) => set.has(x.column)).length;
    if (overlap > bestOverlap) {
      best = c;
      bestOverlap = overlap;
    }
  }
  return best ? { best, overlap: bestOverlap } : null;
}
