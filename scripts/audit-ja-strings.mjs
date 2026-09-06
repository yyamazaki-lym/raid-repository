/**
 * 表示言語対応の残件チェック (2026-09-07)。tsx / ts の **文字列リテラルと JSX
 * テキスト** に日本語が残っている箇所を列挙する (コメントは対象外)。
 * 実行: `node scripts/audit-ja-strings.mjs [path...]`
 * データ (辞書 / 祝日 / 分類器 / server 側) は除外する。
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EXCLUDE = /(\/dict\/|\/i18n\/|\/server\/|changelog|japanese-holidays|content-groups|mitigation-terms|\/themes\.ts|fflogs-sync-reason|sheet-icons\.ts|xivgear-set\.ts|supabase\/types\.ts|\.test\.)/;
const JA = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["src/app", "src/components", "src/lib"];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(tsx?|mts)$/.test(f) && !EXCLUDE.test(p)) files.push(p); } };
roots.forEach(walk);
const hits = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (node, text) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!JA.test(t)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    (hits.get(file) ?? hits.set(file, []).get(file)).push(`${line + 1}: ${t.slice(0, 90)}`);
  };
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, n.text);
    else if (ts.isTemplateExpression(n)) { add(n, n.head.text); n.templateSpans.forEach((s) => add(s, s.literal.text)); }
    else if (ts.isJsxText(n)) add(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
let total = 0;
for (const [f, list] of [...hits.entries()].sort((a, b) => b[1].length - a[1].length)) {
  total += list.length;
  console.log(`\n${f} (${list.length})`);
  for (const l of list) console.log("  " + l);
}
console.log(`\n${total} string(s) in ${hits.size} file(s)`);
