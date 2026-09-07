/**
 * 募集文の変数差し込み (src/lib/recruitment-placeholders.ts) の検証
 * (2026-09-07、W-28)。
 * 実行: `node scripts/check-recruitment-placeholders.mjs`
 *
 * 募集文は**そのまま外部に貼る**テキストなので、置換の事故が直接見える。
 * 重点は
 *   - 未指定の変数を空文字にしない (「P 練習中」になって貼ってから気付く)
 *   - 値の中の波括弧を再展開しない
 *   - 未知の変数を壊さない (本文には絵文字や記号が入る)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/recruitment-placeholders.ts";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "recruit-ph-check-"));
try {
  execFileSync(
    "npx",
    ["tsc", SRC, "--outDir", outDir, "--target", "es2022", "--module", "es2022",
     "--moduleResolution", "bundler", "--strict"],
    { stdio: "inherit" },
  );
  const {
    RECRUITMENT_PLACEHOLDERS,
    MANUAL_PLACEHOLDERS,
    isRecruitmentPlaceholder,
    usedPlaceholders,
    needsManualInput,
    fillRecruitmentTemplate,
  } = await import(pathToFileURL(join(outDir, "recruitment-placeholders.js")).href);

  console.log("変数の一覧");
  check("9 種類", RECRUITMENT_PLACEHOLDERS.length, 9);
  check("手入力は 3 種類", [...MANUAL_PLACEHOLDERS], ["phase", "weapon", "dc"]);
  check("既知の変数", isRecruitmentPlaceholder("phase"), true);
  check("未知の変数", isRecruitmentPlaceholder("nope"), false);
  check("大文字は未知扱い", isRecruitmentPlaceholder("PHASE"), false);

  console.log("\n使われている変数の抽出");
  check("無ければ空", usedPlaceholders("固定メンバー募集"), []);
  check(
    "宣言順で返す (出現順ではない)",
    usedPlaceholders("{weapon} 希望 / {content} の {phase}"),
    ["content", "phase", "weapon"],
  );
  check("重複は 1 回", usedPlaceholders("{phase} と {phase}"), ["phase"]);
  check("未知の変数は無視", usedPlaceholders("{foo} {phase}"), ["phase"]);

  console.log("\n手入力が必要かの判定");
  check(
    "自動変数だけなら手入力なし",
    needsManualInput("{content} {date} {time_start}"),
    [],
  );
  check("phase だけ", needsManualInput("{content} の {phase} 練習中"), ["phase"]);
  check(
    "3 つとも",
    needsManualInput("{dc} / {content} {phase} / {weapon} 希望"),
    ["phase", "weapon", "dc"],
  );

  console.log("\n差し込み");
  check(
    "自動変数が埋まる",
    fillRecruitmentTemplate("{content} {date} {time_start}〜{time_end}", {
      content: "天獄編零式",
      date: "9/10(木)",
      time_start: "21:00",
      time_end: "23:00",
    }),
    "天獄編零式 9/10(木) 21:00〜23:00",
  );
  // ここが肝: 未指定は空文字にせず {name} のまま残す。
  check(
    "未指定は変数のまま残す",
    fillRecruitmentTemplate("{content} の {phase} 練習中", { content: "絶オメガ" }),
    "絶オメガ の {phase} 練習中",
  );
  check(
    "空文字も変数のまま残す",
    fillRecruitmentTemplate("P{phase} 練習中", { phase: "" }),
    "P{phase} 練習中",
  );
  check(
    "空白だけも変数のまま残す",
    fillRecruitmentTemplate("P{phase} 練習中", { phase: "   " }),
    "P{phase} 練習中",
  );
  check(
    "null も変数のまま残す",
    fillRecruitmentTemplate("P{phase} 練習中", { phase: null }),
    "P{phase} 練習中",
  );
  check(
    "前後の空白は落として埋める",
    fillRecruitmentTemplate("P{phase}", { phase: "  3  " }),
    "P3",
  );
  // 値の中の波括弧を再展開しない (無限展開・意図しない置換を防ぐ)。
  check(
    "値の中の変数は展開しない",
    fillRecruitmentTemplate("{phase}", { phase: "{weapon}", weapon: "斧" }),
    "{weapon}",
  );
  check(
    "未知の変数はそのまま",
    fillRecruitmentTemplate("{foo} {phase}", { phase: "P3" }),
    "{foo} P3",
  );
  check(
    "同じ変数を複数回埋める",
    fillRecruitmentTemplate("{phase} → {phase}", { phase: "P3" }),
    "P3 → P3",
  );
  // 本文には絵文字や記号が入る。波括弧以外は一切触らない。
  check(
    "本文の記号や絵文字は壊さない",
    fillRecruitmentTemplate("🔰 【{content}】 <t:123:F> #募集", {
      content: "絶竜詩",
    }),
    "🔰 【絶竜詩】 <t:123:F> #募集",
  );
  check("空の本文", fillRecruitmentTemplate("", { phase: "P3" }), "");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
