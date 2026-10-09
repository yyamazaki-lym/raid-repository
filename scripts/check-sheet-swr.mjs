/**
 * シートの Data Cache の自前の SWR (src/lib/server/data-cache-swr.ts) の検証
 * (2026-10-09)。
 * 実行: `node scripts/check-sheet-swr.mjs`
 *
 * 旧方式 (`unstable_cache(…, { revalidate: 60 })` を描画中に呼ぶ) は、取り直しと
 * 書き込みを応答の後に waitUntil の外で走らせ、本番で「revalidating cache with
 * key: … TimeoutError」が別のルートに記録されていた。新方式の肝は Next の
 * 内部の挙動に頼っているので、3 層で固定する:
 *
 *   (a) 純ロジック: 偽の unstable_cache / after / 時計で、いつ取りに行き、
 *       いつ書き、何を返すか
 *   (b) 結合: 本物の Next のモジュール (unstable_cache / AfterContext / after /
 *       IncrementalCache) とメモリの CacheHandler で、書き込みが waitUntil の
 *       **解決より前に** 終わること。RSC 要求を模して executeRevalidates は
 *       呼ばない (= 描画中に積まれた分は誰も待たない)。外部通信なし
 *   (c) 静的: sheet-table.ts が unstable_cache / revalidateTag を import しない、
 *       R が `revalidate: false` で tags を持たない、after に関数を渡す
 *
 * ⚠ (b) は next/dist/server/... の内部に結びついている。Next を上げてここが
 *   赤くなったら、data-cache-swr.ts の冒頭に挙げた箇所を読み直す。特に
 *   負の対照 (描画中に W を呼ぶと書き込みが待たれない) が通らなくなったのは、
 *   Next の挙動が変わった合図 (この検査が「待たれない書き込み」を検出できる
 *   ことの確認も兼ねる)。
 *
 * ⚠ tsc は `process.execPath` + `node_modules/typescript/bin/tsc` で起動する
 *   (`npx` 経由は Windows で ENOENT / EINVAL になり、CI の ubuntu では
 *   通るので壊れていることに気付けない)。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/**
 * コメントを落とす。文字列の中は残す (`"text/csv,*\/*"` の `/*` を
 * コメントの始まりと読まないため)。
 */
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

/** setTimeout に渡された待ち時間を記録する (呼び出しはそのまま通す)。 */
async function recordTimeouts(fn) {
  const orig = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (cb, ms, ...rest) => {
    delays.push(ms);
    return orig(cb, ms, ...rest);
  };
  try {
    return { result: await fn(), delays };
  } finally {
    globalThis.setTimeout = orig;
  }
}

// ── (a) 純ロジック ──────────────────────────────────────────────────────

/**
 * 偽の Next。unstable_cache は「キー = keyParts + 引数」の Map で、外れたら
 * cb を呼んで書く (本物と同じ)。W (revalidate が数値) は描画中に呼ばれたかを
 * 数える。after は関数を溜め、flushAfter で応答の後として実行する。
 */
function fakeNext() {
  const env = {
    t: 1_000_000,
    phase: "render",
    store: new Map(),
    created: [],
    writesBy: { read: 0, write: 0 },
    writeCalls: 0,
    writeCallsInRender: 0,
    writeThrowsOnce: false,
    afterTasks: [],
    afterCalls: 0,
    afterNonFunction: 0,
    logs: [],
  };
  env.deps = {
    now: () => env.t,
    unstable_cache: (cb, keyParts, options) => {
      env.created.push({ cb, keyParts, options });
      const role = options.revalidate === false ? "read" : "write";
      return async (...args) => {
        if (role === "write") {
          env.writeCalls += 1;
          if (env.phase === "render") env.writeCallsInRender += 1;
          if (env.writeThrowsOnce) {
            env.writeThrowsOnce = false;
            throw new Error("write failed (fake)");
          }
        }
        const k = `${keyParts.join(",")}-${JSON.stringify(args)}`;
        const hit = env.store.get(k);
        const fresh =
          hit &&
          (options.revalidate === false ||
            env.t - hit.at < options.revalidate * 1000);
        if (fresh) return JSON.parse(hit.value);
        const v = await cb(...args);
        env.store.set(k, { value: JSON.stringify(v), at: env.t });
        env.writesBy[role] += 1;
        return v;
      };
    },
    after: (task) => {
      env.afterCalls += 1;
      if (typeof task !== "function") env.afterNonFunction += 1;
      env.afterTasks.push(task);
    },
  };
  env.flushAfter = async () => {
    env.phase = "after";
    for (const task of env.afterTasks.splice(0)) await task();
    env.phase = "render";
  };
  env.log = (level, event, key, detail) =>
    env.logs.push({ level, event, key, ...detail });
  return env;
}

/** 取得の偽物。gate を置くと、外すまで終わらない。 */
function fakeFetch() {
  const f = { calls: 0, n: 0, mode: "ok", gate: null };
  f.fn = async () => {
    f.calls += 1;
    if (f.gate) await f.gate.promise;
    if (f.mode === "fail") {
      return { ok: false, reason: "失敗", kind: "denied", detail: "status 403" };
    }
    if (f.mode === "throw") throw new TypeError("boom");
    f.n += 1;
    return { ok: true, value: { v: f.n } };
  };
  return f;
}

async function pureLogic(createSwrEntry) {
  console.log("(a) 純ロジック (偽の unstable_cache / after / 時計)");
  const env = fakeNext();
  const fx = fakeFetch();
  const swr = createSwrEntry(env.deps, {
    keyPart: "t-v2",
    fetch: fx.fn,
    freshMs: 60_000,
    failTtlMs: 30_000,
    timedOutReason: "時間切れ",
    log: env.log,
  });
  const far = () => env.t + 60_000;

  check(
    "unstable_cache は 2 本 (R: revalidate false / W: 30)。tags は無い",
    env.created.map((c) => c.options),
    [{ revalidate: false }, { revalidate: 30 }],
  );
  check(
    "R と W は同じ関数・同じ keyParts (= 同じ entry)",
    [
      env.created[0].cb === env.created[1].cb,
      JSON.stringify(env.created[0].keyParts) ===
        JSON.stringify(env.created[1].keyParts),
    ],
    [true, true],
  );

  // 冷えて期限内に成功
  {
    const r = await swr.get("k1", far());
    check("冷えて期限内に成功 → ok", r, { ok: true, value: { v: 1 } });
    check("取得 1 回 / after は描画中に 1 本登録", [fx.calls, env.afterCalls], [1, 1]);
    check("応答の前は書かない", env.writesBy, { read: 0, write: 0 });
    await env.flushAfter();
    check("after の中で W が 1 回書く (R は書かない)", env.writesBy, { read: 0, write: 1 });
  }

  // 新しいとき
  {
    env.t += 10_000;
    const r = await swr.get("k1", far());
    check("新しいときは値を返す", r, { ok: true, value: { v: 1 } });
    check("新しいときは取得も after も 0", [fx.calls, env.afterCalls], [1, 1]);
  }

  // 古いとき
  {
    env.t += 61_000;
    fx.gate = deferred();
    const w0 = env.writeCalls;
    const r = await swr.get("k1", far());
    check("古いときは古い値をすぐ返す (取得の完了を待たない)", r, {
      ok: true,
      value: { v: 1 },
    });
    check("古いときは取得 1 回 / after 1 本", [fx.calls, env.afterCalls], [2, 2]);
    await swr.get("k1", far());
    check("取得中に同じキーが来ても 2 本目は始めない", fx.calls, 2);
    fx.gate.resolve();
    fx.gate = null;
    await env.flushAfter();
    check("W 1 回で新しい値を書く", [env.writeCalls - w0, env.writesBy.write], [1, 2]);
    check("次は新しい値", await swr.get("k1", far()), { ok: true, value: { v: 2 } });
  }

  // 期限を超えた
  {
    fx.gate = deferred();
    const deadlineAt = env.t + 40;
    const first = await recordTimeouts(() => swr.get("k2", deadlineAt));
    check("冷えて期限を超えたら timedOut", first.result, { ok: false, reason: "時間切れ" });
    check("1 本目は締切まで (40ms) 待つ", first.delays, [40]);
    env.t += 30;
    const second = await recordTimeouts(() => swr.get("k3", deadlineAt));
    check("2 本目は残り時間 (10ms) しか待たない", [second.result.ok, second.delays], [false, [10]]);
    env.t += 20;
    const third = await recordTimeouts(() => swr.get("k4", deadlineAt));
    check("締切を過ぎていたら待たずに timedOut", [third.result.ok, third.delays], [false, []]);
    check("締切を過ぎても取得は始め、after に回す", [fx.calls, env.afterCalls], [5, 5]);
    const joined = await recordTimeouts(() => swr.get("k2", env.t + 5));
    check("取得中の同じキーは 1 本に畳む", [joined.result.ok, fx.calls], [false, 5]);
    fx.gate.resolve();
    fx.gate = null;
    await env.flushAfter();
    check("打ち切った取得も after の中で書かれる", (await swr.get("k2", far())).ok, true);
    check("handoff / inflight が残らない", swr.stats(), {
      inflight: 0,
      handoff: 0,
      failMemo: 0,
    });
  }

  // 失敗
  {
    fx.mode = "fail";
    const writes0 = env.writesBy.write;
    const r = await swr.get("kf", far());
    check("失敗は ok:false で理由を返す", r, { ok: false, reason: "失敗" });
    await env.flushAfter();
    check("失敗は書かない", env.writesBy.write, writes0);
    const failLog = env.logs.find((l) => l.event === "refresh failed");
    check(
      "失敗の warn に kind と経過 ms",
      [failLog?.level, failLog?.kind, typeof failLog?.ms, failLog?.detail],
      ["warn", "denied", "number", "status 403"],
    );
    const calls0 = fx.calls;
    const afters0 = env.afterCalls;
    env.t += 10_000;
    const memo = await swr.get("kf", far());
    check("失敗を覚えている間は取りに行かない", [memo, fx.calls, env.afterCalls], [
      { ok: false, reason: "失敗" },
      calls0,
      afters0,
    ]);
    env.t += 21_000;
    fx.mode = "ok";
    const again = await swr.get("kf", far());
    check("覚えておく時間を過ぎたら取り直す", [again.ok, fx.calls], [true, calls0 + 1]);
    check("成功したらメモが消える", swr.stats().failMemo, 0);
    await env.flushAfter();
  }

  // キャッシュ済みの値はメモに隠されない
  {
    fx.mode = "fail";
    await swr.get("km", far());
    await env.flushAfter();
    fx.mode = "ok";
    // ほかのインスタンスが書いた値 (Data Cache は共有)
    env.store.set(`t-v2-${JSON.stringify(["km"])}`, {
      value: JSON.stringify({ fetchedAt: env.t, value: { v: 99 } }),
      at: env.t,
    });
    check("キャッシュ済みの値は失敗メモに隠されない", await swr.get("km", far()), {
      ok: true,
      value: { v: 99 },
    });
  }

  // W が投げても handoff が残らない
  {
    env.t += 120_000;
    env.writeThrowsOnce = true;
    await swr.get("k1", far());
    await env.flushAfter();
    check(
      "W が投げても handoff が残らず、warn に出る",
      [swr.stats().handoff, env.logs.some((l) => l.event === "write failed")],
      [0, true],
    );
  }

  // fetch が約束を破って投げた
  {
    fx.mode = "throw";
    const r = await swr.get("kt", far());
    check("fetch が投げても失敗として返す", r.ok, false);
    await env.flushAfter();
    check("inflight が残らない", swr.stats().inflight, 0);
    fx.mode = "ok";
  }

  check("W は描画中に一度も呼ばれない", env.writeCallsInRender, 0);
  check("after に渡したのはすべて関数", env.afterNonFunction, 0);

  // リクエストの外 (after が投げる)
  {
    const env2 = fakeNext();
    env2.deps.after = () => {
      throw new Error("outside a request scope");
    };
    const fx2 = fakeFetch();
    const swr2 = createSwrEntry(env2.deps, {
      keyPart: "t2",
      fetch: fx2.fn,
      timedOutReason: "時間切れ",
      log: env2.log,
    });
    const r = await swr2.get("k", env2.t + 60_000);
    check("after が使えなくても値は返す (書かない)", [r, env2.store.size], [
      { ok: true, value: { v: 1 } },
      0,
    ]);
    check(
      "after が使えないことは warn に出る",
      env2.logs.some((l) => l.event === "after unavailable"),
      true,
    );
    check("inflight が残らない (after なし)", swr2.stats().inflight, 0);
  }
}

// ── (b) 本物の Next との結合 ────────────────────────────────────────────

async function integration(createSwrEntry) {
  console.log("(b) 本物の Next のモジュールとの結合 (RSC 要求を模す)");
  // Next の ALS はモジュールの読み込み時に globalThis から拾うので、先に置く。
  globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
  const require = createRequire(join(process.cwd(), "package.json"));
  const N = "next/dist/server";
  const { workAsyncStorage } = require(`${N}/app-render/work-async-storage.external`);
  const { workUnitAsyncStorage } = require(
    `${N}/app-render/work-unit-async-storage.external`,
  );
  const { unstable_cache } = require(`${N}/web/spec-extension/unstable-cache`);
  const { AfterContext } = require(`${N}/after/after-context`);
  const { after } = require(`${N}/after/after`);
  const { IncrementalCache } = require(`${N}/lib/incremental-cache`);

  // 書き込みの往復。負の対照は「応答の後の処理 (タイマーは get の 1ms だけ)
  // より書き込みが遅い」ことに頼るので、余裕を持たせる。
  const SET_MS = 100;
  const SETTLE_MS = 300; // 待たれなかった書き込みが着くのを見届ける
  const mem = new Map();
  let settled = false;
  let sets = [];

  class MemHandler {
    async get(key) {
      await sleep(1);
      const e = mem.get(key);
      return e ? { value: e.value, lastModified: e.lastModified } : null;
    }
    async set(key, data) {
      await sleep(SET_MS);
      mem.set(key, { value: data, lastModified: Date.now() });
      sets.push({ body: JSON.parse(data.data.body), late: settled });
    }
    async revalidateTag() {}
    resetRequestCache() {}
  }
  const incrementalCache = new IncrementalCache({
    dev: false,
    minimalMode: false,
    requestHeaders: {},
    getPrerenderManifest: () => ({
      preview: { previewModeId: "x" },
      notFoundRoutes: [],
      routes: {},
      dynamicRoutes: {},
    }),
    CurCacheHandler: MemHandler,
    fetchCacheKeyPrefix: "",
    maxMemoryCacheSize: 0,
  });

  /** 1 リクエスト。描画 → 応答を閉じる → waitUntil の解決 → 見届け。 */
  async function request(render) {
    sets = [];
    settled = false;
    const waits = [];
    const closeCbs = [];
    let errors = 0;
    const afterContext = new AfterContext({
      waitUntil: (p) => waits.push(p),
      onClose: (cb) => closeCbs.push(cb),
      onTaskError: () => {
        errors += 1;
      },
    });
    const workStore = {
      isStaticGeneration: false,
      page: "/x/page",
      route: "/x",
      incrementalCache,
      fetchCache: undefined,
      isOnDemandRevalidate: false,
      isDraftMode: false,
      afterContext,
      nextFetchId: 1,
      cacheLifeProfiles: {},
    };
    const requestStore = {
      type: "request",
      phase: "render",
      implicitTags: { tags: [] },
      url: { pathname: "/x", search: "" },
      resumeDataCache: null,
    };
    const origError = console.error;
    console.error = () => {
      errors += 1;
    };
    try {
      let out;
      await workAsyncStorage.run(workStore, () =>
        workUnitAsyncStorage.run(requestStore, async () => {
          out = await render();
        }),
      );
      const pendingInRender = Object.keys(workStore.pendingRevalidates ?? {}).length;
      // RSC 要求: executeRevalidates は呼ばれない。応答を閉じるだけ。
      for (const cb of closeCbs.splice(0)) cb();
      await Promise.all(waits);
      settled = true;
      await sleep(SETTLE_MS);
      return { out, pendingInRender, waits: waits.length, sets, errors };
    } finally {
      console.error = origError;
    }
  }

  const ageAll = (ms) => {
    for (const e of mem.values()) {
      e.lastModified -= ms;
      const body = JSON.parse(e.value.data.body);
      if (typeof body.fetchedAt === "number") body.fetchedAt -= ms;
      e.value.data.body = JSON.stringify(body);
    }
  };

  let fetchMs = 30;
  let fetchCalls = 0;
  let version = 0;
  const logs = [];
  const swr = createSwrEntry(
    { unstable_cache, after, now: Date.now },
    {
      keyPart: "check-sheet-swr",
      fetch: async () => {
        fetchCalls += 1;
        await sleep(fetchMs);
        version += 1;
        return { ok: true, value: { v: version } };
      },
      timedOutReason: "時間切れ",
      log: (level, event) => logs.push(`${level} ${event}`),
    },
  );
  const get = (key, waitMs = 2_000) => () => swr.get(key, Date.now() + waitMs);
  /** 書き込みが 1 件以上あり、どれも waitUntil の解決より前。 */
  const writtenInside = (r) => [r.sets.length > 0, r.sets.filter((s) => s.late).length];

  {
    const r = await request(get("k1"));
    check("冷えた: 取得した値を返す", r.out, { ok: true, value: { v: 1 } });
    check("冷えた: SET が waitUntil の解決より前", writtenInside(r), [true, 0]);
    check("冷えた: 描画中の pendingRevalidates 0 件 / console.error 0 回", [
      r.pendingInRender,
      r.errors,
    ], [0, 0]);
    const next = await request(get("k1"));
    check("冷えた: 次の要求は Data Cache に当たる (取得しない)", [next.out, fetchCalls, next.waits], [
      { ok: true, value: { v: 1 } },
      1,
      0,
    ]);
  }
  {
    ageAll(120_000);
    const r = await request(get("k1"));
    check("古い: 古い値をすぐ返す", r.out, { ok: true, value: { v: 1 } });
    check("古い: SET が waitUntil の解決より前", writtenInside(r), [true, 0]);
    check("古い: 描画中の pendingRevalidates 0 件 / console.error 0 回", [
      r.pendingInRender,
      r.errors,
    ], [0, 0]);
    const next = await request(get("k1"));
    check("古い: 次の要求は新しい値", [next.out, fetchCalls], [{ ok: true, value: { v: 2 } }, 2]);
  }
  {
    fetchMs = 150;
    const r = await request(get("k2", 30));
    check("期限超え: timedOut を返す", r.out, { ok: false, reason: "時間切れ" });
    check("期限超え: 取得は続き、SET が waitUntil の解決より前", writtenInside(r), [true, 0]);
    check("期限超え: 描画中の pendingRevalidates 0 件 / console.error 0 回", [
      r.pendingInRender,
      r.errors,
    ], [0, 0]);
    fetchMs = 30;
    const next = await request(get("k2"));
    check("期限超え: 次の要求は当たる", next.out, { ok: true, value: { v: 3 } });
  }
  check("どの場合も after の中で refresh ok", logs.filter((l) => l === "info refresh ok").length, 3);

  // 負の対照: 描画中に W を呼ぶと、after でもう一度 W を呼んでも待たれない。
  {
    const handoff = new Map();
    const entryFn = async (k) => {
      const e = handoff.get(k);
      if (!e) throw new Error("no handoff");
      return e;
    };
    const W = unstable_cache(entryFn, ["check-sheet-swr-control"], { revalidate: 30 });
    const seed = await request(async () => {
      handoff.set("c", { fetchedAt: Date.now(), value: 1 });
      after(async () => {
        await W("c");
      });
      return "seed";
    });
    check("対照の準備: after の中だけで W を呼べば待たれる", writtenInside(seed), [true, 0]);
    ageAll(120_000);
    const r = await request(async () => {
      handoff.set("c", { fetchedAt: Date.now(), value: 2 });
      await W("c"); // ⚠ 描画中 (stale の取り直しが pendingRevalidates に積まれる)
      after(async () => {
        await W("c");
      });
      return "control";
    });
    check(
      "負の対照: 描画中に W を呼ぶと積まれ (1 件)、SET は waitUntil の解決より後",
      [r.pendingInRender, r.sets.length > 0 && r.sets.every((s) => s.late)],
      [1, true],
    );
  }
}

// ── (c) 静的 ────────────────────────────────────────────────────────────

function staticChecks() {
  console.log("(c) 静的");
  const sheet = code(read("src/lib/server/sheet-table.ts"));
  const helper = code(read("src/lib/server/data-cache-swr.ts"));
  const wiring = code(read("src/lib/server/data-cache-swr-next.ts"));
  // import 文は `;` で終わる (`import "server-only";` も 1 文として拾う)。
  const imports = (src) =>
    [...src.matchAll(/^import\s[^;]*;/gm)].map((m) => ({
      text: m[0],
      from: (m[0].match(/["']([^"']+)["'];$/) ?? [])[1],
    }));

  check(
    "sheet-table.ts は unstable_cache / revalidateTag を import しない",
    imports(sheet)
      .filter(
        (i) =>
          i.from === "next/cache" ||
          /\b(unstable_cache|revalidateTag|updateTag)\b/.test(i.text),
      )
      .map((i) => i.text),
    [],
  );
  check("sheet-table.ts は unstable_cache を呼ばない", /\bunstable_cache\s*\(/.test(sheet), false);
  check(
    "sheet-table.ts は helper に本物 (nextSwrDeps) を渡す (表とタブの 2 本)",
    [...sheet.matchAll(/createSwrEntry<[^>]+>\(nextSwrDeps,/g)].length,
    2,
  );
  check(
    "sheet-table.ts の読みはリクエスト単位の締切 (renderDeadline) を渡す",
    [
      /const renderDeadline = cache\(\(\) => Date\.now\(\) \+ RENDER_WAIT_MS\)/.test(sheet),
      [...sheet.matchAll(/\b(?:tableSwr|tabsSwr)\.get\([^;]*?renderDeadline\(\)/g)].length,
    ],
    [true, 2],
  );
  check(
    "helper は next を import しない",
    imports(helper).map((i) => i.from).filter((f) => /^next(\/|$)/.test(f)),
    [],
  );

  const uc = [
    ...helper.matchAll(
      /const (\w+) = deps\.unstable_cache\(\s*(\w+)\s*,\s*(\[[^\]]*\])\s*,\s*(\{[^}]*\})\s*,?\s*\)/g,
    ),
  ].map((m) => ({
    name: m[1],
    cb: m[2],
    keyParts: m[3],
    options: m[4].replace(/\s+/g, " ").replace(/,\s*\}/, " }"),
  }));
  check("unstable_cache は 2 本 (read と write)", uc.map((u) => u.name), ["read", "write"]);
  check(
    "R と W は同じ関数・同じ keyParts",
    [uc[0]?.cb === uc[1]?.cb, uc[0]?.keyParts === uc[1]?.keyParts],
    [true, true],
  );
  check("R は revalidate: false で tags なし", uc[0]?.options, "{ revalidate: false }");
  check("どちらも tags を持たない", uc.some((u) => /tags/.test(u.options)), false);

  const afterCalls = [...helper.matchAll(/deps\.after\(\s*(.{0,20})/g)].map((m) => m[1]);
  check("after は 1 か所で、関数を渡す", afterCalls.map((s) => /^async \(\) =>/.test(s)), [true]);
  // W (write) を呼ぶのは after に渡した関数の中だけ。
  const start = helper.indexOf("deps.after(");
  let depth = 0;
  let end = -1;
  for (let i = start + "deps.after".length; i < helper.length; i += 1) {
    if (helper[i] === "(") depth += 1;
    else if (helper[i] === ")" && --depth === 0) {
      end = i;
      break;
    }
  }
  const writeCalls = [...helper.matchAll(/\bwrite\(/g)].map((m) => m.index);
  check(
    "W (write) を呼ぶのは after に渡した関数の中だけ",
    [writeCalls.length, writeCalls.every((i) => i > start && i < end)],
    [1, true],
  );
  check(
    "本物の差し込み口は next の unstable_cache と after をそのまま渡す",
    [
      /import \{ unstable_cache \} from "next\/cache";/.test(wiring),
      /import \{ after \} from "next\/server";/.test(wiring),
      /\n\s+unstable_cache,\n\s+after,\n/.test(wiring),
    ],
    [true, true, true],
  );
}

const outDir = mkdtempSync(join(tmpdir(), "sheet-swr-check-"));
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "src/lib/server/data-cache-swr.ts",
      "--outDir", outDir,
      "--target", "es2022",
      "--module", "es2022",
      "--moduleResolution", "bundler",
      "--strict",
    ],
    { stdio: "inherit" },
  );
  const { createSwrEntry } = await import(
    pathToFileURL(join(outDir, "data-cache-swr.js")).href
  );
  await pureLogic(createSwrEntry);
  await integration(createSwrEntry);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
staticChecks();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
