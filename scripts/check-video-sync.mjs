/**
 * 動画オフセットの校正 (src/lib/video-sync.ts) の検証 (2026-09-07、W-11)。
 * 実行: `node scripts/check-video-sync.mjs`
 *
 * pull 行の動画リンクは「動画上で pull #1 の戦闘開始が何秒か」= オフセットを
 * 起点に計算している。W-11 でその逆算 (動画を再生して押した位置から
 * オフセットを出す) を足したので、**順算と逆算が往復すること**を固定する。
 * 片方だけ直すと「リンクは合っているのに校正するとずれる」が起きる。
 *
 * プレーヤーからの postMessage の解釈も検証する。ここは YouTube 側の
 * 仕様に依存するので、壊れたときに「黙って 0 秒」にならないこと
 * (取れないものは必ず null) を固定するのが目的。
 *
 * 2026-10-02: 動画に映っていない pull (動画上の秒が負) の色分けを足した。
 * pull 行とオフセット設定の「動画に最初に映る pull」が同じ境界
 * (`isBeforeVideoStart`) を使っていることも、ここで固定する。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const outDir = mkdtempSync(join(tmpdir(), "video-sync-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/video-sync.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".js")) continue;
    const fp = join(outDir, f);
    writeFileSync(
      fp,
      readFileSync(fp, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g,
        "$1$2.js$3",
      ),
    );
  }
  const v = await import(pathToFileURL(join(outDir, "video-sync.js")).href);
  const {
    videoSecondsForPull,
    offsetFromVideoSeconds,
    clampOffsetSeconds,
    nudgeOffset,
    isYoutubePlayerOrigin,
    youtubeSyncEmbedUrl,
    youtubeListeningMessage,
    youtubeCommandMessage,
    parseYoutubePlayerTime,
    explainOffset,
    isBeforeVideoStart,
    parseRecordingStartFromTitle,
    offsetFromRecordingStart,
    RECORDING_LEAD_MAX_SECONDS,
    OFFSET_LIMIT_SECONDS,
  } = v;

  // 実機に近い値: 21:00 開始、pull #1 が 21:03、動画は 21:01 から録画開始
  // (= pull #1 は動画の 2 分 = 120 秒地点)。
  const first = Date.parse("2026-09-05T12:03:00Z"); // JST 21:03
  const pull5 = first + 17 * 60 * 1000 + 30 * 1000; // 17 分 30 秒後
  const OFFSET = 120;

  console.log("順算 (pull → 動画の秒)");
  check("pull #1 はオフセットそのもの", videoSecondsForPull(OFFSET, first, first), 120);
  check("17 分 30 秒後の pull", videoSecondsForPull(OFFSET, pull5, first), 120 + 1050);
  check(
    "オフセットが負 (録画開始が pull #1 より後) でも成立",
    videoSecondsForPull(-30, pull5, first),
    1020,
  );

  console.log("\n逆算 (押した位置 → オフセット)");
  check("pull #1 を基準に 120 秒で押した", offsetFromVideoSeconds(120, first, first), 120);
  check(
    "pull #5 を基準に 1170 秒で押した → 同じオフセットに戻る",
    offsetFromVideoSeconds(1170, pull5, first),
    120,
  );
  check(
    "後半だけの動画: pull #5 が動画の 10 秒 → オフセットは負",
    offsetFromVideoSeconds(10, pull5, first),
    -1040,
  );

  console.log("\n往復 (順算 → 逆算で元に戻る)");
  for (const o of [0, 120, -30, 3599, -3599]) {
    for (const anchor of [first, pull5]) {
      const round = offsetFromVideoSeconds(
        videoSecondsForPull(o, anchor, first),
        anchor,
        first,
      );
      check(`offset=${o} anchor=${anchor === first ? "#1" : "#5"}`, round, o);
    }
  }

  console.log("\n丸め (四捨五入 — 切り捨てだと開幕が切れる)");
  check("12.4 秒 → 12", offsetFromVideoSeconds(12.4, first, first), 12);
  check("12.5 秒 → 13", offsetFromVideoSeconds(12.5, first, first), 13);
  check("12.6 秒 → 13", offsetFromVideoSeconds(12.6, first, first), 13);
  check("負の端数 -12.6 → -13", offsetFromVideoSeconds(-12.6, first, first), -13);

  console.log("\n範囲と微調整");
  check("上限を超えたら丸める", clampOffsetSeconds(OFFSET_LIMIT_SECONDS + 100), OFFSET_LIMIT_SECONDS);
  check("下限も同様", clampOffsetSeconds(-OFFSET_LIMIT_SECONDS - 100), -OFFSET_LIMIT_SECONDS);
  check("NaN は 0", clampOffsetSeconds(Number.NaN), 0);
  check("Infinity は 0", clampOffsetSeconds(Number.POSITIVE_INFINITY), 0);
  check("+1 秒", nudgeOffset(120, 1), 121);
  check("-1 秒", nudgeOffset(120, -1), 119);
  check("負の側へも越えられる", nudgeOffset(0, -1), -1);
  check("上限で止まる", nudgeOffset(OFFSET_LIMIT_SECONDS, 1), OFFSET_LIMIT_SECONDS);

  console.log("\nオフセットの意味の言い直し (2026-09-07 実機の取り違え)");
  // 実機: 動画1 は pull #1 が映っておらず (録画開始が 82 秒後)、0:22 で
  // 始まっていたのは pull #2 だった。それを #1 と見て 22 を入れたため、
  // 全リンクが一律 104 秒遅い位置を指していた。
  const anchors = [
    { fightId: 1, index: 1, startMs: first },
    { fightId: 2, index: 2, startMs: first + 103 * 1000 },
    { fightId: 7, index: 7, startMs: first + 3387 * 1000 },
  ];
  const wrong = explainOffset(22, anchors, first);
  check("誤った 22: 最初の pull は動画の 22 秒地点ということになる", wrong.firstPullVideoSeconds, 22);
  check("誤った 22: 最初の pull が『映っている』ことになってしまう", wrong.firstVisible.index, 1);
  const right = explainOffset(-82, anchors, first);
  check("正しい -82: 最初の pull は動画の -82 秒 = 映っていない", right.firstPullVideoSeconds, -82);
  check("正しい -82: 動画に最初に映るのは #2", right.firstVisible.index, 2);
  check("正しい -82: その #2 は動画の 21 秒地点", right.firstVisible.videoSeconds, 21);
  check("正しい -82: #7 は 55:05 に来る", videoSecondsForPull(-82, anchors[2].startMs, first), 3305);
  check("基準が無ければ null", explainOffset(0, anchors, null), null);
  check("pull が無ければ null", explainOffset(0, [], first), null);
  const allBefore = explainOffset(-99999, anchors, first);
  check("全部が録画開始より前なら映っている pull は無い", allBefore.firstVisible, null);
  check(
    "0 秒ちょうどは映っている扱い",
    explainOffset(0, anchors, first).firstVisible.index,
    1,
  );

  console.log("\n動画に映っていない pull の判定 (2026-10-02、pull 行の色分け)");
  check("負の秒は映っていない", isBeforeVideoStart(-82), true);
  check("わずかに負 (-0.001 秒) も映っていない", isBeforeVideoStart(-0.001), true);
  check("0 秒ちょうどは映っている", isBeforeVideoStart(0), false);
  check("正の秒は映っている", isBeforeVideoStart(21), false);
  // 実機に近い例: オフセット -82 で #1 だけが映っていない
  check(
    "オフセット -82: #1 は映っていない",
    isBeforeVideoStart(videoSecondsForPull(-82, anchors[0].startMs, first)),
    true,
  );
  check(
    "オフセット -82: #2 は映っている",
    isBeforeVideoStart(videoSecondsForPull(-82, anchors[1].startMs, first)),
    false,
  );
  // 設定画面の「最初に映る pull」は、行で灰色にならない最初の pull と一致する
  for (const o of [22, -82, -103, -104, -3387, -99999, 0]) {
    const ex = explainOffset(o, anchors, first);
    const firstNotOutside =
      anchors.find(
        (a) => !isBeforeVideoStart(videoSecondsForPull(o, a.startMs, first)),
      ) ?? null;
    check(
      `offset=${o}: 最初に映る pull と行の判定が一致`,
      ex.firstVisible?.fightId ?? null,
      firstNotOutside?.fightId ?? null,
    );
  }

  console.log("\nタイトルの録画開始の時刻 (2026-10-02)");
  const JST = "+09:00";
  const at = (iso) => Date.parse(iso);
  check("実データの形 (空白区切り)", parseRecordingStartFromTitle("2025 05 27 22 00 57", JST), at("2025-05-27T22:00:57+09:00"));
  check("OBS の既定", parseRecordingStartFromTitle("2025-05-27 22-00-57", JST), at("2025-05-27T22:00:57+09:00"));
  check("NVIDIA (秒の後ろは捨てる)", parseRecordingStartFromTitle("Final Fantasy XIV 2025.05.27 - 22.00.57.02.DVR", JST), at("2025-05-27T22:00:57+09:00"));
  check("アンダースコア", parseRecordingStartFromTitle("2025-05-27_22-00-57", JST), at("2025-05-27T22:00:57+09:00"));
  check("ISO 風", parseRecordingStartFromTitle("rec 2025-05-27T22:00:57", JST), at("2025-05-27T22:00:57+09:00"));
  check("前後に文字があっても読む", parseRecordingStartFromTitle("【練習】2025 05 27 22 00 57 4層", JST), at("2025-05-27T22:00:57+09:00"));
  check("日付だけのタイトルは null", parseRecordingStartFromTitle("2026 04 01 4層クリア", JST), null);
  check("時刻が分までは null", parseRecordingStartFromTitle("2025-05-27 22:00", JST), null);
  check("存在しない日付は null", parseRecordingStartFromTitle("2025 02 30 22 00 57", JST), null);
  check("24 時は null", parseRecordingStartFromTitle("2025 05 27 24 00 00", JST), null);
  check("60 分は null", parseRecordingStartFromTitle("2025 05 27 22 60 00", JST), null);
  check("数字の続きの一部は読まない", parseRecordingStartFromTitle("12025 05 27 22 00 57", JST), null);
  check("ID 通しのタイトルは null", parseRecordingStartFromTitle("ID通しtest", JST), null);
  check("タイムゾーンの形が違えば null", parseRecordingStartFromTitle("2025 05 27 22 00 57", "JST"), null);
  check("UTC の指定", parseRecordingStartFromTitle("2025 05 27 22 00 57", "+00:00"), at("2025-05-27T22:00:57Z"));
  check("マイナスの時差 (符号を見る)", parseRecordingStartFromTitle("2025 05 27 22 00 57", "-05:00"), at("2025-05-27T22:00:57-05:00"));
  check("分のある時差", parseRecordingStartFromTitle("2025 05 27 22 00 57", "+05:30"), at("2025-05-27T22:00:57+05:30"));

  console.log("\n録画開始 → オフセット");
  const rec = at("2025-05-27T22:00:57+09:00");
  const p1 = at("2025-05-27T22:03:10.400+09:00");
  const pLast = at("2025-05-28T00:10:00+09:00");
  check("録画開始が pull #1 の 133.4 秒前 → 133 (四捨五入)", offsetFromRecordingStart(rec, p1, pLast), 133);
  check("0.5 秒は切り上げ", offsetFromRecordingStart(rec, rec + 500, pLast), 1);
  check("録画開始が pull #1 より後 → 負 (前半が映っていない)", offsetFromRecordingStart(p1 + 600_000, p1, pLast), -600);
  check("録画開始 = 最後の pull はぎりぎり映る", offsetFromRecordingStart(pLast, p1, pLast), -Math.round((pLast - p1) / 1000));
  check("録画開始が最後の pull より後 → null", offsetFromRecordingStart(pLast + 1000, p1, pLast), null);
  check("6 時間ちょうど前は通す", offsetFromRecordingStart(p1 - RECORDING_LEAD_MAX_SECONDS * 1000, p1, pLast), RECORDING_LEAD_MAX_SECONDS);
  check("6 時間より前 → null (別の日の動画)", offsetFromRecordingStart(p1 - (RECORDING_LEAD_MAX_SECONDS + 1) * 1000, p1, pLast), null);
  check("前の日の動画 → null", offsetFromRecordingStart(rec - 86_400_000, p1, pLast), null);
  check("数でなければ null", offsetFromRecordingStart(Number.NaN, p1, pLast), null);
  check("上限の範囲に収まる", Math.abs(offsetFromRecordingStart(rec, p1, pLast)) <= OFFSET_LIMIT_SECONDS, true);
  check(
    "出したオフセットで pull #1 を引くと、録画開始からの経過になる (順算と往復)",
    videoSecondsForPull(offsetFromRecordingStart(rec, p1, pLast), p1, p1),
    133,
  );

  console.log("\nタイトルの録画時刻の配線 (画面とサーバーで同じ定義)");
  const seed = readFileSync("src/lib/server/fflogs-fights.ts", "utf8").replace(/\r\n/g, "\n");
  const seedFnAt = seed.indexOf("async function offsetsFromRecordingTitles(");
  const seedFn = seedFnAt < 0 ? "" : seed.slice(seedFnAt, seed.indexOf("\n}\n", seedFnAt));
  check("サーバー: タイトルを parseRecordingStartFromTitle で読む", /parseRecordingStartFromTitle\(v\.title, APP_UTC_OFFSET_ISO\)/.test(seedFn), true);
  check("サーバー: 絶は絞らず、零式は層クラスタで絞る (画面と同じ)", /const phases = resolveProgressModel\(model, [^\n]*\) === "phases";\s*const tier = phases \? fights : filterToFloorCluster\(fights, buildFloorMap\(fights\)\);/.test(seedFn), true);
  check("サーバー: 画面と同じ範囲 (新しい順に MAX_FIGHTS 件) を読む", /\.order\("start_ms", \{ ascending: false \}\)\s*\.order\("fight_id", \{ ascending: false \}\)[\s\S]*?\}, MAX_FIGHTS\);/.test(seedFn), true);
  check("サーバー: pullSpanByReport と offsetFromRecordingStart で出す", seedFn.includes("pullSpanByReport(tier)") && seedFn.includes("offsetFromRecordingStart("), true);
  check("サーバー: 出せなければ従来どおり 0", /offset_seconds: offsets\.get\(report_code\) \?\? 0,/.test(seed), true);
  const view = readFileSync("src/app/(portal)/category/[slug]/logs/logs-view.tsx", "utf8").replace(/\r\n/g, "\n");
  check("画面: pull #1 も pullSpanByReport (tierFights) から", /for \(const \[code, span\] of pullSpanByReport\(tierFights\)\)/.test(view), true);
  check("画面: tierFights は filterToFloorCluster で絞る", /const tierFights = useMemo\(\s*\(\) => filterToFloorCluster\(fights, floors\),/.test(view), true);
  const dialog = readFileSync("src/components/portal/logs/offset-dialog.tsx", "utf8").replace(/\r\n/g, "\n");
  check("設定画面: 同じ 2 関数で出し、欄に入れるだけ (保存は人)", dialog.includes("parseRecordingStartFromTitle(") && dialog.includes("offsetFromRecordingStart(") && /onChange\(\{ \.\.\.target, offset: String\(seconds\) \}\);/.test(dialog), true);

  console.log("\npull 行の配線 (同じ式・同じ判定を使う)");
  const pullRow = readFileSync(
    "src/components/portal/logs/pull-row.tsx",
    "utf8",
  ).replace(/\r\n/g, "\n");
  check(
    "pull 行は video-sync から videoSecondsForPull と isBeforeVideoStart を読む",
    /import\s*\{[^}]*\bisBeforeVideoStart\b[^}]*\bvideoSecondsForPull\b[^}]*\}\s*from\s*"@\/lib\/video-sync"/.test(pullRow),
    true,
  );
  check(
    "pull 行に式の手書きの写しが残っていない",
    /offsetSeconds\s*\+\s*\(\s*fight\.startMs\s*-\s*firstPullStartMs\s*\)/.test(pullRow),
    false,
  );
  check(
    "pull 行は判定の結果で色を分ける",
    /outside:\s*isBeforeVideoStart\(seconds\)/.test(pullRow),
    true,
  );
  check(
    "映っていない番号の説明は専用の文言を使う",
    pullRow.includes("m.logs.videoMomentOutsideTitle("),
    true,
  );

  console.log("\nプレーヤーの origin 検証 (完全一致)");
  check("nocookie", isYoutubePlayerOrigin("https://www.youtube-nocookie.com"), true);
  check("youtube.com", isYoutubePlayerOrigin("https://www.youtube.com"), true);
  check("似せた別ホストは弾く", isYoutubePlayerOrigin("https://evil-youtube.com"), false);
  check("サブドメイン偽装も弾く", isYoutubePlayerOrigin("https://www.youtube.com.evil.test"), false);
  check("http は弾く", isYoutubePlayerOrigin("http://www.youtube.com"), false);
  check("自分の origin は弾く", isYoutubePlayerOrigin("https://portal.example.com"), false);

  console.log("\n埋め込み URL");
  const url = new URL(youtubeSyncEmbedUrl("dQw4w9WgXcQ", "https://portal.example.com"));
  check("host は nocookie", url.host, "www.youtube-nocookie.com");
  check("path に動画 ID", url.pathname, "/embed/dQw4w9WgXcQ");
  check("enablejsapi", url.searchParams.get("enablejsapi"), "1");
  check("origin を渡す", url.searchParams.get("origin"), "https://portal.example.com");
  check("start は 0 のとき付けない", url.searchParams.get("start"), null);
  check("autoplay は付けない", url.searchParams.get("autoplay"), null);
  check(
    "start は整数秒で付く",
    new URL(youtubeSyncEmbedUrl("dQw4w9WgXcQ", "https://p.test", 120.7)).searchParams.get("start"),
    "120",
  );
  check(
    "負の start は 0 扱い (付けない)",
    new URL(youtubeSyncEmbedUrl("dQw4w9WgXcQ", "https://p.test", -5)).searchParams.get("start"),
    null,
  );

  console.log("\nプレーヤーへ送るメッセージ");
  check("handshake", JSON.parse(youtubeListeningMessage()), {
    event: "listening",
    id: 1,
    channel: "widget",
  });
  check("seekTo", JSON.parse(youtubeCommandMessage("seekTo", [120, true])), {
    event: "command",
    func: "seekTo",
    args: [120, true],
    id: 1,
    channel: "widget",
  });
  check("引数なし", JSON.parse(youtubeCommandMessage("pauseVideo")), {
    event: "command",
    func: "pauseVideo",
    args: [],
    id: 1,
    channel: "widget",
  });

  console.log("\nプレーヤーからの時刻の取り出し (取れないものは必ず null)");
  const info = (currentTime) =>
    JSON.stringify({ event: "infoDelivery", info: { currentTime } });
  check("JSON 文字列", parseYoutubePlayerTime(info(12.34)), 12.34);
  check("オブジェクトでも読む", parseYoutubePlayerTime({ event: "infoDelivery", info: { currentTime: 5 } }), 5);
  check("0 秒は有効な値", parseYoutubePlayerTime(info(0)), 0);
  check("別イベントは null", parseYoutubePlayerTime(JSON.stringify({ event: "onReady", info: { currentTime: 5 } })), null);
  check("currentTime 無しは null", parseYoutubePlayerTime(JSON.stringify({ event: "infoDelivery", info: { playerState: 1 } })), null);
  check("info 無しは null", parseYoutubePlayerTime(JSON.stringify({ event: "infoDelivery" })), null);
  check("文字列の時刻は null", parseYoutubePlayerTime(JSON.stringify({ event: "infoDelivery", info: { currentTime: "12" } })), null);
  check("負の時刻は null", parseYoutubePlayerTime(info(-1)), null);
  check("NaN は null", parseYoutubePlayerTime({ event: "infoDelivery", info: { currentTime: Number.NaN } }), null);
  check("壊れた JSON は null", parseYoutubePlayerTime("{not json"), null);
  check("null は null", parseYoutubePlayerTime(null), null);
  check("数値は null", parseYoutubePlayerTime(42), null);
  check("配列は null", parseYoutubePlayerTime([{ event: "infoDelivery" }]), null);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
