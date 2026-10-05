/**
 * Discord のボタンで出欠に答える (2026-10-05、F-6 の W-21) の検証。
 * 実行: `node scripts/check-discord-interactions.mjs`
 *
 * `/api/discord/interactions` は cookie の無い公開の書き込み口なので、
 *   - 署名 (Ed25519) を検証してから中身を信じること (鍵はその場で生成して
 *     本物の署名で通す。偽の署名・改ざん・古い時刻・別の鍵は通らない)
 *   - 公開鍵が無ければ全部拒否すること (fail-closed)
 *   - 書くのは押した本人の行だけ・有効なメンバーだけ・いまの選択肢だけ
 * を固定する。ボタンの形 (custom_id / 行と数の上限 / 色) と、催促にボタンを
 * 付ける条件 (設定 ON + 公開鍵あり + 自前作成式) も見る。
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

// 鍵をその場で作る (Discord の公開鍵と同じ 32 バイトの生の Ed25519 を 16 進で)。
function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const hex = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("hex");
  return { hex, privateKey };
}
const signHex = (privateKey, timestamp, body) =>
  sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

const outDir = mkdtempSync(join(tmpdir(), "discord-interactions-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/discord-interactions.ts",
      "--outDir", outDir, "--rootDir", "src/lib",
      "--target", "es2022", "--module", "es2022", "--moduleResolution", "bundler", "--strict",
    ],
    { stdio: "inherit" },
  );
  const fixImports = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, ent.name);
      if (ent.isDirectory()) fixImports(fp);
      else if (ent.name.endsWith(".js")) {
        writeFileSync(fp, readFileSync(fp, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(?<!\.js)(["'])/g, "$1$2.js$3"));
      }
    }
  };
  fixImports(outDir);
  const di = await import(pathToFileURL(join(outDir, "discord-interactions.js")).href);

  console.log("署名の検証");
  const k = makeKey();
  const other = makeKey();
  const now = 1_790_000_000;
  const ts = String(now);
  const body = '{"type":1}';
  const sig = signHex(k.privateKey, ts, body);
  const verify = (o) =>
    di.verifyDiscordSignature({ publicKeyHex: k.hex, signatureHex: sig, timestamp: ts, body, nowSeconds: now, ...o });
  check("本物の署名は通る", await verify({}), true);
  check("本文を 1 文字変えたら通らない", await verify({ body: '{"type":2}' }), false);
  check("時刻を変えたら通らない", await verify({ timestamp: String(now + 1) }), false);
  check("別の鍵では通らない", await verify({ publicKeyHex: other.hex }), false);
  check("署名の形が違えば通らない", await verify({ signatureHex: "00" }), false);
  check("鍵の形が違えば通らない", await verify({ publicKeyHex: "zz" }), false);
  check("時刻が数字でなければ通らない", await verify({ timestamp: "abc" }), false);
  const oldTs = String(now - 301);
  check(
    "5 分より古い要求は本物の署名でも通らない (使い回しを弾く)",
    await verify({ timestamp: oldTs, signatureHex: signHex(k.privateKey, oldTs, body) }),
    false,
  );
  const edgeTs = String(now - 300);
  check(
    "ちょうど 5 分前は通る",
    await verify({ timestamp: edgeTs, signatureHex: signHex(k.privateKey, edgeTs, body) }),
    true,
  );
  const futureTs = String(now + 301);
  check(
    "5 分より先の時刻も通らない",
    await verify({ timestamp: futureTs, signatureHex: signHex(k.privateKey, futureTs, body) }),
    false,
  );
  check("許容幅は 300 秒", di.SIGNATURE_MAX_AGE_SECONDS, 300);

  console.log("\nボタンの custom_id");
  const sid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  check("形", di.attendanceCustomId(sid, "○"), `att1:${sid}:○`);
  check("読み戻せる", di.parseAttendanceCustomId(di.attendanceCustomId(sid, "○")), { sessionId: sid, symbol: "○" });
  check("ID は小文字にそろえる", di.parseAttendanceCustomId(`att1:${sid.toUpperCase()}:△`), { sessionId: sid, symbol: "△" });
  check("記号に : があっても読める", di.parseAttendanceCustomId(`att1:${sid}:遅:30`), { sessionId: sid, symbol: "遅:30" });
  check(
    "形が違うものは読まない",
    [
      `att0:${sid}:○`, `att1:${sid}`, `att1:not-a-uuid:○`, `att1:${sid}:`,
      `att1:${sid}:a\nb`, `att1:${sid}:${"x".repeat(33)}`, 42, null,
    ].map((x) => di.parseAttendanceCustomId(x)),
    [null, null, null, null, null, null, null, null],
  );

  console.log("\nボタンにする選択肢");
  check("未回答の印を外す", di.attendanceButtonChoices(["○", "×", "△", "⏰", "－"]), ["○", "×", "△", "⏰"]);
  check("空と重複を外す", di.attendanceButtonChoices([" ○ ", "", "○", "×"]), ["○", "×"]);
  check("5 つまで", di.attendanceButtonChoices(["a", "b", "c", "d", "e", "f"]).length, 5);
  check("色: ○ は緑 / × は赤 / それ以外は灰", ["○", "×", "△"].map(di.attendanceButtonStyle), [3, 4, 2]);

  console.log("\nボタンの並び");
  check("予定の短い名前", di.sessionButtonLabel("2026/10/07(水) 22:00~0:00", null), "10/07(水)");
  check("スケジュール名を後ろに", di.sessionButtonLabel("2026/10/07(水) 22:00~0:00", "絶"), "10/07(水) 絶");
  const one = di.attendanceComponents([{ sessionId: sid, label: "10/07(水)" }], ["○", "×"]);
  check("予定 1 つ: 1 行・記号だけ", one, [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "○", custom_id: `att1:${sid}:○` },
        { type: 2, style: 4, label: "×", custom_id: `att1:${sid}:×` },
      ],
    },
  ]);
  const sid2 = "1f8fad5b-d9cb-469f-a165-70867728950e";
  const two = di.attendanceComponents(
    [{ sessionId: sid, label: "10/07(水) 零式" }, { sessionId: sid2, label: "10/07(水) 絶" }],
    ["○"],
  );
  check("予定 2 つ: 行ごとに予定の名前を付ける", two.map((r) => r.components.map((b) => b.label)), [["10/07(水) 零式 ○"], ["10/07(水) 絶 ○"]]);
  check(
    "6 つ以上の予定は 5 行まで",
    di.attendanceComponents(Array.from({ length: 7 }, () => ({ sessionId: sid, label: "x" })), ["○"]).length,
    5,
  );
  check("選択肢が無ければボタンなし", di.attendanceComponents([{ sessionId: sid, label: "x" }], []), []);

  console.log("\n押した人 / 返事");
  check("サーバーのチャンネル (member.user)", di.interactionUserId({ member: { user: { id: "123456789012345678" } } }), "123456789012345678");
  check("DM (user)", di.interactionUserId({ user: { id: "123456789012345678" } }), "123456789012345678");
  check("ID の形が違えば null", [di.interactionUserId({ user: { id: "abc" } }), di.interactionUserId(null)], [null, null]);
  check("返事は本人だけ・メンションなし", di.ephemeralReply("x"), {
    type: 4,
    data: { content: "x", flags: 64, allowed_mentions: { parse: [] } },
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log("\n配線");
const route = read("src/app/api/discord/interactions/route.ts");
const post = fnBody(route, "POST");
const idx = (s) => post.indexOf(s);
check("公開鍵が無ければ検証しない = 通さない (fail-closed)", /const verified =\s*publicKey !== "" &&/.test(post), true);
check("通らなければ 401", /if \(!verified\) \{\s*return new NextResponse\("invalid request signature", \{ status: 401 \}\);/.test(post), true);
check(
  "生の本文を取る → 署名を検証 → JSON として読む の順",
  idx("await req.text()") >= 0 && idx("await req.text()") < idx("verifyDiscordSignature(") && idx("verifyDiscordSignature(") < idx("JSON.parse(body)"),
  true,
);
check("PING には PONG", /payload\.type === INTERACTION_PING\) \{\s*return NextResponse\.json\(\{ type: RESPONSE_PONG \}\);/.test(post), true);
check("押した人は署名された要求の中の ID だけ", /discordUserId: userId,/.test(post) && /const userId = interactionUserId\(payload\);/.test(post), true);
check("返事はすべて本人だけ (ephemeral)", (post.match(/NextResponse\.json\(/g) ?? []).length === (post.match(/NextResponse\.json\(ephemeralReply\(|NextResponse\.json\(\{ type: RESPONSE_PONG \}\)|NextResponse\.json\(\s*ephemeralReply\(/g) ?? []).length, true);
const proxy = read("src/proxy.ts");
const publicPaths = proxy.match(/const PUBLIC_PATHS = new Set<string>\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
check("proxy: ログインの対象外 (署名で認証)", /^\s*"\/api\/discord\/interactions",$/m.test(publicPaths), true);
check("proxy: 署名より前で連打を抑える", /scope: "api-discord-interactions",\s*match: \(p\) => p === "\/api\/discord\/interactions",/.test(proxy), true);

const answer = fnBody(read("src/lib/server/discord-attendance.ts"), "answerAttendanceFromDiscord");
const aidx = (s) => answer.indexOf(s);
check("自前作成式のときだけ", /if \(mode !== "native"\) \{/.test(answer), true);
check("中止の予定には書かない", /if \(session\.status === "CANCELLED"\) return/.test(answer), true);
check("有効なメンバーだけ", /if \(!member \|\| member\.is_active !== true\) \{/.test(answer), true);
check("いまの選択肢のボタンにある記号だけ", /if \(!attendanceButtonChoices\(choices\)\.includes\(input\.symbol\)\) \{/.test(answer), true);
check("書くのは押した本人の行だけ", /discord_user_id: member\.discord_user_id,/.test(answer) && /\.eq\("discord_user_id", input\.discordUserId\)/.test(answer), true);
check(
  "確かめてから書く (確認 4 つ → upsert の順)",
  [aidx('mode !== "native"'), aidx('"CANCELLED"'), aidx("is_active !== true"), aidx(".includes(input.symbol)"), aidx(".upsert(")].every(
    (v, i, a) => v >= 0 && (i === 0 || a[i - 1] < v),
  ),
  true,
);
check("出られない記号では予定時刻を消す (Web の保存と同じ)", /symbolAllowsTimes\(input\.symbol\) \? \{\} : \{ arrive_at: null, leave_at: null \}/.test(answer), true);
check("全員回答の自動確定も見る", /await maybeAutoConfirmSession\(session\.id\);/.test(answer), true);

const reminder = read("src/lib/server/attendance-reminder.ts");
const buttons = fnBody(reminder, "reminderButtons");
check("催促: 公開鍵が無ければボタンを付けない", /if \(!process\.env\.DISCORD_PUBLIC_KEY\?\.trim\(\)\) return \[\];/.test(buttons), true);
check("催促: 設定が ON のときだけ (既定 OFF)", /if \(enabled !== "true"\) return \[\];/.test(buttons), true);
check("催促: 自前作成式の予定 (sessionId) だけ", /p\.sessionId\s*\?/.test(buttons), true);
check("催促: 同期式の予定には ID を持たせない", /scheduleName: null,\s*sessionId: null,/.test(fnBody(reminder, "collectFromSync")), true);
check("催促: ボタンが空なら components を送らない", /\.\.\.\(input\.components\.length > 0 \? \{ components: input\.components \} : \{\}\)/.test(reminder), true);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
