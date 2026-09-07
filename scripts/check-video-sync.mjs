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
    "npx",
    [
      "tsc", "src/lib/video-sync.ts",
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
