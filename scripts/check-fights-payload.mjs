/**
 * 練習ログ明細 (FightRow[]) の転送量の予算検証 (2026-09-07)。
 * 実行: `node scripts/check-fights-payload.mjs`
 *
 * 背景: `src/lib/supabase/fflogs-fights.ts` の明細上限 `MAX_FIGHTS` は
 * 長らく 1200 で、実機の絶竜詩が 1047 pull まで来て「pull はあるのに古い
 * セッションが 1 日も出てこない」状態が起きた (#328)。上限の根拠は「1 pull
 * ≈ 200 B なので数千 pull で RSC ペイロードが MB 級」という見立てだったが、
 * 明細は同じ report code / 日付 / ボス名 / 技名が何十行も並ぶため圧縮が
 * 15〜30 倍効き、**転送量では 6000 pull でも 200 KB 台**に収まる。それを
 * 根拠に上限を 20000 (事故の安全弁) まで上げた。
 *
 * このスクリプトはその前提を固定する回帰ガード:
 *   - FightRow に太いフィールド (死亡イベント全件・プレイヤー配列など) が
 *     足されると圧縮後サイズが跳ね、ここで落ちる
 *   - 上限を上げるときは PULLS を上げて予算を確認してから変える
 *
 * FightRow の形は `src/lib/fflogs-progress.ts` の型定義に合わせた合成データ
 * (DB / FFLogs へは本環境から到達できない)。値の分布は実機の絶竜詩・絶オメガ
 * (60 pull/レポート・7 フェーズ・技名は日本語) に寄せてある。
 */
import { gzipSync, brotliCompressSync } from "node:zlib";

/** 検証する pull 数 (実機の最大 1047 の約 6 倍 = 数年運用した固定を想定)。 */
const PULLS = 6000;
/** 1 レポート = 1 日の練習 ≈ 50 pull。 */
const PULLS_PER_REPORT = 50;
/** 予算 (gzip)。超えたら明細の間引き / フィールド削減を検討する。 */
const GZIP_BUDGET_KB = 300;

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** FFLogs のレポートコードは 16 文字の英数字。 */
function reportCode(n) {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let out = "";
  let v = n * 2654435761;
  for (let i = 0; i < 16; i++) {
    v = (v * 48271 + 11) % 2147483647;
    out += alphabet[v % alphabet.length];
  }
  return out;
}

/** 絶の技名 (日本語 = UTF-8 で 1 文字 3 B。圧縮前が重い側を再現する)。 */
const ABILITIES = [
  "アルティメット・エンド",
  "ホーリーウィング",
  "ハイパーディメンション",
  "ワイバーンズイレース",
  "エクサフレア",
];
const JOBS = ["Paladin", "WhiteMage", "Samurai", "Dragoon", "Astrologian"];

/** `ultimate` で phases / lastPhase を持つ重い側 (絶) を作る。 */
function makeFight(i, ultimate) {
  const day = 1 + Math.floor(i / PULLS_PER_REPORT);
  const phases = 1 + (i % 7);
  return {
    reportCode: reportCode(Math.floor(i / PULLS_PER_REPORT)),
    fightId: (i % PULLS_PER_REPORT) + 1,
    sessionDate: `2026-${String(1 + (day % 12)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`,
    name: ultimate ? "Dragonsong's Reprise" : "Zeromus",
    kill: false,
    fightPercentage: Math.round((100 - (i % 100)) * 100) / 100,
    lastPhase: ultimate ? phases : null,
    encounterId: ultimate ? 1065 : 1081,
    difficulty: 100,
    partyDps: 120000 + (i % 40000),
    deaths: i % 9,
    wipe: {
      t: 60000 + (i % 600) * 1000,
      job: JOBS[i % JOBS.length],
      ability: ABILITIES[i % ABILITIES.length],
      cluster: 1 + (i % 4),
      total: 1 + (i % 8),
      phase: ultimate ? phases : null,
    },
    phases: ultimate
      ? Array.from({ length: phases }, (_, k) => ({
          id: k + 1,
          start: k * 70000,
          dur: 68000 + ((i + k) % 4000),
        }))
      : null,
    startMs: 1757200000000 + i * 600000,
    endMs: 1757200000000 + i * 600000 + 300000,
    reportStartMs: 1757200000000 + Math.floor(i / PULLS_PER_REPORT) * 14400000,
  };
}

console.log(`fights payload: ${PULLS} pull / gzip 予算 ${GZIP_BUDGET_KB} KB`);

const results = [];
for (const ultimate of [false, true]) {
  const rows = Array.from({ length: PULLS }, (_, i) => makeFight(i, ultimate));
  const raw = Buffer.from(JSON.stringify(rows));
  const gzip = gzipSync(raw, { level: 6 });
  const brotli = brotliCompressSync(raw);
  results.push({
    label: ultimate ? "絶 (phases 込み)" : "零式",
    rawMb: raw.length / 1024 / 1024,
    gzipKb: gzip.length / 1024,
    brotliKb: brotli.length / 1024,
    perPull: raw.length / PULLS,
  });
}

for (const r of results) {
  console.log(
    `  ${r.label.padEnd(16)} raw ${r.rawMb.toFixed(2)} MB / gzip ${r.gzipKb.toFixed(0)} KB` +
      ` / brotli ${r.brotliKb.toFixed(0)} KB (${r.perPull.toFixed(0)} B/pull)`,
  );
}

const worst = results.reduce((a, b) => (b.gzipKb > a.gzipKb ? b : a));
check(
  `gzip が予算内 (最悪ケース: ${worst.label})`,
  worst.gzipKb <= GZIP_BUDGET_KB,
  `${worst.gzipKb.toFixed(0)} KB <= ${GZIP_BUDGET_KB} KB`,
);
// 圧縮が効いていること自体もガードする。効かない形 (pull ごとに一意な
// 長い文字列を持つなど) に変わったら、上限の根拠が崩れる。
check(
  "圧縮率が 10 倍以上",
  worst.rawMb * 1024 > worst.gzipKb * 10,
  `raw ${(worst.rawMb * 1024).toFixed(0)} KB / gzip ${worst.gzipKb.toFixed(0)} KB = ${((worst.rawMb * 1024) / worst.gzipKb).toFixed(1)}x`,
);

// MAX_FIGHTS がこの検証と食い違わないこと (どちらかだけ変えても気付ける)。
const src = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/supabase/fflogs-fights.ts", "utf8"),
);
const m = /const MAX_FIGHTS = (\d+);/.exec(src);
check("MAX_FIGHTS を読み取れる", m !== null, m ? m[1] : "見つからない");
if (m) {
  check(
    "MAX_FIGHTS が検証済みの pull 数以上",
    Number(m[1]) >= PULLS,
    `MAX_FIGHTS=${m[1]} >= ${PULLS}`,
  );
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
