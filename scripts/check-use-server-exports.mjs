/**
 * `"use server"` ファイルの export が async 関数だけであることの検査
 * (2026-09-08)。
 * 実行: `node scripts/check-use-server-exports.mjs [--list]`
 *
 * ## なぜ要るのか
 *
 * `"use server"` を持つファイルは **async 関数以外を export できない**。
 * Next はこれを `invalid-use-server-value` として**モジュール評価の時点で
 * throw** するので、1 つ混ざるだけでそのファイルを含む Server Action の束が
 * 丸ごと読み込めなくなり、**関係する画面の設定の読み書きが全部失敗**する。
 *
 * 2026-09-08 に実際に起きた (L-3):
 *
 *   - `native-schedule-actions.ts` に `export const BULK_CANDIDATE_MAX`
 *     (数値、参照 0) が入った
 *   - 実機で「設定 → 練習ログの通知の発見元がどれも選び直せない」になった
 *   - 本番の runtime エラーに 24 件 (routes `/` と
 *     `/category/[slug]/logs`)。**ESLint も `tsc --noEmit` も本番ビルドも
 *     通っていた**ので、実行時まで誰も気付けなかった
 *
 * 型でも lint でも本番ビルドでも捕まらない = **この検査以外に止める場所が
 * 無い**。だから 1 件でも見つけたら CI を落とす。
 *
 * ## 何を許すか
 *
 *   - `export async function foo() {}`
 *   - `export const foo = async () => {}` (async の関数式 / アロー)
 *   - `export type` / `export interface` / `import type` (型は実行時に消える)
 *
 * ## 何を弾くか
 *
 *   - 非 async の `export const` / `let` / `var` (数値・文字列・オブジェクト
 *     ・同期関数)
 *   - 非 async の `export function` / `export class`
 *   - `export { ... }` の再 export と `export * from` (何が出るか静的に
 *     追えないので、`"use server"` ファイルでは一律禁止する)
 *
 * 上限などの定数が UI から要るときは、**純モジュール側に置いて直接
 * import する** (例: `recurring-frames.ts` の `RECURRING_MAX_DATES`)。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOTS = ["src"];
const LIST = process.argv.includes("--list");

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(name)) files.push(p);
  }
};
ROOTS.forEach(walk);

/** ファイル先頭の `"use server"` ディレクティブを持つか。 */
function hasUseServerDirective(sf) {
  for (const stmt of sf.statements) {
    if (
      !ts.isExpressionStatement(stmt) ||
      !ts.isStringLiteral(stmt.expression)
    ) {
      // ディレクティブは先頭の文字列文だけ。実コードが来たら打ち切る。
      break;
    }
    if (stmt.expression.text === "use server") return true;
  }
  return false;
}

const hasExportModifier = (node) =>
  node.modifiers?.some((mo) => mo.kind === ts.SyntaxKind.ExportKeyword) ??
  false;
const hasAsyncModifier = (node) =>
  node.modifiers?.some((mo) => mo.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

/** async の関数式 / アロー関数か (`export const f = async () => {}`)。 */
function isAsyncFunctionInitializer(init) {
  if (!init) return false;
  if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) return false;
  return hasAsyncModifier(init);
}

const serverFiles = [];
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (!hasUseServerDirective(sf)) continue;
  // BASELINE と同じ表記に寄せる (Windows の \ を / に正規化)。
  const rel = file.split("\\").join("/");
  serverFiles.push(rel);

  const flag = (node, what) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    offenders.push({ file: rel, line: line + 1, what });
  };

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      // `export { a, b }` / `export * from "..."`。型だけの再 export は許す。
      if (stmt.isTypeOnly) continue;
      flag(stmt, "再 export (export { ... } / export * from)");
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      flag(stmt, "export default / export =");
      continue;
    }
    if (!hasExportModifier(stmt)) continue;
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
      continue; // 型は実行時に消える
    }
    if (ts.isFunctionDeclaration(stmt)) {
      if (!hasAsyncModifier(stmt)) {
        flag(stmt, `非 async の関数 ${stmt.name?.text ?? "(匿名)"}`);
      }
      continue;
    }
    if (ts.isClassDeclaration(stmt)) {
      flag(stmt, `class ${stmt.name?.text ?? "(匿名)"}`);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      // `declare` は型空間のみ。
      if (
        stmt.modifiers?.some((mo) => mo.kind === ts.SyntaxKind.DeclareKeyword)
      ) {
        continue;
      }
      for (const decl of stmt.declarationList.declarations) {
        if (isAsyncFunctionInitializer(decl.initializer)) continue;
        const name = ts.isIdentifier(decl.name) ? decl.name.text : "(分割代入)";
        const kindText = decl.initializer
          ? ts.SyntaxKind[decl.initializer.kind]
          : "初期値なし";
        flag(decl, `非 async の値 ${name} (${kindText})`);
      }
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      flag(stmt, `enum ${stmt.name.text}`);
      continue;
    }
    flag(stmt, `想定外の export (${ts.SyntaxKind[stmt.kind]})`);
  }
}

if (LIST) {
  console.log(`"use server" ファイル ${serverFiles.length} 件:`);
  for (const f of serverFiles) console.log(`  ${f}`);
  console.log("");
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

console.log(`"use server" ファイル: ${serverFiles.length} 件を走査`);
check(
  '"use server" ファイルが見つかる (走査が空振りしていない)',
  serverFiles.length > 0,
  "src/ 以下に 1 件も無い = 走査条件かディレクティブの書式が変わった",
);
check(
  '"use server" ファイルの export は async 関数だけ',
  offenders.length === 0,
  offenders
    .map((o) => `${o.file}:${o.line} — ${o.what}`)
    .join("\n       ") +
    (offenders.length > 0
      ? "\n       → 定数は純モジュール側に置いて直接 import する。" +
        "\n         Next は invalid-use-server-value をモジュール評価で throw するので、" +
        "\n         1 件あるだけでその束の Server Action が全部呼べなくなる" +
        "\n         (型チェック・ESLint・本番ビルドはどれも通る)。"
      : ""),
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
