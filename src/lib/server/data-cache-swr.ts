/**
 * Data Cache (`unstable_cache`) を使う自前の stale-while-revalidate
 * (2026-10-09、シートの取り直しが応答の後に落ちる件)。
 *
 * ## 直した問題
 *
 * `unstable_cache(fn, keys, { revalidate: 60 })` をページ描画中に呼ぶと、
 * 期限切れの entry では古い値を返しつつ、取り直しを
 * `workStore.pendingRevalidates` に **積むだけ** にする。冷えた entry の
 * 書き込みも同じ所に積まれる (Next 16.3.8 の
 * `next/dist/server/web/spec-extension/unstable-cache.js:183-205, 224-233`)。
 * 積まれた分を待つのは HTML 要求の shell の時点だけで、RSC 要求
 * (クライアント遷移) は一度も待たない (`app-render/app-render.js:1716,
 * 1785-1797`)。`after(fn)` も、応答が閉じた時点からの **差分** しか待たない
 * (`after/after-context.js:145` → `revalidation-utils.js:24-37, 63`)。
 * そのため取り直しは waitUntil の外で走り、
 *   - インスタンスが凍結されると途中で止まり、再開したときにタイマーが
 *     切れて「revalidating cache with key: … TimeoutError」が **別のルートの
 *     要求に** 記録される (本番で 1 か月に 7 件、最後は 2026-10-07)
 *   - 書き込みがログも出さずに消える
 * ことが起きていた。
 *
 * ## 仕組み
 *
 * 同じ関数 (`entryFn`) と同じ keyParts で `unstable_cache` を 2 本作る。
 * キーは「関数の文字列化 + keyParts + 引数」で決まり、revalidate と tags は
 * 入らない (`unstable-cache.js:58, 85`。docs の unstable_cache.md にも
 * 「tags は識別に使わない」とある) ので、2 本は同じ entry を指す。
 *
 *   R (読み) … `revalidate: false`。stale の判定は呼び出し側の値が勝つ
 *     (`lib/incremental-cache/index.js:413`) ので、W が書いた entry も
 *     stale にならない = **描画中に Next の取り直しを一度も起こさない**。
 *     外れたら entryFn が NoHandoff を投げるだけで、取得も書き込みもしない
 *     (投げた cb は何も積まず、ログも出ない)
 *   W (書き) … `revalidate: 30`。**`after()` に渡した関数の中からだけ**
 *     呼ぶ。そこで積まれた書き込みは「応答が閉じた後の差分」なので
 *     waitUntil に待たれる (RSC 要求でも)。entry が 30 秒以内に書かれて
 *     いれば書かない (ほかのインスタンスが書いた新しい値があるので害は無い)
 *
 * 取得はこちらで行い (同じキーは 1 インスタンスで 1 本)、成功した値を
 * `handoff` に置いてから W を呼ぶ。W の entryFn はそれを返すだけ。古さは
 * 値に入れた `fetchedAt` で自前に判定する (`freshMs`)。失敗は Data Cache に
 * 書かず、プロセス内のメモ (`failTtlMs`) で連打だけ抑える。
 *
 * 実測 (2026-10-09、Next 16.3.8 の実モジュールとメモリの CacheHandler):
 * 冷えた / 古い / 待ち上限を超えた、のどれでも書き込みが waitUntil の内側で
 * 終わり、描画中の pendingRevalidates は 0 件、console.error は 0 回。
 * 旧方式 (revalidate: 60 を描画中に呼ぶ) は冷えた・古いの両方で、書き込みが
 * waitUntil の解決より後だった。`scripts/check-sheet-swr.mjs` で固定している
 * (Next を上げて赤くなったら、上の行番号の箇所を読み直す)。
 *
 * ## 禁じ手 (どれも検査で固定している)
 *
 * ⚠ **R に tags を付けない。** タグが stale にされると R が Next の取り直しに
 *   入り、entryFn が投げて console.error になる。さらに描画中に同じキーが
 *   積まれるので、after の W が差分から外れて書けなくなる (古いまま詰まる)
 * ⚠ **描画中に W を呼ばない。** 描画中に積まれたキーは after の差分から
 *   外れるので、書き込みが待たれない (検査の負の対照)
 * ⚠ **after には Promise ではなく関数を渡す。** Promise だとその Promise が
 *   解決した時点で終わり、W が積んだ書き込みは待たれない
 *   (`after-context.js:75-87`)
 *
 * next は import しない (unstable_cache / after / 時計は引数で受け取る)。
 * 検査から本物と偽物の両方を差し込むため。本物は `data-cache-swr-next.ts`。
 */

/** Data Cache に置く形。JSON にして保存される。 */
type Entry<V> = { fetchedAt: number; value: V };

/** 取得の結果。`fetch` は投げずにこの形で返す。 */
export type SwrFetched<V> =
  | { ok: true; value: V }
  | {
      ok: false;
      /** 呼び出し側へ返す理由。 */
      reason: string;
      /** ログ用の分類 (例: denied / transient)。 */
      kind: string;
      /** ログ用の補足 (例外の名前など)。URL を入れない。 */
      detail?: string;
    };

export type SwrResult<V> =
  | { ok: true; value: V }
  | { ok: false; reason: string };

/** ログの出口。`key` は呼び出し側でハッシュにする (URL をログに出さないため)。 */
export type SwrLog = (
  level: "info" | "warn",
  event: string,
  key: string,
  detail: Record<string, string | number>,
) => void;

export type SwrDeps = {
  /** `next/cache` の `unstable_cache`。tags を渡せない形にしてある。 */
  unstable_cache: <F extends (key: string) => Promise<unknown>>(
    cb: F,
    keyParts: string[],
    options: { revalidate: number | false },
  ) => F;
  /** `next/server` の `after`。関数しか渡せない形にしてある。 */
  after: (task: () => Promise<void>) => void;
  /** 現在時刻 (ms)。 */
  now: () => number;
  /** `next/navigation` の `unstable_rethrow` (Next の合図を握りつぶさない)。 */
  rethrow?: (e: unknown) => void;
};

export type SwrOptions<V> = {
  /** `unstable_cache` の keyParts。値の形を変えたら上げる。 */
  keyPart: string;
  fetch: (key: string) => Promise<SwrFetched<V>>;
  /** 取り直しを始める古さ (ms)。W の 30 秒より長くする。 */
  freshMs?: number;
  /** 失敗を覚えておく時間 (ms)。 */
  failTtlMs?: number;
  /** 冷えていて待ち上限を超えたときに返す理由。 */
  timedOutReason: string;
  log: SwrLog;
};

/** W の revalidate (秒)。これより新しい entry には書かない。 */
const WRITE_REVALIDATE_SECONDS = 30;
/** 失敗メモの上限 (カテゴリ数 × 2 程度しか入らない想定)。 */
const MEMO_MAX = 64;

/** R が外れたことを表す。描画中に取得も書き込みもさせないために投げる。 */
class NoHandoff extends Error {}

type Outcome<V> =
  | { ok: true; value: V; fetchedAt: number }
  | { ok: false; reason: string };
type Flight<V> = { startedAt: number; done: Promise<Outcome<V>> };

const errorName = (e: unknown): string =>
  e instanceof Error ? e.name : typeof e;

export function createSwrEntry<V>(deps: SwrDeps, opts: SwrOptions<V>) {
  const freshMs = opts.freshMs ?? 60_000;
  const failTtlMs = opts.failTtlMs ?? 30_000;
  /** after の中で W の entryFn に値を渡すためだけに使う。 */
  const handoff = new Map<string, Entry<V>>();
  const inflight = new Map<string, Flight<V>>();
  const failMemo = new Map<string, { at: number; reason: string }>();

  // R と W に **同じ関数** を渡す (キーに関数の文字列化が入る)。
  const entryFn = async (key: string): Promise<Entry<V>> => {
    const e = handoff.get(key);
    if (!e) throw new NoHandoff();
    return e;
  };
  // ⚠ tags を付けない (冒頭の禁じ手)。
  const read = deps.unstable_cache(entryFn, [opts.keyPart], {
    revalidate: false,
  });
  const write = deps.unstable_cache(entryFn, [opts.keyPart], {
    revalidate: WRITE_REVALIDATE_SECONDS,
  });

  const memoFresh = (key: string, t: number): boolean => {
    const m = failMemo.get(key);
    return m !== undefined && t - m.at < failTtlMs;
  };

  async function run(key: string, startedAt: number): Promise<Outcome<V>> {
    let r: SwrFetched<V>;
    try {
      r = await opts.fetch(key);
    } catch (e) {
      // fetch は投げない約束。破られても inflight を残さないよう失敗に包む。
      r = {
        ok: false,
        reason: "fetch threw",
        kind: "threw",
        detail: errorName(e),
      };
    }
    const at = deps.now();
    if (r.ok) {
      failMemo.delete(key);
      return { ok: true, value: r.value, fetchedAt: at };
    }
    failMemo.set(key, { at, reason: r.reason });
    if (failMemo.size > MEMO_MAX) {
      for (const k of failMemo.keys()) {
        failMemo.delete(k);
        if (failMemo.size <= MEMO_MAX / 2) break;
      }
    }
    opts.log("warn", "refresh failed", key, {
      kind: r.kind,
      ms: at - startedAt,
      reason: r.reason,
      ...(r.detail ? { detail: r.detail } : {}),
    });
    return { ok: false, reason: r.reason };
  }

  /** 取得を始める。同じキーの取得は呼び出し側で 1 本に絞る (inflight)。 */
  function start(key: string): Flight<V> {
    const startedAt = deps.now();
    const done = run(key, startedAt);
    const flight: Flight<V> = { startedAt, done };
    inflight.set(key, flight);
    void done.then(() => {
      if (inflight.get(key) === flight) inflight.delete(key);
    });
    try {
      // ⚠ 描画中に同期で登録する (await より前)。Promise ではなく関数を渡す。
      deps.after(async () => {
        const r = await done;
        if (!r.ok) return;
        const entry: Entry<V> = { fetchedAt: r.fetchedAt, value: r.value };
        handoff.set(key, entry);
        try {
          await write(key);
          opts.log("info", "refresh ok", key, {
            ms: deps.now() - startedAt,
          });
        } catch (e) {
          opts.log("warn", "write failed", key, { error: errorName(e) });
        } finally {
          // 後から始まった取得の値は消さない (自分の分だけ)。
          if (handoff.get(key) === entry) handoff.delete(key);
        }
      });
    } catch (e) {
      // リクエストの外 (after が投げる)。書かずに、取得した値を返すだけにする。
      opts.log("warn", "after unavailable", key, { error: errorName(e) });
    }
    return flight;
  }

  /**
   * 値を返す。当たれば待たない (古ければ取り直しを after に回す)。外れたら
   * `deadlineAt` (絶対時刻、ms) まで取得を待ち、超えたら `timedOutReason`。
   * 超えても取得は止めず、終われば after の中で書かれる。
   */
  async function get(key: string, deadlineAt: number): Promise<SwrResult<V>> {
    let entry: Entry<V> | null = null;
    try {
      entry = await read(key);
    } catch (e) {
      if (!(e instanceof NoHandoff)) {
        deps.rethrow?.(e);
        opts.log("warn", "read failed", key, { error: errorName(e) });
      }
    }
    const t = deps.now();
    if (entry && typeof entry.fetchedAt === "number") {
      // 当たり: 待たずに返す。古ければ取り直しを始める (書くのは after)。
      const stale = t - entry.fetchedAt >= freshMs;
      if (stale && !memoFresh(key, t) && !inflight.has(key)) start(key);
      return { ok: true, value: entry.value };
    }
    // 外れ: 失敗を覚えていて取得中でもなければ、その失敗をすぐ返す。
    const flight = inflight.get(key);
    const memo = failMemo.get(key);
    if (!flight && memo && t - memo.at < failTtlMs) {
      return { ok: false, reason: memo.reason };
    }
    const f = flight ?? start(key);
    const timedOut = (): SwrResult<V> => {
      opts.log("info", "render wait exceeded", key, {
        ms: deps.now() - f.startedAt,
      });
      return { ok: false, reason: opts.timedOutReason };
    };
    // 締切はリクエスト単位の絶対時刻なので、2 本目は残りしか待たない。
    const remaining = deadlineAt - deps.now();
    if (remaining <= 0) return timedOut();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), remaining);
    });
    try {
      const r = await Promise.race([f.done, deadline]);
      if (r === null) return timedOut();
      return r.ok
        ? { ok: true, value: r.value }
        : { ok: false, reason: r.reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 検査用: プロセス内に残っている件数。 */
  const stats = () => ({
    inflight: inflight.size,
    handoff: handoff.size,
    failMemo: failMemo.size,
  });

  return { get, stats };
}
