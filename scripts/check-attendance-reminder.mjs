/**
 * 出欠催促の純粋ロジックの検証 (2026-08-30)。
 *
 * 実行: `node scripts/check-attendance-reminder.mjs`
 *   (内部で tsc を直接叩いて attendance-reminder-core.ts だけを
 *    一時ディレクトリに JS 出力し、それを import して検証する)
 *
 * このプロジェクトにはテストランナーが無いが、催促は「実在の人へ
 * メンションが飛ぶ」取り消し不能な副作用なので、対象選定とテンプレート
 * 展開だけは機械的に確認できるようにしておく。
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = "src/lib/schedule/attendance-reminder-core.ts";

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

const outDir = mkdtempSync(join(tmpdir(), "reminder-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      SRC,
      // W-20 (2026-09-07): 頻度の純関数は attendance-reminder-keys.ts 側。
      "src/lib/schedule/attendance-reminder-keys.ts",
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
  // 2026-09-06: core が `./attendance-times` を import するようになった (W-14 の
  // Discord 相対時刻)。tsc は拡張子なしのまま出力し Node の ESM は解決できない
  // ため、出力された相対 import に `.js` を付ける (tsc は依存も同じ outDir に
  // 一緒に出力している)。
  // 2026-10-01 (監査 U-9): schedule/ の純モジュールが ../app-timezone を
  // 読むようになったので、出力は src/lib を根に schedule/ 以下へ出る
  // (--rootDir で固定)。相対 import の .js 付与も再帰で行う。
  for (const f of readdirSync(outDir, { recursive: true })) {
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
  const mod = await import(
    pathToFileURL(join(outDir, "schedule", "attendance-reminder-core.js")).href
  );

  console.log("\n[未回答の判定]");
  check("全角ハイフン (character-sheets の未回答)", mod.isUnanswered("－"), true);
  check("空文字", mod.isUnanswered(""), true);
  check("空白のみ", mod.isUnanswered("   "), true);
  check("undefined (行が無い)", mod.isUnanswered(undefined), true);
  check("◯ は回答済み", mod.isUnanswered("◯"), false);
  check("× は回答済み (不可も意思表示)", mod.isUnanswered("×"), false);
  check("△ は回答済み", mod.isUnanswered("△"), false);

  console.log("\n[JST 暦日キー]");
  // 2026-09-02 21:00 UTC = 2026-09-03 06:00 JST → JST では 3 日
  check(
    "UTC 21:00 は翌日の JST",
    mod.jstDayKey(Date.parse("2026-09-02T21:00:00Z")),
    "2026-9-3",
  );
  // 2026-09-02 14:59 UTC = 2026-09-02 23:59 JST → まだ 2 日
  check(
    "UTC 14:59 は同日の JST",
    mod.jstDayKey(Date.parse("2026-09-02T14:59:00Z")),
    "2026-9-2",
  );
  check(
    "JST hour (UTC 12:00 → JST 21 時)",
    mod.getJstHour(new Date("2026-09-02T12:00:00Z")),
    21,
  );

  console.log("\n[表示名の正規化]");
  check("全角英数 → 半角", mod.normalizeName("Ｌｙｍ"), "lym");
  check("空白除去 + 小文字化", mod.normalizeName(" y.Moshi "), "y.moshi");

  console.log("\n[催促対象の選定]");
  const members = [
    { name: "makiton", answered: true, discordUserId: null },
    { name: "enero", answered: false, discordUserId: null },
    { name: "Ｌｙｍ", answered: false, discordUserId: null },
    { name: "ないり", answered: false, discordUserId: null },
    { name: "カゲツ", answered: false, discordUserId: "222222222222222222" },
  ];
  const audience = mod.selectReminderAudience({
    members,
    // 表記ゆれ (半角 lym) でも対応表が引けること
    memberMap: { lym: "111111111111111111", enero: "not-an-id" },
    excluded: ["ないり"],
  });
  check(
    "対象は未入力かつ非除外のみ",
    audience.targets.map((t) => t.name),
    ["enero", "Ｌｙｍ", "カゲツ"],
  );
  check(
    "表記ゆれを吸収して ID を解決",
    audience.targets.find((t) => t.name === "Ｌｙｍ").discordUserId,
    "111111111111111111",
  );
  check(
    "不正な ID は採用しない (名前のみ)",
    audience.targets.find((t) => t.name === "enero").discordUserId,
    null,
  );
  check(
    "ソース由来 ID (native) はそのまま使う",
    audience.targets.find((t) => t.name === "カゲツ").discordUserId,
    "222222222222222222",
  );
  check("除外者は excluded に退避", audience.excluded, ["ないり"]);
  check("除外者は集計 (total) に含めない", audience.total, 4);
  check("回答済み数", audience.answered, 1);

  console.log("\n[本文テンプレート]");
  const rendered = mod.renderReminderTemplate(
    "{mentions}\n{date} ({day}) {time_start}〜{time_end} 未入力 {count}/{total}\n{site_url}",
    {
      targets: audience.targets,
      rawDate: "2026/09/03(木) 22:00~0:00",
      dayOfWeek: "木",
      startTime: "22:00",
      endTime: "0:00",
      answered: audience.answered,
      total: audience.total,
      siteUrl: "https://example.test",
    },
  );
  check(
    "メンションは ID 有りのみ <@...>、無い人は名前",
    rendered.split("\n")[0],
    "enero <@111111111111111111> <@222222222222222222>",
  );
  check(
    "件数 placeholder",
    rendered.split("\n")[1],
    "2026/09/03(木) 22:00~0:00 (木) 22:00〜0:00 未入力 3/4",
  );

  console.log("\n[メンション無害化]");
  check(
    "@everyone は崩される",
    mod.neutralizeMentions("@everyone").includes("​"),
    true,
  );
  const injected = mod.renderReminderTemplate("{names}", {
    targets: [{ name: "@everyone", discordUserId: null }],
    rawDate: "",
    dayOfWeek: "",
    startTime: "",
    endTime: "",
    answered: 0,
    total: 0,
    siteUrl: "",
  });
  check("名前経由の @everyone も崩される", injected.includes("​"), true);

  console.log("\n[W-20 (2026-09-07) 催促の頻度]");
  const keys = await import(
    pathToFileURL(join(outDir, "schedule", "attendance-reminder-keys.js")).href
  );
  const {
    parseReminderCadence,
    reminderLeadDaysToTry,
    reminderDedupMarker,
    REMINDER_DEFAULT_CADENCE,
  } = keys;

  // 既定は現行挙動。既存の設定を変えないことが最優先。
  check("既定は once (現行挙動)", REMINDER_DEFAULT_CADENCE, "once");
  check("未設定は once", parseReminderCadence(null), "once");
  check("空文字は once", parseReminderCadence("  "), "once");
  check("不正値は once", parseReminderCadence("hourly"), "once");
  check("daily は通る", parseReminderCadence("daily"), "daily");
  check(
    "once_plus_day_of は通る",
    parseReminderCadence("once_plus_day_of"),
    "once_plus_day_of",
  );

  check("once は期限の日だけ", reminderLeadDaysToTry("once", 2), [2]);
  check(
    "once_plus_day_of は期限 + 当日",
    reminderLeadDaysToTry("once_plus_day_of", 2),
    [2, 0],
  );
  // lead=0 のときに [0, 0] と二重に試さない。
  check(
    "lead 0 なら 1 つに畳む",
    reminderLeadDaysToTry("once_plus_day_of", 0),
    [0],
  );
  check("daily は期限から当日まで", reminderLeadDaysToTry("daily", 3), [3, 2, 1, 0]);
  check("daily の lead 0", reminderLeadDaysToTry("daily", 0), [0]);
  check("不正な lead は 0 扱い", reminderLeadDaysToTry("daily", -1), [0]);

  // dedup マーカー: once は開催日だけ、それ以外は暦日を混ぜて
  // 「同じ開催日でも 1 日 1 通」にする (混ぜないと当日分が飛ばない)。
  check(
    "once のマーカーは開催日だけ",
    reminderDedupMarker("once", "2026-09-10", "2026-09-09"),
    "2026-09-10",
  );
  check(
    "daily のマーカーは暦日を含む",
    reminderDedupMarker("daily", "2026-09-10", "2026-09-09"),
    "2026-09-10#2026-09-09",
  );
  check(
    "翌日は別マーカーになる",
    reminderDedupMarker("daily", "2026-09-10", "2026-09-09") !==
      reminderDedupMarker("daily", "2026-09-10", "2026-09-10"),
    true,
  );

  console.log("\n[2026-10-02 複数スケジュールの段階 2: 予定の印]");
  const {
    reminderSessionKey,
    joinReminderMarkers,
    parseReminderMarkers,
    pickReminderBatch,
    REMINDER_DEFAULT_TEMPLATE,
  } = keys;
  const RAW = "2026/10/09(金) 21:00~24:00";
  check("スケジュールが 1 つなら従来どおり rawDate (更新直後に二重送信しない)", reminderSessionKey(RAW, null), RAW);
  check("2 つ以上なら ID を添える", reminderSessionKey(RAW, "sch-ult"), `${RAW}@sch-ult`);
  check("印の組は並べ替え・重複を除いて改行でつなぐ", joinReminderMarkers(["b", "a", "b", ""]), "a\nb");
  check("以前の 1 件だけの印もそのまま読める", parseReminderMarkers(RAW), [RAW]);
  check("空 / null は空", [parseReminderMarkers(""), parseReminderMarkers(null)], [[], []]);
  check("往復", parseReminderMarkers(joinReminderMarkers(["x", "y"])), ["x", "y"]);

  console.log("\n[送る予定の選び方 (pickReminderBatch)]");
  const c = (lead, marker) => ({ lead, marker });
  const order = [2, 1, 0];
  const A = c(2, "A"), B = c(1, "B"), C2 = c(2, "C");
  let r = pickReminderBatch([A, B], order, new Set(), true);
  check("期限が遠い日 (2 日前) を先に送る", r.picked.map((x) => x.marker), ["A"]);
  check("印は A", r.marker, "A");
  r = pickReminderBatch([A, B], order, new Set(parseReminderMarkers(r.marker)), true);
  check("次の実行は B (A は送信済み)", r.picked.map((x) => x.marker), ["B"]);
  check("印は A と B の組 (A を落とさない)", r.marker, "A\nB");
  r = pickReminderBatch([A, B], order, new Set(parseReminderMarkers(r.marker)), true);
  check("その次は何も送らない (以前は A と B を交互に送り直していた)", r.picked, []);
  check("印はそのまま", r.marker, "A\nB");
  r = pickReminderBatch([A, C2, B], order, new Set(), true);
  check("同じ日の 2 つのスケジュールはまとめて 1 通", r.picked.map((x) => x.marker), ["A", "C"]);
  r = pickReminderBatch([B], order, new Set(["A", "B"]), true);
  check("範囲から外れた古い印は落ちる", r.marker, "B");
  r = pickReminderBatch([A, B], order, new Set(["A"]), false);
  check("手動 (respectDedup=false) は送信済みでも選ぶ", r.picked.map((x) => x.marker), ["A"]);
  check("手動でも範囲内の送信済みの印は残る", r.marker, "A");
  check("候補が無ければ何も選ばない", pickReminderBatch([], order, new Set(), true), { picked: [], marker: "" });

  console.log("\n[本文のスケジュール名]");
  const base = {
    targets: [{ name: "Lym", discordUserId: "123456789012345678" }],
    rawDate: RAW, dayOfWeek: "金", startTime: "21:00", endTime: "24:00",
    answered: 3, total: 4, siteUrl: "",
  };
  check("既定テンプレートに {schedule_block}", REMINDER_DEFAULT_TEMPLATE.includes("{schedule_block}"), true);
  check(
    "スケジュールが 1 つ (名前なし) なら従来どおり",
    mod.renderReminderTemplate(REMINDER_DEFAULT_TEMPLATE, base).includes("⏰ 2026/10/09(金) 21:00~24:00 (金)"),
    true,
  );
  check(
    "名前があれば【名前】",
    mod.renderReminderTemplate(REMINDER_DEFAULT_TEMPLATE, { ...base, scheduleName: "絶PT" }).includes("⏰ 【絶PT】2026/10/09"),
    true,
  );
  check("{schedule} は名前だけ", mod.renderReminderTemplate("{schedule}|{date}", { ...base, scheduleName: "絶PT" }), `絶PT|${RAW}`);
  check(
    "自作テンプレートに差し込みが無ければ先頭に付く",
    mod.renderReminderTemplate("{mentions} 未入力です", { ...base, scheduleName: "絶PT" }).startsWith("【絶PT】\n"),
    true,
  );
  check(
    "名前が無ければ先頭に何も付かない",
    mod.renderReminderTemplate("{mentions} 未入力です", base),
    "<@123456789012345678> 未入力です",
  );
  check(
    "名前の @everyone も崩す",
    mod.renderReminderTemplate("{schedule}", { ...base, scheduleName: "@everyone" }) !== "@everyone",
    true,
  );

  console.log("\n[Discord の本文の上限]");
  check("上限以下はそのまま", mod.clampDiscordContent("abc", 5), "abc");
  check("超えたら末尾を切って …", mod.clampDiscordContent("abcdef", 5), "abcd…");
  check("既定の上限は 2000", Array.from(mod.clampDiscordContent("あ".repeat(2500))).length, 2000);
  check("サロゲートペアを割らない", mod.clampDiscordContent("😀😀😀", 2), "😀…");

  console.log("\n[配線: 表示中のスケジュールで絞らない (段階 2)]");
  const readSrc = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  const reminderSrc = readSrc("src/lib/server/attendance-reminder.ts");
  const notifySrc = readSrc("src/lib/server/native-schedule-discord.ts");
  const summarySrc = readSrc("src/lib/server/attendance-summary-actions.ts");
  for (const [label, src] of [["催促", reminderSrc], ["開催確定の通知", notifySrc], ["出席サマリー", summarySrc]]) {
    check(`${label}: 表示中のスケジュールの ID を読まない`, /getActiveNativeScheduleId/.test(src), false);
  }
  check("催促: 送る予定は pickReminderBatch で選ぶ", /pickReminderBatch\(\s*candidates,/.test(reminderSrc), true);
  check("催促: 予定の印は reminderSessionKey (スケジュール ID 付き)", /reminderSessionKey\(p\.rawDate, p\.scheduleId\)/.test(reminderSrc), true);
  check("催促: 本文は上限に収める", /clampDiscordContent\(/.test(reminderSrc), true);
  check("催促: 送信済みの印は手動でも読む (範囲内の印を落とさない)", /const lastSent = \(await fetchAppSetting\(REMINDER_LAST_SENT_KEY\)\) \?\? "";/.test(reminderSrc), true);
  check("通知: スケジュールが 2 つ以上のときだけ名前", /schedules\.length > 1/.test(notifySrc), true);
  check("通知: {schedule} / {schedule_block} を置き換える", /\|schedule_block\|schedule\)\\\}/.test(notifySrc), true);
  check("通知: 自作テンプレートに差し込みが無ければ先頭に付ける", /scheduleBlock && !\/\\\{schedule\(\?:_block\)\?\\\}\/\.test\(template\)/.test(notifySrc), true);
  check("通知: 既定の書式の 1 行目にも名前", /\$\{mentionPrefix\}\$\{scheduleBlock\}本日の固定活動予定日です/.test(notifySrc), true);
  const tplSrc = readSrc("src/lib/schedule/native-discord-template.ts");
  check("通知の既定テンプレートに {schedule_block}", /"\{mention\}\{schedule_block\}本日の固定活動予定日です"/.test(tplSrc), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("すべて成功");
