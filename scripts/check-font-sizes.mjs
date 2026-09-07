/**
 * 文字サイズの下限検査 (2026-09-07)。
 * 実行: `node scripts/check-font-sizes.mjs [--list]`
 *
 * `src/` 以下の Tailwind の任意値クラス `text-[Npx]` を走査し、**11px を
 * 下回るものが 1 つも無いこと**を検査する。
 *
 * ## なぜ下限を引くのか
 *
 * 第 2 回の UI 監査で「10px 基調 + 意味色」に寄せたが、第 4 回の調査
 * (`docs/ff14-tools-research-2026-09-06-wide.md` 8-4) で外部の基準に
 * 照らしたところ **10px は下限を割っている**ことが分かった:
 *
 *   - Apple HIG の最小フォントは 11pt
 *   - Material の label-small は 11px
 *   - WCAG に絶対値の規定は無いが、拡大しても崩れないことを要求する
 *
 * そこで portal の基準を
 *
 *   - **本文 / 表の中身 = 12px 以上** (`tabular-nums` で桁を揃える)
 *   - **ラベル / チップ = 11px** (大文字ラベル・枠付きバッジなど 1 行前提のもの)
 *   - **10px 以下は使わない**
 *
 * と定め、2026-09-07 に既存の 392 箇所 (`text-[10px]` 329 / `text-[9px]` 63)
 * を一括で引き上げた。密度は行高と左右 padding で調整する方針なので、
 * 「詰めたいから 10px に戻す」は取らない。この検査はその逆戻りを CI で止める。
 *
 * `--list` を付けると現在の使用箇所を px ごとに数えて出す (棚卸し用)。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const MIN_PX = 11;
/** `text-[10px]` / `sm:text-[9px]` など、任意値の文字サイズ。 */
const RE = /(?:^|[\s"'`:])((?:[a-z-]+:)*text-\[(\d+)px\])/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const tooSmall = [];
const counts = new Map();
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      const px = Number(m[2]);
      counts.set(px, (counts.get(px) ?? 0) + 1);
      if (px < MIN_PX) tooSmall.push(`${file}:${i + 1}  ${m[1]}`);
    }
  });
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

check(
  `no text-[Npx] below ${MIN_PX}px in ${ROOT}/ (UI 基準 8-4: 本文 12px / ラベル 11px)`,
  tooSmall.length === 0,
  tooSmall.slice(0, 20).join("\n       ") +
    (tooSmall.length > 20 ? `\n       ... ${tooSmall.length - 20} more` : ""),
);

if (process.argv.includes("--list")) {
  console.log("\n  text-[Npx] の使用箇所:");
  for (const px of [...counts.keys()].sort((a, b) => a - b)) {
    console.log(`    ${String(px).padStart(3)}px  ${counts.get(px)}`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
