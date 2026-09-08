/**
 * 残っている日本語文字列の分類と逆戻り防止 (2026-09-07)。
 * 実行: `node scripts/check-ja-strings.mjs [--list]`
 *
 * `src/` の **文字列リテラルと JSX テキスト** を AST で走査し、日本語を
 * 含むものを列挙する (コメントは対象外)。表示言語 (ja / en) 対応の第 1〜3 段
 * で画面の文言はほぼ辞書へ移したが、**移してはいけない日本語**が残る。
 * このスクリプトはそれを「分類済みの baseline」として固定し、
 *
 *   - baseline に無いファイルに日本語が入った
 *   - baseline のファイルで件数が増えた / 減った
 *
 * のいずれかで CI を落とす。第 3 段の直後は「意図的に残した 47 件」という
 * 数字だけがリリースノートに書かれている状態で、次に触る人が「これは
 * 訳し忘れか、意図か」を毎回コードから読み直す必要があった。分類と理由を
 * ここに 1 箇所で持ち、増減を機械で検出する。
 *
 * ## 自動で「対応済み」と判定するもの (baseline に載せない)
 *
 *   1. `locale` 引数を取る関数の中 (`url-validation.ts` / `attendance-ui.ts`
 *      のように、純関数モジュールが辞書を import せず引数で切り替える形)
 *   2. `locale` を条件に持つ三項 / if の中
 *   3. `FOO_JA` という名前の定数で、同じファイルに `FOO_EN` があるもの
 *
 * ## baseline の 6 分類
 *
 *   A. **DB に保存される値 / 突き合わせキー** — 日本語が正。訳すとデータが
 *      壊れる (`CategoryStatus` の "クリア済" 等)。
 *   B. **日本語側が正で、表示用の英語は別に持つ** — 既定値やキーとして
 *      日本語を保持し、描画時に locale 版へ差し替える。
 *   C. **Discord に送る文** — 送信先が日本語コミュニティの Discord。
 *      閲覧者の表示言語ではなく**サーバーの言語**に合わせる。
 *   D. **ゲーム内の固有名** — FF14 日本語クライアントの表記。英語表記は
 *      別物 (リプライザル = Reprisal) で、対応表を持たない限り訳せない。
 *   E. **運用者 / 開発者向け** — 環境変数の不足、OAuth 失敗、Provider 外
 *      使用の throw。閲覧者の画面には出ない (or 管理者だけ)。
 *   F. **誤検出** — 日本語を含むコード片など。
 */

import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 走査から外すファイル (辞書そのもの / データ / server 側)。 */
const EXCLUDE =
  /(\/dict\/|\/i18n\/|\/server\/|changelog|japanese-holidays|content-groups|mitigation-terms|\/themes\.ts|fflogs-sync-reason|sheet-icons\.ts|xivgear-set\.ts|supabase\/types\.ts|\.test\.)/;
const JA = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const ROOTS = ["src/app", "src/components", "src/lib"];

/**
 * 分類済み baseline。`count` は現在の検出件数。
 * 増えたら「訳し忘れかどうか」を判断して、意図的ならここを更新する。
 */
const BASELINE = [
  // ── A. DB に保存される値 / 突き合わせキー ───────────────────────────
  ["src/app/(portal)/page.tsx", 4, "A", "カテゴリ名の接頭辞 '絶' と CategoryStatus 'クリア済' での判定"],
  ["src/app/(portal)/category/category-list.tsx", 1, "A", "CategoryStatus 'クリア済' との比較"],
  ["src/app/(portal)/category/[slug]/videos/videos-list.tsx", 1, "A", "CategoryStatus 'クリア済' との比較"],
  ["src/components/portal/category-form-dialog.tsx", 2, "A", "CategoryStatus の既定値 '未着手'"],
  ["src/app/(portal)/category/[slug]/logs/logs-view.tsx", 1, "A", "DB に保存する除外理由 '誤取り込み' (表示言語に依らず固定)"],
  ["src/lib/loot-weekly.ts", 3, "A", "LOOT_WEEKLY_STATUSES = DB に入る値 (未消化 / 消化済 / 辞退)"],
  ["src/components/portal/loot-extras.tsx", 3, "A", "同じ値との比較 (アイコン / 未消化人数の集計)"],
  ["src/lib/supabase/loot-extras.ts", 3, "A", "同じ値の既定値 + ロスター外メンバーの表示名フォールバック"],
  ["src/lib/clear-detection.ts", 5, "A", "シートのタイトル / 層名の解析パターン"],
  ["src/lib/sheet-csv.ts", 5, "A", "Google Sheets の列見出しとの突き合わせ"],
  ["src/lib/schedule/parse.ts", 3, "A", "character-sheets の出力書式の解析 ('■コメント' 等)"],
  ["src/components/portal/native-schedule/candidate-date-dialog.tsx", 8, "A", "sync 互換の rawDate 書式 'yyyy/MM/dd(曜) HH:MM~HH:MM' を組む"],
  ["src/lib/link-tags.ts", 7, "A", "DB に保存するタグ label の候補 (既存タグと一致させる必要がある)"],

  // ── B. 日本語側が正で、表示用の英語は別に持つ ───────────────────────
  ["src/lib/schedule/attendance-ui.ts", 22, "B", "記号キーは character-sheets 側の値。ラベルは ATT_LABEL_DICT_EN と getAttendanceLabel(locale) で切替"],
  ["src/lib/schedule/attendance-summary.ts", 4, "A", "character-sheets の凡例の記号 (全 / 昼 / 夜 / 早) との突き合わせ。attendance-ui.ts の ATT_LABEL_DICT と同じキー"],
  ["src/lib/sub-tab-defs.ts", 6, "B", "SUB_TAB_DEFS.label は DB の custom label と突き合わせる既定値。表示は getSubTabDefs(locale)"],
  ["src/lib/link-site.ts", 10, "B", "LINK_SITE_LABEL / FF14_RESOURCE_LABEL は ja が正。表示は linkSiteLabel(locale) / *_EN"],

  // ── C. Discord に送る文 ─────────────────────────────────────────────
  ["src/lib/logs-notify.ts", 6, "C", "練習ログのイベント通知。送信先は日本語コミュニティの Discord"],
  ["src/lib/schedule/attendance-reminder-keys.ts", 1, "C", "出欠催促テンプレの既定文 (管理者が編集可能)"],
  ["src/lib/schedule/native-discord-template.ts", 1, "C", "活動予定通知テンプレの既定文 (管理者が編集可能)"],

  // ── D. ゲーム内の固有名 ─────────────────────────────────────────────
  ["src/components/portal/mitigation-columns-dialog.tsx", 16, "D", "軽減アビリティ名 (FF14 日本語クライアントの表記)"],

  // ── E. 運用者 / 開発者向け ──────────────────────────────────────────
  ["src/lib/supabase/env.ts", 3, "E", "環境変数の不足 (起動失敗時のみ)"],
  ["src/app/api/auth/fflogs/callback/route.ts", 3, "E", "OAuth 失敗 (管理者の FFLogs 連携時のみ)"],
  ["src/components/portal/confirm-dialog.tsx", 1, "E", "Provider 外使用の開発時 throw"],

  // ── F. 誤検出 ───────────────────────────────────────────────────────
  ["src/lib/fflogs-url.ts", 1, "F", "ブックマークレットの JS コード (日本語を含む文字列を生成する側)"],
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    // ⚠ パス区切りを `/` に正規化する。`join()` は Windows で `\` を返し、
    // そのままだと **EXCLUDE (`/\/server\//` 等) も BASELINE の
    // `src/lib/...` 表記もどちらにも一致しない** — 除外したいファイルが
    // 走査に入り、全ファイルが「baseline に無い」と報告されて手元では
    // 常に失敗する (CI の ubuntu では `/` なので通る)。
    const p = join(dir, name).split("\\").join("/");
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(name) && !EXCLUDE.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

/** locale 対応済みのスコープに居るか (docstring の 1〜3)。 */
function localeAware(node, sf, src) {
  for (let n = node; n; n = n.parent) {
    if (
      ts.isFunctionLike(n) &&
      n.parameters?.some(
        (p) => ts.isIdentifier(p.name) && /locale/i.test(p.name.text),
      )
    ) {
      return true;
    }
    if (ts.isConditionalExpression(n) && /\blocale\b/.test(n.condition.getText(sf))) return true;
    if (ts.isIfStatement(n) && /\blocale\b/.test(n.expression.getText(sf))) return true;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const base = n.name.text.replace(/_?JA$/, "");
      if (base !== n.name.text && new RegExp(`\\b${base}_?EN\\b`).test(src)) return true;
    }
  }
  return false;
}

const found = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const add = (node, text) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!JA.test(t)) return;
    if (localeAware(node, sf, src)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const list = found.get(file) ?? found.set(file, []).get(file);
    list.push(`${line + 1}: ${t.slice(0, 80)}`);
  };
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, n.text);
    else if (ts.isTemplateExpression(n)) {
      add(n, n.head.text);
      n.templateSpans.forEach((s) => add(s, s.literal.text));
    } else if (ts.isJsxText(n)) add(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

const expected = new Map(BASELINE.map(([f, c, g, r]) => [f, { c, g, r }]));

const unlisted = [...found.keys()].filter((f) => !expected.has(f));
check(
  "baseline に無いファイルに日本語文字列が無い",
  unlisted.length === 0,
  unlisted
    .map((f) => `${f} (${found.get(f).length})\n         ${found.get(f).slice(0, 5).join("\n         ")}`)
    .join("\n       ") +
    (unlisted.length
      ? "\n       → 画面に出る文言なら辞書 (src/lib/i18n/dict/) へ。意図的に日本語なら BASELINE に分類と理由を足す。"
      : ""),
);

const drifted = [];
for (const [file, { c }] of expected) {
  const actual = found.get(file)?.length ?? 0;
  if (actual !== c) drifted.push(`${file}: baseline ${c} → 実際 ${actual}`);
}
check(
  "baseline の件数と一致する",
  drifted.length === 0,
  drifted.join("\n       ") +
    (drifted.length
      ? "\n       → 増えたなら訳し忘れかを判断する。減った / 意図的に増えたなら BASELINE の数を直す。"
      : ""),
);

const total = [...found.values()].reduce((a, l) => a + l.length, 0);
console.log(
  `\n  分類済み: ${total} 件 / ${found.size} ファイル` +
    ` (A データ ${sum("A")} / B 日本語が正 ${sum("B")} / C Discord ${sum("C")}` +
    ` / D ゲーム内名 ${sum("D")} / E 運用者向け ${sum("E")} / F 誤検出 ${sum("F")})`,
);
function sum(group) {
  return BASELINE.filter(([, , g]) => g === group).reduce((a, [, c]) => a + c, 0);
}

if (process.argv.includes("--list")) {
  for (const [file, list] of [...found].sort()) {
    const e = expected.get(file);
    console.log(`\n${file} (${list.length})${e ? `  [${e.g}] ${e.r}` : "  [未分類]"}`);
    for (const l of list) console.log("  " + l);
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
