/**
 * YouTube の再生リストからの動画取り込み (2026-10-02) の検証。
 * 実行: `node scripts/check-youtube-playlist.mjs`
 *
 * 限定公開の動画はチャンネルの一覧に出ないので、admin が登録した再生リストを
 * YouTube Data API で読んで取り込む。ここでは次を固定する:
 *
 *   1. 再生リスト ID の切り出し (`src/lib/youtube-playlist.ts`)。API の
 *      クエリにそのまま入るので、形の違うもの・別ホストの URL は通さない
 *   2. API の応答から取り込む動画を選ぶ規則 (非公開・削除済み・重複を外す)
 *      と、既存の動画との照合を **動画 ID で** 行うこと (Discord に
 *      `youtu.be/<id>` で貼られた動画を二重に入れない)
 *   3. 配線: schema の列と上限、`source = 'youtube'`、保存側の検査、除外、
 *      毎晩の cron、エラーの理由に API キーを出さないこと
 */
import { execFileSync } from "node:child_process";
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

const outDir = mkdtempSync(join(tmpdir(), "youtube-playlist-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc", "src/lib/youtube-playlist.ts",
      "--outDir", outDir,
      "--rootDir", "src/lib",
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
  const p = await import(pathToFileURL(join(outDir, "youtube-playlist.js")).href);
  const {
    YOUTUBE_PLAYLIST_MAX,
    parsePlaylistId,
    parsePlaylistInput,
    playlistUrl,
    canonicalVideoUrl,
    toPlaylistCandidates,
    selectNewCandidates,
  } = p;

  // 2026-10-02 に実測した再生リスト (限定公開 11 本)。
  const REAL = "PL4BAsvXxlPI4y-dRlI3B44yxamnFd7j4G";

  console.log("1. 再生リスト ID の切り出し");
  check("再生リストの URL", parsePlaylistId(`https://www.youtube.com/playlist?list=${REAL}`), REAL);
  check("再生中の URL (watch?v=…&list=…)", parsePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${REAL}&index=3`), REAL);
  check("m.youtube.com", parsePlaylistId(`https://m.youtube.com/playlist?list=${REAL}`), REAL);
  check("www 無し", parsePlaylistId(`https://youtube.com/playlist?list=${REAL}`), REAL);
  check("ID だけ", parsePlaylistId(REAL), REAL);
  check("前後の空白", parsePlaylistId(`  ${REAL}  `), REAL);
  check("list の無い動画 URL は null", parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  check("別ホストは null", parsePlaylistId(`https://evil.example.com/playlist?list=${REAL}`), null);
  check("youtube.com を装ったホストは null", parsePlaylistId(`https://www.youtube.com.evil.test/playlist?list=${REAL}`), null);
  check("ミックス (RD…) は null", parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"), null);
  check("後で見る (WL) は null", parsePlaylistId("https://www.youtube.com/playlist?list=WL"), null);
  check("高評価 (LL…) は null", parsePlaylistId("LLabcdefghijklmnopqrstu"), null);
  check("クエリの注入は null", parsePlaylistId(`${REAL}&key=x`), null);
  check("短すぎる ID は null", parsePlaylistId("PL123"), null);
  check("javascript: は null", parsePlaylistId("javascript:alert(1)"), null);
  check("空は null", parsePlaylistId(""), null);

  console.log("\n   設定画面の入力");
  const input = parsePlaylistInput(
    `https://www.youtube.com/playlist?list=${REAL}\n${REAL}, https://example.com/x\n\nPLabcdefghijklmnop`,
  );
  check("同じ再生リストは 1 本にまとめる", input.ids, [REAL, "PLabcdefghijklmnop"]);
  check("読めなかった入力はそのまま返す", input.invalid, ["https://example.com/x"]);
  check("空の入力", parsePlaylistInput("  \n "), { ids: [], invalid: [] });
  check("ID → URL", playlistUrl(REAL), `https://www.youtube.com/playlist?list=${REAL}`);
  check("URL → ID の往復", parsePlaylistId(playlistUrl(REAL)), REAL);
  check("上限は 10", YOUTUBE_PLAYLIST_MAX, 10);

  console.log("\n2. API の応答から取り込む動画を選ぶ");
  const item = (videoId, privacyStatus, videoPublishedAt, title) => ({
    snippet: { title, publishedAt: "2026-02-01T00:00:00Z" },
    contentDetails: { videoId, ...(videoPublishedAt ? { videoPublishedAt } : {}) },
    status: { privacyStatus },
  });
  const items = [
    item("Py_zQ07tPKU", "unlisted", "2025-06-03T06:40:44Z", "2025 05 27 22 00 57"),
    item("BJB14iu9P7c", "public", "2025-06-03T06:36:09Z", "  2025 05 26 22 25 26  "),
    item("A77--j054mI", "private", undefined, "Private video"),
    item("8RWjheAg-Q8", "privacyStatusUnspecified", undefined, "Deleted video"),
    item("nogqSoTL7zY", "private", "2025-06-03T06:18:33Z", "非公開に戻した動画"),
    item("Py_zQ07tPKU", "unlisted", "2025-06-03T06:40:44Z", "2025 05 27 22 00 57"),
    item("bad id", "public", "2025-06-03T06:00:00Z", "壊れた ID"),
    item("ZtSA_nHoK7g", "unlisted", "2025-03-27T06:12:29Z", ""),
  ];
  const cands = toPlaylistCandidates(items);
  check("限定公開と公開だけ・重複は 1 件", cands.map((c) => c.videoId), ["Py_zQ07tPKU", "BJB14iu9P7c", "ZtSA_nHoK7g"]);
  check("タイトルの前後の空白は落とす", cands[1].title, "2025 05 26 22 25 26");
  check("タイトルが空なら URL で埋める", cands[2].title, "https://www.youtube.com/watch?v=ZtSA_nHoK7g");
  check("公開日時は動画の公開日時 (再生リストに足した日時ではない)", cands[0].publishedAt, "2025-06-03T06:40:44Z");
  check("空の応答", toPlaylistCandidates([]), []);

  console.log("\n   既存の動画・除外との照合 (動画 ID で)");
  const sel = selectNewCandidates(
    cands,
    ["https://youtu.be/Py_zQ07tPKU", "https://docs.google.com/x"],
    ["https://www.youtube.com/watch?v=ZtSA_nHoK7g&t=30s"],
  );
  check("Discord に youtu.be で入っていた動画は既存", sel.duplicates, 1);
  check("除外 (別の URL の形) も動画 ID で効く", sel.blocked, 1);
  check("残るのは新しい 1 本", sel.fresh.map((c) => c.videoId), ["BJB14iu9P7c"]);
  check("保存する URL の形", canonicalVideoUrl("BJB14iu9P7c"), "https://www.youtube.com/watch?v=BJB14iu9P7c");

  console.log("\n3. 配線");
  const schema = read("supabase/schema.sql");
  check("schema: 列を足す", /ADD COLUMN IF NOT EXISTS youtube_playlist_ids text\[\];/.test(schema), true);
  const cap = schema.match(/cardinality\(youtube_playlist_ids\) <= (\d+)/);
  check("schema: 上限が YOUTUBE_PLAYLIST_MAX と同じ", cap ? Number(cap[1]) : null, YOUTUBE_PLAYLIST_MAX);
  check(
    "schema: source に youtube を足した CHECK",
    /ADD CONSTRAINT category_links_source_check\s+CHECK \(source IN \('manual','discord','youtube'\)\);/.test(schema),
    true,
  );
  check(
    "schema: 古い source の CHECK を名前に頼らず、source 列だけを参照する CHECK として探して外す",
    schema.includes("AND att.attname = 'source'") &&
      schema.includes("AND cardinality(con.conkey) = 1") &&
      schema.includes("EXECUTE format('ALTER TABLE public.category_links DROP CONSTRAINT %I', c.conname);"),
    true,
  );

  const types = read("src/lib/supabase/types.ts");
  check("types: source に youtube", /export type CategoryLinkSource = "manual" \| "discord" \| "youtube";/.test(types), true);
  check("types: 行 → Category で再生リストを写す", /youtubePlaylistIds: row\.youtube_playlist_ids \?\? \[\],/.test(types), true);

  const actions = read("src/lib/server/categories-actions.ts");
  check("保存: 更新してよい列に入っている", /"youtube_playlist_ids",/.test(actions), true);
  check("保存: 1 本ずつ parsePlaylistId で検査する", /const id = typeof v === "string" \? parsePlaylistId\(v\) : null;/.test(actions), true);
  check("保存: 上限を超えたら弾く", /ids\.length > YOUTUBE_PLAYLIST_MAX/.test(actions), true);
  check("除外: 再生リストの取り込み分も消す", /\.in\("source", \["discord", "youtube"\]\)/.test(actions), true);
  const nowStart = actions.indexOf("export async function importYoutubePlaylistsNow(");
  const nowBody = nowStart < 0 ? "" : actions.slice(nowStart, actions.indexOf("\nexport ", nowStart + 1));
  check(
    "今すぐ取り込む: admin のゲートを取り込みより先に通す",
    nowBody.indexOf("assertAdminResult()") > 0 &&
      nowBody.indexOf("assertAdminResult()") < nowBody.indexOf("runYoutubePlaylistImport("),
    true,
  );

  const route = read("src/app/api/cron/import-discord/route.ts");
  check("cron: 再生リストの取り込みにも同じ締切を渡す", /runYoutubePlaylistImport\(\{\s*deadlineAt\s*\}\)/.test(route), true);
  check("cron: Discord 取り込みと並べて走らせる", /Promise\.all\(\[\s*runDiscordImport\(/.test(route), true);
  check("cron: 入った動画の数に再生リストの分も足す", route.includes("countPlaylistInsertedVideos(playlists.results)"), true);

  const server = read("src/lib/server/youtube-playlist-import.ts");
  check("取り込み: source は youtube", /source: "youtube" as const,/.test(server), true);
  check("取り込み: 例外の理由は種類だけ (URL を含む message を出さない)", /e instanceof Error \? e\.name : "fetch failed"/.test(server), true);
  check("取り込み: 理由に apiKey / URL を埋め込まない", /reason: [^\n]*(apiKey|pathAndQuery|API_BASE)/.test(server), false);
  check("取り込み: DB の値もクエリに使う前に parsePlaylistId を通す", /\.map\(\(v\) => parsePlaylistId\(v\)\)/.test(server), true);

  const menu = read("src/components/portal/link-card-menu.tsx");
  check("カードの ⋮: 取り込み分 (手動以外) に「今後取り込まない」", /link\.source !== "manual" && \(/.test(menu), true);
  const form = read("src/components/portal/category-form-dialog.tsx");
  check("設定画面: 入力を parsePlaylistInput で検査する", /const parsedPlaylists = parsePlaylistInput\(playlistInput\);/.test(form), true);
  check("設定画面: 保存に再生リストを載せる", /youtube_playlist_ids:\s*parsedPlaylists\.ids\.length > 0 \? parsedPlaylists\.ids : null,/.test(form), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
