/**
 * シートの自前の SWR (src/lib/server/redis-swr.ts) の検証 (2026-11-20、L-24)。
 * 実行: `node scripts/check-sheet-swr.mjs`
 *
 * 旧方式 (`unstable_cache(…, { revalidate: 60 })` を描画中に呼ぶ) は、取り直しが
 * 応答の後に waitUntil の外で走り、本番で「revalidating cache with key: …
 * TimeoutError」が別のルートに記録されていた。新方式は保存先 (Upstash) に
 * 自前で置き、**保存先に書くのは after() に渡した関数の中だけ** にする。
 *
 *   (a) 純ロジック: 偽の保存先 / after / 時計で、空・新しい・古い・保存先の
 *       失敗・非公開・一時的な失敗・締め切り超え・同じインスタンスの重なり・
 *       印の取り合い・after が使えない、を回す。どの経路でも「after を流す
 *       前に保存先へ書いていない」ことを見る
 *   (b) 静的: src のどこも unstable_cache を使わない (2026-11-20 に xivapi・
 *       デモの 3 か所も redis-swr に移した。同じ凍結のエラーが xivapi でも本番で
 *       出ていた)、redis-swr.ts が next も Redis も import しない、after に関数を
 *       渡す、Upstash の再試行を切っている
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になり、CI の ubuntu では
 *   通るので壊れていることに気付けない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
const warnings = [];
process.on("warning", (w) => warnings.push(w.name));
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/** コメントを落とす。文字列の中は残す。 */
function code(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (c === "/" && n === "*") {
      const j = src.indexOf("*/", i + 2);
      i = j < 0 ? src.length : j + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * 偽の部品一式。`phase` が "render" の間に保存先へ書いたら記録する
 * (`writesDuringRender`)。after は溜めておき、`flush()` で流す。
 */
function rig({ now = 1_000_000 } = {}) {
  const state = {
    t: now,
    phase: "render",
    data: new Map(),
    ops: [],
    writesDuringRender: [],
    afters: [],
    logs: [],
    fetches: [],
    getThrows: false,
    setThrows: false,
    lockHeld: false,
    afterThrows: false,
  };
  const write = (op, key) => {
    state.ops.push(`${op} ${key}`);
    if (state.phase === "render") state.writesDuringRender.push(`${op} ${key}`);
  };
  const store = {
    async get(key) {
      state.ops.push(`get ${key}`);
      if (state.getThrows) {
        const e = new Error("boom");
        e.name = "TimeoutError";
        throw e;
      }
      return state.data.get(key) ?? null;
    },
    async set(key, entry, ttl) {
      write("set", key);
      if (state.setThrows) throw new Error("set failed");
      state.data.set(key, entry);
      state.lastTtl = ttl;
    },
    async del(key) {
      write("del", key);
      state.data.delete(key);
    },
    async acquire(key) {
      write("acquire", key);
      if (state.lockHeld) return false;
      state.lockHeld = true;
      return true;
    },
  };
  const deps = {
    store,
    after(task) {
      if (state.afterThrows) throw new Error("after() outside request");
      if (typeof task !== "function") throw new Error("after には関数を渡す");
      state.afters.push(task);
    },
    now: () => state.t,
    log: (level, event, key, detail) => state.logs.push({ level, event, detail }),
  };
  async function flush() {
    state.phase = "after";
    while (state.afters.length) await state.afters.shift()();
    state.phase = "render";
  }
  return { state, deps, flush };
}

/** 呼ばれた回数と返す値を決められる取得。 */
function fetcher(state, results) {
  return async (arg) => {
    state.fetches.push(arg);
    const r = typeof results === "function" ? await results(arg) : results;
    return r;
  };
}

const OK = (v) => ({ ok: true, value: v });
const KEY = (arg) => `k:${arg}`;

async function pureLogic(createRedisSwr) {
  const make = (r, fetchResult, extra = {}) =>
    createRedisSwr(r.deps, {
      storeKey: KEY,
      fetch: fetcher(r.state, fetchResult),
      freshMs: 60_000,
      ttlSeconds: 86_400,
      failTtlMs: 30_000,
      timedOutReason: "timed out",
      ...extra,
    });
  const far = (r) => r.state.t + 6_000;

  console.log("(a) 空");
  {
    const r = rig();
    const swr = make(r, OK("v1"));
    const got = await swr.get("a", far(r));
    check("取得した値を返す", got, { ok: true, value: "v1" });
    check("描画中に取得は 1 本", r.state.fetches.length, 1);
    check("描画中は保存先に書かない", r.state.writesDuringRender, []);
    check("after が 1 本予約された", r.state.afters.length, 1);
    await r.flush();
    check("after の中で書いた", r.state.data.get("k:a"), { fetchedAt: r.state.t, value: "v1" });
    check("期限は 1 日", r.state.lastTtl, 86_400);
    check("written のログ", r.state.logs.some((l) => l.event === "written"), true);
    check("印は残らない", swr.stats().inflight, 0);
  }

  console.log("(a) 新しい");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 10_000, value: "cached" });
    const swr = make(r, OK("v2"));
    check("保存先の値を返す", await swr.get("a", far(r)), { ok: true, value: "cached" });
    check("取得しない", r.state.fetches.length, 0);
    check("after を予約しない", r.state.afters.length, 0);
  }

  console.log("(a) 古い");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 61_000, value: "old" });
    const swr = make(r, OK("new"));
    check("古い値をすぐ返す", await swr.get("a", far(r)), { ok: true, value: "old" });
    check("描画中は取得しない (取り直しは応答の後)", r.state.fetches.length, 0);
    check("描画中は保存先に書かない", r.state.writesDuringRender, []);
    check("同じインスタンスの 2 本目は予約しない", (await swr.get("a", far(r)), r.state.afters.length), 1);
    r.state.t += 100;
    await r.flush();
    check("after の中で取得した", r.state.fetches.length, 1);
    check("after の中で印を取ってから書いた", r.state.ops.filter((o) => !o.startsWith("get")), ["acquire k:a:lock", "set k:a"]);
    check("新しい値に置き換わった", r.state.data.get("k:a").value, "new");
    check("次は新しい値", await swr.get("a", far(r)), { ok: true, value: "new" });
  }

  console.log("(a) 古い: ほかのインスタンスが取り直し中 (印が取れない)");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 61_000, value: "old" });
    r.state.lockHeld = true;
    const swr = make(r, OK("new"));
    await swr.get("a", far(r));
    await r.flush();
    check("取得しない", r.state.fetches.length, 0);
    check("書かない", r.state.data.get("k:a").value, "old");
    check("印は残らない", swr.stats().inflight, 0);
  }

  console.log("(a) 保存先の失敗");
  {
    const r = rig();
    r.state.getThrows = true;
    const swr = make(r, OK("v1"));
    check("読めなくてもその場で取って返す", await swr.get("a", far(r)), { ok: true, value: "v1" });
    check("store read failed のログ", r.state.logs.some((l) => l.event === "store read failed"), true);
    r.state.setThrows = true;
    await r.flush();
    check("書き込みの失敗は投げずにログ", r.state.logs.some((l) => l.event === "store write failed"), true);
  }

  console.log("(a) 非公開 (古い値があるとき)");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 61_000, value: "old" });
    const swr = make(r, { ok: false, kind: "denied", reason: "private" });
    check("描画中は古い値", await swr.get("a", far(r)), { ok: true, value: "old" });
    await r.flush();
    check("キーを消した", r.state.data.has("k:a"), false);
    const before = r.state.fetches.length;
    check("次は失敗を返す (覚えている間は取りに行かない)", await swr.get("a", far(r)), { ok: false, reason: "private" });
    check("取りに行っていない", r.state.fetches.length, before);
  }

  console.log("(a) 一時的な失敗 (古い値があるとき)");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 61_000, value: "old" });
    const swr = make(r, { ok: false, kind: "transient", reason: "503" });
    await swr.get("a", far(r));
    await r.flush();
    check("古い値を残す", r.state.data.get("k:a")?.value, "old");
    r.state.lockHeld = false;
    check("覚えている間は古い値を返し、取り直しを予約しない", (await swr.get("a", far(r)), r.state.afters.length), 0);
    r.state.t += 31_000;
    await swr.get("a", far(r));
    check("30 秒過ぎたら取り直しを予約する", r.state.afters.length, 1);
  }

  console.log("(a) 締め切り超え");
  {
    const r = rig();
    let release;
    const slow = new Promise((res) => (release = res));
    const swr = make(r, () => slow);
    // 締め切りは偽の時計の基準で作る (残り = 締め切り - now() が本物の待ち時間)
    const t0 = Date.now();
    const got = await swr.get("a", r.state.t + 30);
    check("締め切り (30ms) まで待った", Date.now() - t0 >= 25, true);
    check("締め切りを超えたら理由を返す", got, { ok: false, reason: "timed out" });
    check("描画中は書かない", r.state.writesDuringRender, []);
    release(OK("late"));
    await r.flush();
    check("取得は止めず、after の中で書いた", r.state.data.get("k:a")?.value, "late");
  }

  console.log("(a) 締め切りなし (Infinity。同期の Server Action・cron)");
  {
    const r = rig();
    let release;
    const slow = new Promise((res) => (release = res));
    const swr = make(r, () => slow);
    const p = swr.get("a", Number.POSITIVE_INFINITY);
    await new Promise((res) => setTimeout(res, 30));
    release(OK("late"));
    check("取得の終わりまで待って値を返す (時間切れにしない)", await p, { ok: true, value: "late" });
    check("描画中は書かない", r.state.writesDuringRender, []);
    await r.flush();
    check("after の中で書いた", r.state.data.get("k:a")?.value, "late");
    await tick();
    check("timer の上限超えの警告を出さない", warnings.includes("TimeoutOverflowWarning"), false);
  }

  console.log("(a) 同じインスタンスに要求が重なった (空)");
  {
    const r = rig();
    let release;
    const slow = new Promise((res) => (release = res));
    const swr = make(r, () => slow);
    const p1 = swr.get("a", far(r));
    const p2 = swr.get("a", far(r));
    await tick();
    release(OK("v"));
    check("両方に値", await Promise.all([p1, p2]), [{ ok: true, value: "v" }, { ok: true, value: "v" }]);
    check("取得は 1 本", r.state.fetches.length, 1);
    check("after も 1 本", r.state.afters.length, 1);
  }

  console.log("(a) 取り直しの予約中に保存先が読めない要求が来た");
  {
    const r = rig();
    r.state.data.set("k:a", { fetchedAt: r.state.t - 61_000, value: "old" });
    const swr = make(r, OK("fresh"));
    await swr.get("a", far(r)); // 取り直しを予約 (after はまだ流さない)
    r.state.getThrows = true;
    const t0 = Date.now();
    const got = await swr.get("a", r.state.t + 2_000);
    check("予約済みの取り直しを待たずに、その場で取って返す", got, { ok: true, value: "fresh" });
    check("締め切りまで止まっていない", Date.now() - t0 < 1_000, true);
  }

  console.log("(a) after が使えない (リクエストの外)");
  {
    const r = rig();
    r.state.afterThrows = true;
    const swr = make(r, OK("v"));
    check("値は返す", await swr.get("a", far(r)), { ok: true, value: "v" });
    await tick();
    check("書かない", r.state.ops.filter((o) => !o.startsWith("get")), []);
    check("印は残らない", swr.stats().inflight, 0);
  }

  console.log("(a) 負の対照: 偽の保存先が描画中の書き込みを検出できる");
  {
    const r = rig();
    await r.deps.store.set("x", { fetchedAt: 0, value: 0 }, 1);
    check("描画中の set を記録する", r.state.writesDuringRender, ["set x"]);
  }
}

/** src の .ts / .tsx を全部並べる。 */
function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

function staticChecks() {
  console.log("(b) 静的");
  const files = sourceFiles("src");
  check("src の .ts を読めている (対照)", files.includes("src/lib/server/sheet-table.ts"), true);
  check(
    "src のどこも unstable_cache を使わない (コメントは除く)",
    files.filter((f) => /unstable_cache/.test(code(read(f)))),
    [],
  );
  const sheet = code(read("src/lib/server/sheet-table.ts"));
  check("sheet-table.ts は next/cache を import しない", /from\s+["']next\/cache["']/.test(sheet), false);
  check("sheet-table.ts は redis-swr を使う (表とタブの 2 本)", (sheet.match(/createRedisSwr<[^>]+>\(deps,/g) ?? []).length, 2);
  check("sheet-table.ts は written を出さない (本番で確認済み)", /nextSwrDeps\("sheet-swr"\)/.test(sheet), true);
  for (const f of [
    "src/lib/server/xivapi-action-names.ts",
    "src/lib/server/category-progress.ts",
    "src/lib/server/practice-log-missing-days.ts",
    "src/lib/server/attendance-summary-actions.ts",
  ]) {
    check(`${f.split("/").pop()} は redis-swr を使う`, /createRedisSwr</.test(code(read(f))), true);
  }
  const swr = code(read("src/lib/server/redis-swr.ts"));
  check("redis-swr.ts は何も import しない (偽物を差し込むため)", /^\s*import\s/m.test(swr), false);
  check("redis-swr.ts は after に関数を渡す", /deps\.after\(async \(\) =>/.test(swr), true);
  const store = code(read("src/lib/server/redis-swr-store.ts"));
  check("Upstash の再試行を切っている (2 本とも)", (store.match(/retry:\s*false/g) ?? []).length, 2);
  check("Upstash の要求ごとの打ち切り", (store.match(/signal:\s*\(\)\s*=>\s*AbortSignal\.timeout/g) ?? []).length, 2);
}

const outDir = mkdtempSync(join(tmpdir(), "sheet-swr-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/server/redis-swr.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
      "--skipLibCheck",
    ],
    { stdio: "inherit" },
  );
  const { createRedisSwr } = await import(pathToFileURL(join(outDir, "redis-swr.js")).href);
  await pureLogic(createRedisSwr);
} catch (e) {
  failures += 1;
  console.log(`  FAIL (a) が途中で止まった: ${e instanceof Error ? e.stack : e}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
staticChecks();

if (failures > 0) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nall ok");
