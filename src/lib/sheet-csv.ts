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

import { translateMitigationTerm } from "./mitigation-terms";

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
export function toSheetCsvUrl(
  raw: string | null | undefined,
  // 2026-08-30 (層タブ切替): シート内の別ワークシート (層) を取得する
  // ための gid 上書き。未指定なら URL 自身の gid (従来挙動)。
  overrideGid?: string | null,
): string | null {
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
    overrideGid ??
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

/** シート URL 自身に埋まっている gid (query / hash) を取り出す。 */
export function extractSheetGid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  return (
    u.searchParams.get("gid") ?? /(?:^|[#&])gid=(\d+)/.exec(u.hash)?.[1] ?? null
  );
}

/**
 * シートのワークシート一覧 (層タブ) の HTML を取得するための URL。
 * published 形は pubhtml、通常共有形は htmlview がタブ一覧
 * (`<li id="sheet-button-<gid>"><a>名前</a></li>`) を含む。
 */
export function toSheetTabListUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.hostname !== "docs.google.com") return null;
  const pub = /^\/spreadsheets\/d\/e\/([^/]+)\//.exec(u.pathname);
  if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pubhtml`;
  const doc = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(u.pathname);
  if (doc) return `https://docs.google.com/spreadsheets/d/${doc[1]}/htmlview`;
  return null;
}

export type SheetTab = { gid: string; name: string };

/**
 * 手動登録された層タブ (categories.mitigation_sheet_tabs) の JSON を読む
 * (2026-08-30)。
 *
 * 自動検出 (pubhtml / htmlview の parse) は Google 側のマークアップと
 * 公開設定に依存して当てにならないため、**登録があればそちらを正**とする。
 * 壊れた JSON や想定外の形は空配列 (= 自動検出にフォールバック)。
 */
export function parseSheetTabsSetting(raw: string | null | undefined): SheetTab[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: SheetTab[] = [];
    const seen = new Set<string>();
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const gid = typeof o.gid === "string" ? o.gid.trim() : String(o.gid ?? "");
      const name = typeof o.label === "string" ? o.label.trim() : "";
      if (!/^\d+$/.test(gid) || seen.has(gid)) continue;
      seen.add(gid);
      out.push({ gid, name: name || `シート${out.length + 1}` });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * pubhtml / htmlview の HTML からワークシートのタブ一覧を抜き出す。
 * どちらのビューもフッターのタブバーを
 * `<li id="sheet-button-<gid>" ...><a ...>シート名</a></li>` で描画する。
 * レイアウト変更に弱い regex 抽出だが、失敗しても [] を返すだけで
 * 呼び出し側 (層タブ UI) が非表示になるだけの fail-soft。
 */
export function parseSheetTabs(html: string): SheetTab[] {
  const out: SheetTab[] = [];
  const seen = new Set<string>();
  const re = /id="sheet-button-(\d+)"[^>]*>\s*<a[^>]*>([^<]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gid = m[1]!;
    if (seen.has(gid)) continue;
    seen.add(gid);
    const name = decodeBasicEntities(m[2]!.trim());
    out.push({ gid, name: name || `シート${out.length + 1}` });
  }
  return out;
}

/** タブ名に出うる範囲の最小限の HTML エンティティ復号。 */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
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

export type SheetCardStat = {
  /**
   * 表示ラベル。**シートの実際の列見出し**をそのまま使う (2026-08-30 実機
   * 報告「軽減率が 2 つ存在して分かりにくい」)。以前は種別名 (ダメージ /
   * 軽減率 / 最終) を出していたため、別の列が同じ名前で並んで区別できな
   * かった。種別は色分けだけに使う。
   */
  label: string;
  value: string;
  kind: "damage" | "rate" | "final";
};

/** チェックボックス列で ON になっていた項目 (2026-08-30)。 */
export type SheetCardCheck = {
  /** 列の見出し (アビリティ名など)。 */
  label: string;
  /** その列を「誰の列か」に紐づけられた場合の担当 (無ければ null)。 */
  owner: string | null;
};

export type SheetCardRow = {
  heading: string;
  cells: Array<{ label: string; value: string }>;
  /** mitigation モードのみ: チェックが入っていた列 (誰が何を入れるか)。 */
  checks?: SheetCardCheck[];
  /** mitigation モードのみ: ダメージ → 軽減率 → 最終ダメージの数値サマリ。 */
  stats?: SheetCardStat[];
  /** mitigation モードのみ: 対象 (味方の誰に入れるか等)。 */
  target?: string;
};

/**
 * カードに載せる価値の無いセル値の判定。
 *   - 空文字 / 記号だけ (「-」「ー」「...」等はテンプレの埋め草)
 *   - 装飾記号の連続 (「◇◇◇」等。単独の「○」は担当マークの可能性が
 *     あるので残す)
 *   - チェックボックスの内部値 (TRUE / FALSE)。条件付き書式やフラグ用の
 *     列で、テキストとしては意味を持たない
 */
export function isNoiseValue(v: string): boolean {
  if (v === "") return true;
  if (/^[-–—ー―・.。\s]+$/.test(v)) return true;
  // 「担当なし」を意味する値。カードに並べても情報が無く、実機では
  // 「無し」だけのチップが 1 行に何個も並んでいた (2026-08-31)。
  if (/^(無し|なし|ナシ|不要|none|n\/?a)$/i.test(v.trim())) return true;
  if (/^[◇◆□■☆★▲△▼▽○●◎~〜*＊]{2,}$/.test(v)) return true;
  return /^(?:true|false)$/i.test(v);
}

/**
 * カードの見出しに合成する構造列 (タイムライン型軽減表の
 * フェーズ / 時刻 / 技名)。見出し行の表記ゆれをある程度吸収する。
 */
const STRUCTURAL_HEADER_RE =
  /^(?:phase|time|action|mechanic|ability|attack|skill|フェーズ|時間|タイム|時刻|技名?|攻撃名?|ギミック|アクション|スキル)$/i;

/** 数値 (カンマ・小数点・% 込み) だけのセル値か。 */
function isNumericValue(v: string): boolean {
  return /^[-+]?[\d,.]+%?$/.test(v);
}

// ---- mitigation モード (2026-08-30) --------------------------------------
// ユーザー要望「AA を除く攻撃とダメージ値、入れる軽減・デバフ・対象、
// 軽減率と最終ダメージ値で簡素に」。汎用モードは計算列を丸ごと落とすが、
// mitigation モードでは見出しキーワードで「素ダメージ / 軽減率 / 最終
// ダメージ / 対象」の列だけ拾い上げてサマリ表示に回す。

/** AA (オートアタック) 行の判定。見出し / 技名セルに対して使う。 */
const AA_ATTACK_RE =
  /(?:^|[^A-Za-z])(?:AA|ＡＡ)(?:[^A-Za-z]|$)|オート\s*[・･]?\s*アタック|auto[\s-]*attack/i;

// 判定順が重要: 「最終ダメージ」は DAMAGE にもマッチするため FINAL を先に。
const MIT_FINAL_HEADER_RE =
  /最終|軽減後|実効?ダメ|残り?ダメ|着弾|after|final/i;
const MIT_RATE_HEADER_RE =
  /軽減率|軽減\s*[%％]|カット率?|総軽減|mitigat|reduction/i;
const MIT_DAMAGE_HEADER_RE =
  /ダメージ|被ダメ|素ダメ|無軽減|damage|^dmg$/i;
const MIT_TARGET_HEADER_RE = /対象|ターゲット|target|誰に/i;

type MitColumnKind = "final" | "rate" | "damage" | "target" | null;

/** チェックボックスの ON 値 (Google Sheets の CSV は TRUE/FALSE)。 */
function isCheckedValue(v: string): boolean {
  return /^(?:true|✓|✔|◯|○|●|1|yes)$/i.test(v.trim());
}

/** チェックボックスの OFF 値。 */
function isUncheckedValue(v: string): boolean {
  return /^(?:false|0|no|)$/i.test(v.trim());
}

function classifyMitigationHeader(header: string): MitColumnKind {
  const h = header.trim();
  if (h === "") return null;
  if (STRUCTURAL_HEADER_RE.test(h)) return null;
  if (MIT_FINAL_HEADER_RE.test(h)) return "final";
  if (MIT_RATE_HEADER_RE.test(h)) return "rate";
  if (MIT_TARGET_HEADER_RE.test(h)) return "target";
  if (MIT_DAMAGE_HEADER_RE.test(h)) return "damage";
  return null;
}

/**
 * 行 → カードデータ。タイムライン型の軽減表テンプレート (チェックボックス
 * 列・軽減率やバリア量の計算列・SPARKLINE 用の HP 数値列を多数持つ) を
 * そのままカード化すると「(無題) / FALSE / 1.00 の羅列」になり意味を失う
 * (2026-08-28 実機報告)。カードで伝えるべきは **時間軸・攻撃・誰が何の
 * 軽減を出すか** なので:
 *   - ノイズセル (`isNoiseValue`) と見出しと同文のセル (見出し行の繰り返し)
 *     は落とす
 *   - **計算列** (非空値が全て数値の列。HEAL BUFF 1.00 / TOTAL DAMAGE 等)
 *     は列ごと落とす。ただし誤爆防止のため、そうした列が 3 本以上ある
 *     計算機型シートでのみ発動 (ロット表の優先度列 1 本などは残す)
 *   - **構造列** (PHASE / TIME / ACTION 系) の値はカード見出しに合成する
 *     (「開幕 00:00 戦闘開始!」)。残るセルは「担当: 軽減」だけになる
 *   - 見出しが決まらない行は最初の有効セルを見出しに昇格
 *   - それでも中身が残らない行はカード自体を出さない
 */
export function buildSheetCardRows(
  table: SheetTable,
  visibleColumns: number[],
  opts?: {
    /**
     * 軽減表モード (2026-08-30): AA 行を除外し、素ダメージ / 軽減率 /
     * 最終ダメージ / 対象の列を数値サマリ (`stats` / `target`) として
     * 拾い上げる。それらの列は計算列 drop の対象から外れる。
     */
    mitigation?: boolean;
    /**
     * 列番号 → 表示名の手動登録 (2026-08-30 実機報告)。
     *
     * 軽減表のチェックボックス列は見出しがアイコン画像のことが多く、CSV に
     * 文字が 1 文字も出ない = 名前の付けようが無い。自動では諦めるしかない
     * ので、admin が列に名前を付けられるようにして、その名前で表示する。
     */
    columnLabels?: Record<number, string>;
    /**
     * カードにしない行 (table.rows のインデックス)。
     * ジョブ名 / アビリティ名 / 対象種別の見出し 3 行は攻撃ではないので、
     * カードとして並べると意味の無い行が混ざる (2026-08-31)。
     */
    ignoreRows?: ReadonlySet<number>;
  },
): SheetCardRow[] {
  const mitigation = opts?.mitigation === true;
  const columnLabels = opts?.columnLabels ?? {};
  const ignoreRows = opts?.ignoreRows;
  // mitigation モード: 列の役割を見出しで分類 (final/rate/damage/target)。
  const mitKindByCol = new Map<number, MitColumnKind>();
  if (mitigation) {
    for (const ci of visibleColumns) {
      mitKindByCol.set(ci, classifyMitigationHeader(table.headers[ci] ?? ""));
    }
  }

  // 2026-08-30 実機要望「誰がどのデバフ・バフを入れるか見えない」:
  // 軽減表は「行 = 攻撃」「列 = 軽減/バフ」でチェックボックスを立てる形式が
  // 多い。CSV では TRUE/FALSE になり、従来は isNoiseValue で捨てていたため
  // カードから完全に消えていた。**チェックボックス列** (非空値がすべて
  // TRUE/FALSE の列) を検出し、ON の列の見出しを「入れるもの」として拾う。
  //
  // 見出しが空の列 (アイコン画像だけの列は CSV に文字が出ない) は、その列に
  // 一度でも現れた「TRUE/FALSE 以外の値」をラベル候補として使う。それも
  // 無ければラベル不明として捨てる (意味の無い印を並べても読めないため)。
  // 2026-08-30 実機情報「26 行目の各アビリティの列に名前が書かれている」:
  // 軽減表テンプレートは「見出し行 = アイコン」「その次の行 = アビリティ名」
  // という 2 段組みが多い。CSV では 2 行目以降がデータ扱いになるため、
  // **チェック列に名前を供給している行**を探して見出しの代わりに使う。
  //
  // 探し方: チェック列 (TRUE/FALSE が入る列) に文字列が入っている行を数え、
  // 最も多くの列に名前を与えている行を「名前の行」とみなす。2 列以上を
  // 満たす行が無ければ諦める (たまたま 1 セルだけ文字が入っている行を
  // 名前の行と誤認しないため)。
  const labelRow = mitigation ? detectCheckLabelRow(table, visibleColumns) : null;

  const checkboxCols = new Map<number, string>();
  if (mitigation) {
    for (const ci of visibleColumns) {
      if (mitKindByCol.get(ci)) continue;
      const header = table.headers[ci]?.trim() ?? "";
      let checked = 0;
      const others = new Set<string>();
      for (const row of table.rows) {
        const v = (row[ci] ?? "").trim();
        if (v === "" || v === header) continue;
        if (isCheckedValue(v)) {
          checked += 1;
          continue;
        }
        if (isUncheckedValue(v)) continue;
        others.add(v);
      }
      // 1 つも ON が無い列は出しても意味が無い。
      if (checked === 0) continue;
      // ラベルの優先順:
      //   1. 手動登録 (人の指定を最優先)
      //   2. 名前の行 (26 行目のようなアビリティ名の段)
      //   3. 見出し行
      //   4. その列に 1 種類だけ現れる文字列
      const manual = columnLabels[ci]?.trim();
      const fromLabelRow = labelRow
        ? (table.rows[labelRow.rowIndex]?.[ci] ?? "").trim()
        : "";
      if (manual && isUsableCheckLabel(manual)) {
        checkboxCols.set(ci, manual);
        continue;
      }
      // 名前の行に TRUE/FALSE が残っている列がある。そのまま採ると
      // `✓ FALSE` というチップになるので弾く。
      if (isUsableCheckLabel(fromLabelRow)) {
        checkboxCols.set(ci, fromLabelRow);
        continue;
      }
      if (header && isUsableCheckLabel(header)) {
        // 見出しがある列は「TRUE/FALSE だけ」を要求する。担当者名などが
        // 混ざる通常列を奪うと「担当: スキル」の表示が消えてしまう。
        if (others.size > 0) continue;
        checkboxCols.set(ci, header);
        continue;
      }
      // 見出しが空の列 (アイコン画像だけの列は CSV に文字が出ない)。
      // 別行にアビリティ名が 1 種類だけ書かれている作りが多いので、それを
      // ラベルとして採用する。2 種類以上あるなら通常のデータ列とみなす。
      if (others.size !== 1) continue;
      const fallbackLabel = [...others][0]!;
      if (!isUsableCheckLabel(fallbackLabel)) continue;
      checkboxCols.set(ci, fallbackLabel);
    }
  }

  // 計算列の検出 (列単位・テーブル全体で判定)。
  const numericCols = new Set<number>();
  for (const ci of visibleColumns) {
    if (STRUCTURAL_HEADER_RE.test(table.headers[ci]?.trim() ?? "")) continue;
    // mitigation モードでサマリに回す列は drop 判定から除外 (ダメージ値
    // こそ見たい、というのが今回の要望)。
    if (mitigation && mitKindByCol.get(ci)) continue;
    const header = table.headers[ci]?.trim() ?? "";
    let hasValue = false;
    let allNumeric = true;
    for (const row of table.rows) {
      const v = (row[ci] ?? "").trim();
      // 見出しと同文のセルはフェーズごとの見出し行の繰り返し。数値列の
      // 判定を汚染する (列名は数値でない) のでスキップする。
      if (v === "" || v === header || isNoiseValue(v)) continue;
      hasValue = true;
      if (!isNumericValue(v)) {
        allNumeric = false;
        break;
      }
    }
    if (hasValue && allNumeric) numericCols.add(ci);
  }
  const dropNumericCols = numericCols.size >= 3;

  const out: SheetCardRow[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    // 名前の行は見出しの一部なのでカードにしない。
    if (labelRow && rowIndex === labelRow.rowIndex) continue;
    // ジョブ名 / アビリティ名 / 対象種別の 3 行も見出しなので除く。
    if (ignoreRows?.has(rowIndex)) continue;
    const row = table.rows[rowIndex]!;
    const headingParts: string[] = [];
    const rowHeading = (row[0] ?? "").trim();
    if (!isNoiseValue(rowHeading)) headingParts.push(rowHeading);

    // mitigation サマリ列は cells から分離して stats / target へ。
    const stats: SheetCardStat[] = [];
    let target: string | undefined;
    if (mitigation) {
      // 表示順はユーザー指定の「ダメージ → 軽減率 → 最終」に固定。
      for (const kind of ["damage", "rate", "final"] as const) {
        for (const ci of visibleColumns) {
          if (mitKindByCol.get(ci) !== kind) continue;
          const v = (row[ci] ?? "").trim();
          const header = table.headers[ci]?.trim() ?? "";
          if (isNoiseValue(v) || v === header) continue;
          // ラベルはシートの列見出しをそのまま使う (種別名だと「軽減率」が
          // 2 つ並ぶ、という実機報告への対応)。見出しが無い列だけ種別名で補う。
          const label = translateMitigationTerm(
            columnLabels[ci]?.trim() ||
              header ||
              (kind === "damage" ? "ダメージ" : kind === "rate" ? "軽減率" : "最終"),
          );
          // 同じラベル + 同じ値が二重に出ないように畳む。
          if (stats.some((x) => x.label === label && x.value === v)) continue;
          stats.push({ label, value: v, kind });
        }
      }
      for (const ci of visibleColumns) {
        if (mitKindByCol.get(ci) !== "target") continue;
        const v = (row[ci] ?? "").trim();
        if (isNoiseValue(v) || v === (table.headers[ci]?.trim() ?? "")) continue;
        target = target === undefined ? v : `${target} / ${v}`;
      }
    }

    const checks: SheetCardCheck[] = [];
    if (mitigation) {
      for (const [ci, label] of checkboxCols) {
        if (isCheckedValue(row[ci] ?? "")) {
          checks.push({ label, owner: null });
        }
      }
    }

    let cells = visibleColumns
      .filter((ci) => !(dropNumericCols && numericCols.has(ci)))
      .filter((ci) => !(mitigation && mitKindByCol.get(ci)))
      .filter((ci) => !checkboxCols.has(ci))
      .map((ci) => {
        const rawLabel = table.headers[ci]?.trim() ?? "";
        const rawValue = row[ci]?.trim() ?? "";
        // 定型語だけ日本語にする (技名・担当者名は触らない)。
        return mitigation
          ? {
              label: translateMitigationTerm(rawLabel),
              value: translateMitigationTerm(rawValue),
            }
          : { label: rawLabel, value: rawValue };
      })
      .filter((c) => !isNoiseValue(c.value) && c.value !== c.label);

    // 構造列 (フェーズ / 時刻 / 技名) は見出しに合成。
    const structural = cells.filter((c) => STRUCTURAL_HEADER_RE.test(c.label));
    if (structural.length > 0) {
      for (const c of structural) headingParts.push(c.value);
      cells = cells.filter((c) => !STRUCTURAL_HEADER_RE.test(c.label));
    }
    // 見出しと同じ値の無名セル (TIME の重複列など) は落とす。
    cells = cells.filter((c) => !headingParts.includes(c.value));

    if (headingParts.length === 0 && cells.length > 0) {
      headingParts.push(cells[0]!.value);
      cells = cells.slice(1);
    }

    // mitigation: AA (オートアタック) 行は要らない (ユーザー指定)。
    if (mitigation && headingParts.some((p) => AA_ATTACK_RE.test(p))) continue;

    if (
      headingParts.length === 0 &&
      cells.length === 0 &&
      checks.length === 0 &&
      stats.length === 0 &&
      target === undefined
    )
      continue;
    out.push({
      heading: headingParts.join(" "),
      cells,
      ...(checks.length > 0 ? { checks } : {}),
      ...(stats.length > 0 ? { stats } : {}),
      ...(target !== undefined ? { target } : {}),
    });
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

/** 列の役割 (診断表示・手動登録の UI 用)。 */
export type SheetColumnDiagnostic = {
  /** 0 始まりの列番号。 */
  index: number;
  /** スプレッドシートの列記号 (A, B, ..., AA)。 */
  letter: string;
  /** CSV から読めた見出し (アイコンだけの列は空)。 */
  header: string;
  /**
   * 自動判定した役割:
   *   damage/rate/final/target … 数値サマリに使う列
   *   check … チェックボックス列 (TRUE/FALSE のみ)
   *   text … 通常のデータ列 (担当者名など)
   *   empty … 中身が無い
   */
  role: "damage" | "rate" | "final" | "target" | "check" | "text" | "empty";
  /** ON になっている行数 (check のみ)。 */
  checkedCount: number;
  /** 中身のサンプル (最大 3 件)。 */
  samples: string[];
  /**
   * その列がチェックされている行の「攻撃名」(最大 4 件)。
   *
   * 2026-08-30 実機情報: アビリティ名はシート上アイコン画像で、CSV には
   * 文字が出ない = 自動では列の正体が分からない。代わりに **どの攻撃で
   * 使われているか** を見せれば、人間は列の正体を特定できる
   * (例: キング・オブ・アルカディア等で ON → 牽制だな、と判断できる)。
   */
  checkedOn: string[];
};

/** 0 始まりの列番号 → スプレッドシートの列記号。 */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * 各列が何と判定されているかを返す (2026-08-30 実機報告
 * 「どのことを指しているのか / それ以外は情報なし」)。
 *
 * 軽減表の作りは固定ごとに違い、こちらから中身を見に行けないので、
 * **アプリが何をどう解釈したかをそのまま見せる**。これが無いと
 * 「出ない」原因が列見出しなのか値なのか切り分けられない。
 */
export function diagnoseSheetColumns(
  table: SheetTable,
  /**
   * 判定から除く行 (table.rows のインデックス)。
   * ジョブ名 / アビリティ名 / 対象種別の見出し 3 行を数えてしまうと、
   * チェックボックス列が「文字列の列」に化けて拾えなくなる (2026-08-31)。
   */
  ignoreRows?: ReadonlySet<number>,
): SheetColumnDiagnostic[] {
  const out: SheetColumnDiagnostic[] = [];
  const body = ignoreRows
    ? table.rows.filter((_, i) => !ignoreRows.has(i))
    : table.rows;
  // 「どの攻撃で使われているか」を出すための攻撃名の列を選ぶ。
  const actionCol = findActionColumn(table);
  for (let ci = 0; ci < table.headers.length; ci++) {
    const header = (table.headers[ci] ?? "").trim();
    const samples: string[] = [];
    let checked = 0;
    let nonBoolean = 0;
    let filled = 0;
    for (const row of body) {
      const v = (row[ci] ?? "").trim();
      if (v === "") continue;
      filled += 1;
      if (isCheckedValue(v)) {
        checked += 1;
        continue;
      }
      if (isUncheckedValue(v)) continue;
      nonBoolean += 1;
      if (samples.length < 3 && !samples.includes(v)) samples.push(v);
    }
    const kind = classifyMitigationHeader(header);
    const role: SheetColumnDiagnostic["role"] =
      kind ??
      (filled === 0
        ? "empty"
        : nonBoolean === 0 && checked > 0
          ? "check"
          : "text");
    // チェックが入っている行の攻撃名 (列の正体を人が特定するための手がかり)。
    const checkedOn: string[] = [];
    if (role === "check" && actionCol !== null) {
      for (const row of body) {
        if (!isCheckedValue((row[ci] ?? "").trim())) continue;
        const action = (row[actionCol] ?? "").trim();
        if (!action || checkedOn.includes(action)) continue;
        checkedOn.push(action);
        if (checkedOn.length >= 4) break;
      }
    }

    out.push({
      index: ci,
      letter: columnLetter(ci),
      header,
      role,
      checkedCount: checked,
      samples,
      checkedOn,
    });
  }
  return out;
}

/**
 * 列名の手動登録 (categories.mitigation_column_labels) の JSON を読む。
 * 形は `{ "<gid>": { "<列番号>": "名前" } }`。gid ごとに列構成が違うため
 * シート (層) 単位で保持する。
 */
export function parseColumnLabelsSetting(
  raw: string | null | undefined,
  gid: string | null,
): Record<number, string> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const byGid = (v as Record<string, unknown>)[gid ?? ""] ?? {};
    if (!byGid || typeof byGid !== "object" || Array.isArray(byGid)) return {};
    const out: Record<number, string> = {};
    for (const [k, label] of Object.entries(byGid as Record<string, unknown>)) {
      const idx = Number.parseInt(k, 10);
      if (Number.isInteger(idx) && typeof label === "string" && label.trim()) {
        out[idx] = label.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * チェック列に名前を供給している行を探す (2026-08-30)。
 *
 * 軽減表テンプレートは「見出し行にアイコン → 次の行にアビリティ名」という
 * 2 段組みが多く、CSV に落とすとアイコン行は空になる。名前の段を見つけて
 * 見出しの代わりに使えるようにする。
 *
 * 判定: チェック列 (TRUE/FALSE が入る列) に文字列が入っている行のうち、
 * 最も多くの列に名前を与えている行。2 列以上に名前を与える行が無ければ
 * null (誤認を避ける)。
 */
/**
 * チェック列のラベルとして使える文字列か (2026-08-31 実機「✓FALSE が並ぶ」)。
 *
 * 「名前の行」から値をそのまま取っていたため、その行に TRUE/FALSE が
 * 残っている列で `✓ FALSE` というチップが出ていた。ラベルは人が読むもの
 * なので、真偽値・数値・極端に長い文字列は採用しない。
 */
function isUsableCheckLabel(v: string): boolean {
  const t = v.trim();
  if (t.length === 0 || t.length > 30) return false;
  if (isCheckedValue(t) || isUncheckedValue(t)) return false;
  if (isNumericValue(t)) return false;
  return true;
}

function detectCheckLabelRow(
  table: SheetTable,
  visibleColumns: number[],
): { rowIndex: number; count: number } | null {
  // まず「チェック列らしい列」を粗く拾う (名前の行の文字列は無視して数える)。
  const candidates: number[] = [];
  for (const ci of visibleColumns) {
    let checked = 0;
    for (const row of table.rows) {
      const v = (row[ci] ?? "").trim();
      if (isCheckedValue(v)) checked += 1;
    }
    if (checked > 0) candidates.push(ci);
  }
  if (candidates.length < 2) return null;

  let best: { rowIndex: number; count: number } | null = null;
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]!;
    let count = 0;
    for (const ci of candidates) {
      const v = (row[ci] ?? "").trim();
      if (v === "" || isCheckedValue(v) || isUncheckedValue(v)) continue;
      count += 1;
    }
    if (count >= 2 && (best === null || count > best.count)) {
      best = { rowIndex: r, count };
    }
  }
  return best;
}

/**
 * 「攻撃名」の列を推定する (2026-08-30)。見出しが Action / 攻撃 / 技名 の
 * いずれかならその列、無ければ **文字列が最も多く入っている列** を使う
 * (軽減表は左側に時刻と技名が並ぶ作りが定番)。
 */
function findActionColumn(table: SheetTable): number | null {
  for (let ci = 0; ci < table.headers.length; ci++) {
    if (/^(action|ability|攻撃名?|技名?|ギミック)$/i.test(
      (table.headers[ci] ?? "").trim(),
    )) {
      return ci;
    }
  }
  let best: { index: number; count: number } | null = null;
  for (let ci = 0; ci < table.headers.length; ci++) {
    let count = 0;
    for (const row of table.rows) {
      const v = (row[ci] ?? "").trim();
      if (!v || isCheckedValue(v) || isUncheckedValue(v)) continue;
      // 数値だけのセルは技名ではない。
      if (/^[-+]?[\d,.]+%?$/.test(v)) continue;
      count += 1;
    }
    if (count > 0 && (best === null || count > best.count)) {
      best = { index: ci, count };
    }
  }
  return best ? best.index : null;
}

/**
 * 軽減表の「アビリティ名の見出し行」を探す (2026-08-31、実データ解析)。
 *
 * ## 経緯
 *
 * アビリティ欄はアイコン画像なので CSV には出ない、と考えて画像から名前を
 * 逆算しようとしていた。実物の xlsx を解析したところ、アイコンのセルは
 *
 *   =INDEX(Skill!$D:$D, MATCH(<その列>$4, Skill!$C:$C, 0))
 *
 * すなわち **「その列の 4 行目に書かれたアビリティ名」でアイコンを引いて
 * いる**だけだった。名前はプレーンテキストで存在し、CSV にも出る。
 * 画像解析は不要 (かつ不正確) で、この行を読むのが正しい。
 *
 * ## 見つけ方
 *
 * この手のテンプレートは「ジョブ名 / アビリティ名 / 対象種別」が 3 行
 * 並ぶ。対象種別は `SELF` `RANGE_PARTY` のような固定語なので**最も
 * 見分けやすい**。それを見つけて 1 つ上をアビリティ行、2 つ上をジョブ行と
 * する。固定語が無いシート向けに、チェック列に短い文字列が最も多く並ぶ行を
 * 選ぶ経路も残す。
 */
export type AbilityHeaderRows = {
  /** grid (headers を 0 行目とする) におけるアビリティ名の行。 */
  abilityRow: number;
  /** その 1 つ上のジョブ名の行 (無ければ null)。 */
  jobRow: number | null;
  /** 対象種別の行 (無ければ null)。 */
  targetRow: number | null;
};

/** 軽減表テンプレートの対象種別に使われる固定語。 */
const TARGET_TOKEN =
  /^(SELF|PARTY|ENEMY|NONE|AREA_PARTY|RANGE_PARTY|SINGLE_PARTY|RANGE_ENEMY|SINGLE_ENEMY)$/;

/** 見出し行を探す走査範囲。表の本体まで踏み込まない。 */
const HEADER_SCAN_ROWS = 24;

function looksLikeAbilityName(v: string): boolean {
  const t = v.trim();
  if (t.length < 2 || t.length > 24) return false;
  if (/^(TRUE|FALSE)$/i.test(t)) return false;
  if (TARGET_TOKEN.test(t)) return false;
  // 数値・割合・時刻は名前ではない。
  if (/^[-+]?[\d.,]+%?$/.test(t)) return false;
  if (/^\d{1,2}:\d{2}/.test(t)) return false;
  return true;
}

export function findAbilityHeaderRows(
  grid: string[][],
  checkColumns: number[],
): AbilityHeaderRows | null {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);

  // 1) 対象種別の行を探す (最も特徴的)。
  for (let r = 1; r < limit; r++) {
    const row = grid[r]!;
    let hits = 0;
    for (const v of row) if (TARGET_TOKEN.test(v.trim())) hits += 1;
    if (hits < 4) continue;
    const abilityRow = r - 1;
    const names = grid[abilityRow]?.filter(looksLikeAbilityName).length ?? 0;
    if (names < 3) continue;
    return {
      abilityRow,
      jobRow: abilityRow - 1 >= 0 ? abilityRow - 1 : null,
      targetRow: r,
    };
  }

  // 2) 固定語が無いシート: チェック列に短い文字列が最も多い行。
  if (checkColumns.length === 0) return null;
  let best = -1;
  let bestHits = 0;
  for (let r = 0; r < limit; r++) {
    const row = grid[r]!;
    let hits = 0;
    for (const c of checkColumns) {
      if (looksLikeAbilityName(row[c] ?? "")) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = r;
    }
  }
  if (best < 0 || bestHits < 3) return null;
  return { abilityRow: best, jobRow: null, targetRow: null };
}

export type AutoColumnLabel = {
  /** アビリティ名 (例: 牽制)。 */
  name: string;
  /** ジョブ名 (例: 忍者)。取れなければ null。 */
  job: string | null;
};

/** 見出し行から「列番号 → アビリティ名 + ジョブ」を作る。 */
export function buildAutoColumnLabels(
  grid: string[][],
  rows: AbilityHeaderRows,
): Record<number, AutoColumnLabel> {
  const names = grid[rows.abilityRow] ?? [];
  const jobs = rows.jobRow !== null ? (grid[rows.jobRow] ?? []) : [];
  const out: Record<number, AutoColumnLabel> = {};
  for (let c = 0; c < names.length; c++) {
    const name = (names[c] ?? "").trim();
    if (!looksLikeAbilityName(name)) continue;
    const job = (jobs[c] ?? "").trim();
    // 「hide」等の制御用の値をジョブ名として出さない。
    out[c] = {
      name,
      job: job && job !== "hide" && looksLikeAbilityName(job) ? job : null,
    };
  }
  return out;
}
