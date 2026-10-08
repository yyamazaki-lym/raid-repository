/**
 * 動画の「コンテンツ挑戦時間」で同じ練習の動画を 1 本にまとめる検証
 * (2026-10-07)。実行: `node scripts/check-video-challenge-time.mjs`
 *
 * ## なぜ要るのか
 *
 * 同じ練習を 2 人が別の視点で録った動画を両方足していて、挑戦時間が
 * ほぼ倍になっていた (本番の「絶もうひとつの未来」で 14 本 22h34m)。
 * まとめすぎると別の練習を消すので、次を契約として固定する:
 *
 *   1. 番号 (DAY / PART / 日目 / パート) と日付が両方同じなら同じ練習 (前後
 *      1 日は許さない。Part を毎日 1 から数え直す付け方で隣の日を消すため)
 *   2. 同じ系列 (題名の数字を伏せた形) は題名がまったく同じとき (上げ直し)
 *      だけ、系列違いは分割の印 (前半/後半) やほかの数字 (7-1/7-2・M3S/M4S)
 *      が食い違わないときだけ同じ練習
 *   3. 絶の P1 / P2 はフェーズなので番号と読まない
 *   4. 番号・日付の分からない動画は今までどおり足す
 *
 * ⚠ tsc は `npx` 経由にしない (Windows で ENOENT / EINVAL になる)。
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const outDir = mkdtempSync(join(tmpdir(), "video-challenge-time-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/video-challenge-time.ts",
      "--outDir",
      outDir,
      "--rootDir",
      "src/lib",
      "--target",
      "es2022",
      "--module",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const fix = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        fix(p);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      const src = readFileSync(p, "utf8").replace(
        /from "(\.\.?\/[^"]+)"/g,
        (mm, spec) => (spec.endsWith(".js") ? mm : `from "${spec}.js"`),
      );
      writeFileSync(p, src);
    }
  };
  fix(outDir);
  const m = await import(pathToFileURL(join(outDir, "video-challenge-time.js")).href);

  console.log("\n[題名の番号]");
  check(
    "DAY / PART / 日目 / パート / 全角 / ゼロ埋め",
    [
      "【2026 10 06】絶もうひとつの未来【DAY 7】",
      "FINAL FANTASY XIV 絶エデン2026 10 06 PART7",
      "練習 3日目",
      "パート2 後半",
      "ＤＡＹ７",
      "Day 07",
      "day-4",
    ].map(m.parseSessionNumberKey),
    ["n7", "n7", "n3", "n2", "n7", "n7", "n4"],
  );
  check("Day と Part の両方は両方を鍵にする", m.parseSessionNumberKey("2026 10 01 Day 3 Part 2"), "d3-p2");
  check(
    "絶の P1 / P2 (フェーズ)・語の一部・4 桁は番号と読まない",
    ["【絶オメガ】P1 詰め", "【FRU】P2 突入", "birthday 3", "today 5", "Day 2026", "4層 練習"].map(m.parseSessionNumberKey),
    [null, null, null, null, null, null],
  );

  // 本番の「絶もうひとつの未来」の 14 本 (題名・長さは 2026-10-07 に本番の画面から読んだ値)。
  const MIN = 60;
  let seq = 0;
  const v = (title, minutes, url = null, postedAt = "2026-10-06T15:00:00Z") => ({
    id: `v${++seq}`,
    title,
    url,
    durationSeconds: minutes === null ? null : minutes * MIN,
    postedAt,
  });
  const prod = [
    v("【2026 10 06】絶もうひとつの未来【DAY 7】", 59),
    v("FINAL FANTASY XIV 絶エデン2026 10 06 PART7", 60),
    v("【2026 10 05】絶もうひとつの未来【DAY 6】", 74),
    v("FINAL FANTASY XIV 絶エデン2026 10 05 PART6", 70),
    v("【2026 10 04】絶もうひとつの未来【DAY 5】", 115),
    v("FINAL FANTASY XIV 絶エデン2026 10 04 PART5", 114),
    v("FINAL FANTASY XIV 絶エデン2026 09 19 PART1", 83),
    v("FINAL FANTASY XIV 絶エデン2026 09 24 PART2", 115),
    v("FINAL FANTASY XIV 絶エデン2026 09 27 PART3", 120),
    v("FINAL FANTASY XIV 絶エデン2026 10 01 PART4", 120),
    v("【2026 10 01】絶もうひとつの未来【DAY 4】", 120),
    v("【2026 09 27】絶もうひとつの未来【DAY 3】", 120),
    v("【2026 09 24】絶もうひとつの未来【DAY 2】", 104),
    v("【2026 09 18】絶もうひとつの未来【DAY 1】", 72),
  ];
  console.log("\n[本番の 14 本]");
  // PART1 の「2026 09 19」は題名の付け間違い (ユーザーが直す)。直す前は日付が
  // 違うので組にしない (1 日を許すと、毎日数え直す Part で隣の日を消すため)。
  const before = m.challengeTime(prod);
  check(
    "題名を直す前: 6 組 + DAY 1 と PART1 は別々 (日付が違う)",
    [before.totalSeconds / MIN, before.duplicates, before.missing, before.countedIds.size],
    [60 + 74 + 115 + 120 + 120 + 115 + 72 + 83, 6, 0, 8],
  );
  const fixed = prod.map((x) =>
    x.title === "FINAL FANTASY XIV 絶エデン2026 09 19 PART1"
      ? { ...x, title: "FINAL FANTASY XIV 絶エデン2026 09 18 PART1" }
      : x,
  );
  const after = m.challengeTime(fixed);
  check(
    "題名を直した後: 7 組にまとまり、各組の長い方を数える",
    [after.totalSeconds / MIN, after.duplicates, after.countedIds.size],
    [60 + 74 + 115 + 120 + 120 + 115 + 83, 7, 7],
  );
  check(
    "渡す順によらない",
    [m.challengeTime([...prod].reverse()).totalSeconds, m.challengeTime([...fixed].reverse()).totalSeconds],
    [before.totalSeconds, after.totalSeconds],
  );

  console.log("\n[別の練習を消さない]");
  check(
    "日付が 1 日違えば別の練習 (付け間違いは題名を直す)",
    m.challengeTime([v("A 2026 10 01 Day 5", 60), v("B 2026 10 02 Day 5", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "同じ系列で Part を毎日 1 から数え直す付け方 (日付違いは別の練習)",
    m.challengeTime([v("練習 2026 10 01 Part 1", 60), v("練習 2026 10 02 Part 1", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "2 系列とも毎日数え直し、日によって本数が違っても日ごとに組む",
    m.challengeTime([
      v("A視点 2026 10 01 Part 1", 60),
      v("A視点 2026 10 01 Part 2", 55),
      v("B視点 2026 10 01 Part 1", 58),
      v("A視点 2026 10 02 Part 1", 50),
      v("B視点 2026 10 02 Part 1", 52),
      v("B視点 2026 10 02 Part 2", 45),
    ]).totalSeconds / MIN,
    60 + 55 + 52 + 45,
  );
  check(
    "同じ日の分割 (7-1 / 7-2、同じ系列)",
    m.challengeTime([v("【2026 10 06】絶もうひとつの未来【DAY 7-1】", 60), v("【2026 10 06】絶もうひとつの未来【DAY 7-2】", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "同じ投稿者が 1 本目に印を付けずに分割 (番号の語までの書き方が同じ = 同じ人)",
    [
      m.challengeTime([v("【2026 10 06】絶もうひとつの未来【DAY 7】", 120), v("【2026 10 06】絶もうひとつの未来【DAY 7-2】", 60)]).totalSeconds / MIN,
      m.challengeTime([v("【2026 10 06】絶もうひとつの未来【DAY 7】", 120), v("【2026 10 06】絶もうひとつの未来【DAY 7】②", 60)]).totalSeconds / MIN,
      m.challengeTime([v("2026 10 06 練習 7日目", 120), v("2026 10 06 練習 7日目 延長", 60)]).totalSeconds / MIN,
      m.challengeTime([v("FINAL FANTASY XIV 絶エデン2026 10 06 PART7", 120), v("FINAL FANTASY XIV 絶エデン2026 10 06 PART7 午後", 60)]).totalSeconds / MIN,
    ],
    [180, 180, 180, 180],
  );
  check(
    "同じ日の分割 (前半 / 後半、系列違い)",
    m.challengeTime([v("【2026 10 06】絶もうひとつの未来【DAY 7】前半", 60), v("【2026 10 06】絶もうひとつの未来【DAY 7】後半", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "別の投稿者でも、片方に分割の印 (前半) があれば組にしない",
    m.challengeTime([v("A視点 2026 10 06 DAY 7 前半", 60), v("B視点【2026 10 06】DAY 7", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "同じ日の分割 (① / ②、全角数字も NFKC で数字として比べる)",
    m.challengeTime([v("【2026 10 06】DAY 7 ①", 60), v("【2026 10 06】DAY 7 ②", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "層違い (M3S / M4S の同じ Part 1、同じ系列)",
    m.challengeTime([v("2026 10 06 M3S Part 1", 60), v("2026 10 06 M4S Part 1", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "層違い (系列違いでも、ほかの数字が食い違えば別)",
    m.challengeTime([v("零式3層 2026 10 06 Day 2", 60), v("【2026 10 06】4層 DAY 2", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "番号が違えば別の練習 (同じ日の Part 1 と Part 2)",
    m.challengeTime([v("2026 10 01 Part 1", 60), v("2026 10 01 Part 2", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "Day と Part の両方がある題名は、片方だけの題名と組にしない",
    m.challengeTime([v("A 2026 10 01 Day 3 Part 2", 60), v("B 2026 10 01 Part 2", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "番号の無い動画は今までどおり足す",
    m.challengeTime([v("2026 10 01 練習", 60), v("2026 10 01 練習 別視点", 50)]).totalSeconds / MIN,
    110,
  );
  check(
    "日付の分からない (題名にも投稿日時にも無い) 動画は組にしない",
    m.challengeTime([v("Day 3", 60, null, null), v("別視点 Day 3", 50, null, null)]).totalSeconds / MIN,
    110,
  );
  check(
    "全角の日付も読む (まとめて同じ日に上げた、毎日数え直す Part)",
    m.challengeTime([
      v("【２０２６ １０ ０１】絶エデン Part 1", 90, null, "2026-10-02T12:00:00Z"),
      v("【２０２６ １０ ０２】絶エデン Part 1", 80, null, "2026-10-02T12:00:00Z"),
    ]).totalSeconds / MIN,
    170,
  );

  check(
    "全角の日付を読めば、翌日に上げた別視点とも同じ日になる",
    m.challengeTime([
      v("【２０２６ １０ ０１】A視点 Part 1", 60, null, "2026-10-02T12:00:00Z"),
      v("B視点 2026 10 01 Part 1", 50, null, "2026-10-01T14:00:00Z"),
    ]).totalSeconds / MIN,
    60,
  );

  console.log("\n[同じ練習をまとめる]");
  check(
    "同じ系列・同じ題名 (上げ直し) は 1 本",
    m.challengeTime([v("練習 2026 10 01 Part 1", 60), v("練習 2026 10 01 Part 1", 58)]).totalSeconds / MIN,
    60,
  );
  check(
    "系列違いで、ほかの数字が片方にしか無い (FF14 など) なら同じ練習",
    m.challengeTime([v("FF14 絶エデン 2026 10 06 PART7", 60), v("【2026 10 06】絶もうひとつの未来【DAY 7】", 59)]).totalSeconds / MIN,
    60,
  );
  check(
    "同じ YouTube の動画 (URL の書き方違い) は番号が無くても 1 本",
    m.challengeTime([
      v("練習", 60, "https://youtu.be/AmcX55rBGjI"),
      v("練習 (再掲)", 60, "https://www.youtube.com/watch?v=AmcX55rBGjI&si=x"),
    ]).totalSeconds / MIN,
    60,
  );
  const ytTrio = [
    v("https://youtu.be/JryXzOo9LmQ", 60, "https://youtu.be/JryXzOo9LmQ"),
    v("FINAL FANTASY XIV 絶エデン2026 10 06 PART7", 60, "https://www.youtube.com/watch?v=JryXzOo9LmQ"),
    v("【2026 10 06】絶もうひとつの未来【DAY 7】", 59, "https://youtu.be/AmcX55rBGjI"),
  ];
  check(
    "同じ YouTube の組の代表は番号の読める題名 (題名が URL の行が先でも)",
    [m.challengeTime(ytTrio).totalSeconds / MIN, m.challengeTime([...ytTrio].reverse()).totalSeconds / MIN],
    [60, 60],
  );
  check(
    "題名の日付が無ければ投稿日時の JST 暦日で比べる (同じ日)",
    m.challengeTime([
      v("A Day 2", 60, null, "2026-10-01T12:00:00Z"),
      v("B Day 2", 50, null, "2026-10-01T14:30:00Z"),
    ]).totalSeconds / MIN,
    60,
  );
  check(
    "系列名の並び (ロケール) によらない",
    [
      m.challengeTime([v("z視点 2026 10 01 Part 1", 120), v("z視点 2026 10 02 Part 1", 20), v("b視点 2026 10 02 Part 1", 100)]).totalSeconds / MIN,
      m.challengeTime([v("a視点 2026 10 01 Part 1", 120), v("a視点 2026 10 02 Part 1", 20), v("b視点 2026 10 02 Part 1", 100)]).totalSeconds / MIN,
    ],
    [220, 220],
  );

  console.log("\n[長さの分からない動画]");
  const half = m.challengeTime([v("A 2026 10 01 Day 1", null), v("B 2026 10 01 Day 1", 50)]);
  check("組の片方に長さがあればそれを数え、未取得は 1 本と数える (今までと同じ意味)", [half.totalSeconds / MIN, half.missing], [50, 1]);
  const none = m.challengeTime([v("A 2026 10 01 Day 1", null), v("B 2026 10 01 Day 1", null)]);
  check("組のどれにも長さが無ければ 0 秒・未取得 2 本", [none.totalSeconds, none.missing, none.duplicates], [0, 2, 1]);
  check("0 件", m.challengeTime([]).totalSeconds, 0);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// 挑戦時間を出す 6 か所が、すべて同じ関数 (`challengeTime`) を通ること。
// 1 か所でも単純な足し算が残ると、画面ごとに値がずれる。
console.log("\n[配線]");
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const actions = read("src/lib/server/categories-actions.ts");
// 2026-10-08: 一覧カードの集計 2 本は素のモジュールへ移した (Server Action から外すため)。
const aggregates = read("src/lib/server/category-aggregates.ts");
const server = actions + "\n" + aggregates;
const list = read("src/app/(portal)/category/[slug]/videos/videos-list.tsx");
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j < 0 ? undefined : j);
};
check(
  "一覧カードの挑戦時間: 動画の行を全ページ読んで challengeTime (SQL の単純な合計 RPC を呼ばない)",
  [
    /fetchAllPages\(/.test(fnBody(aggregates, "fetchPracticeSecondsByCategory")),
    /challengeTime\(list\)/.test(fnBody(aggregates, "fetchPracticeSecondsByCategory")),
    /rpc\("practice_seconds_by_category"\)/.test(server),
  ],
  [true, true, false],
);
check(
  "一覧カードのクリアまでの時間: 範囲で絞ってから challengeTime",
  /const total = challengeTime\(\s*list\s*\.filter\(\(v\) => v\.effectiveIso >= startAt && v\.effectiveIso <= info\.firstClearAt\)/.test(
    fnBody(aggregates, "fetchTimeToClearByCategory"),
  ),
  true,
);
check(
  "メンテの結果パネル: 範囲で絞ってから challengeTime",
  /const clearTime = challengeTime\(\s*inWindow\.map/.test(actions),
  true,
);
check(
  "動画タブ: 全体・クリアまで・選んだ動画の 3 つとも challengeTime",
  [
    /const all = challengeTime\(live\.map\(toChallengeVideo\)\);/.test(list),
    /: challengeTime\(\s*live\s*\.filter\(/.test(list),
    /const picked = challengeTime\(\s*liveWithFav\.filter\(\(v\) => selectedIds\.has\(v\.id\)\)\.map\(toChallengeVideo\),/.test(list),
    // 単純な足し算 (`+= v.durationSeconds`) が残っていない
    /\+= v\.durationSeconds/.test(list),
  ],
  [true, true, true, false],
);
check(
  "4 か所とも日付は posted_at、無ければ created_at (場所ごとに組み方を変えない)",
  [
    /postedAt: \(r\.posted_at as string \| null\) \?\? \(\(r\.created_at as string \| null\) \?\? null\),/.test(
      fnBody(aggregates, "fetchPracticeSecondsByCategory"),
    ),
    (server.match(/postedAt: \(v\.posted_at as string \| null\) \?\? \(v\.created_at as string\),/g) ?? []).length,
    /postedAt: v\.postedAt \?\? v\.createdAt,/.test(list),
  ],
  [true, 2, true],
);
check(
  "選択して保存の確認文に、数えなかった本数を出す",
  /picked\.duplicates > 0 \? m\.videos\.duplicatesSaveNote\(picked\.duplicates\)/.test(list),
  true,
);
check(
  "クリアまでのバッジは、その範囲で数えなかった本数を出す",
  /const dup = isCleared \? toClearDuplicateCount : duplicateCount;/.test(list),
  true,
);
check(
  "サーバー側でクリアまでの時間を単純に足していない",
  /total \+= sec;|timeToClearSeconds \+= sec;/.test(server),
  false,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
