/**
 * 共有の保存先 (Upstash Redis) に置く自前の stale-while-revalidate
 * (2026-11-20、L-24)。
 *
 * ## 直した問題
 *
 * シートの取得を `unstable_cache(…, { revalidate: 60 })` で包んでいた頃、値が
 * 古くなると Next は描画中に取り直しを `workStore.pendingRevalidates` に積む
 * だけで、RSC 要求ではそれを待たなかった。取り直しは応答の後に waitUntil の
 * 外で走り、インスタンスが凍結されると途中で止まって、次に動いたときに
 * 「revalidating cache with key: … TimeoutError」が **別のルートの要求に**
 * 記録されていた (本番で月 7 件ほど。表示は壊れない)。
 *
 * 一度目の作り直し (#484) は Data Cache のまま読みと書きを分けたが、Vercel の
 * キャッシュのハンドラーでは読みも 30 秒後に古い扱いになって詰まり、#485 で
 * 差し戻した。**Data Cache の古さの判定 (Vercel 側の中身は読めない) には
 * 頼らない** — 古いかどうかは値の中の取得時刻で、このファイルが判定する。
 *
 * ## 仕組み
 *
 *   新しい            → そのまま返す
 *   古い              → 古い値を返し、取り直しを `after()` に予約する。取り直しは
 *                       応答の後に、全インスタンスで 1 本 (`acquire` = SET NX EX)
 *   無い / 読めない   → その場で取得し、締め切り (`deadlineAt`) まで待つ。
 *                       間に合わなければ `timedOutReason`。取得は止めず、
 *                       `after()` の中で最後まで待って書く
 *
 * **保存先に書く (set / del / acquire) のは `after()` に渡した関数の中だけ。**
 * 描画中は読むだけにする。`after()` に渡した関数は応答の後に waitUntil の中で
 * 待たれる (RSC 要求でも) ので、#484 の前のように書き込みが凍結で落ちない。
 *
 * 失敗の扱い (`kind`):
 *   denied    … 非公開 (401 / 403 / HTML)。キーを消す (非公開にしたシートを
 *               出し続けない)
 *   transient … 一時的。古い値を残す
 *   content   … 中身 (空・大きすぎる等)。古い値を残す (Data Cache の頃と同じ —
 *               失敗は書かなかった)
 * どれもプロセス内で `failTtlMs` 覚え、その間は取り直さない (連打を防ぐ)。
 *
 * next も Redis も import しない (保存先・after・時計は引数で受け取る)。
 * 検査 (`scripts/check-sheet-swr.mjs`) から偽物を差し込むため。
 */

/** 保存先に置く形。 */
export type SwrEntry<V> = { fetchedAt: number; value: V };

/**
 * 共有の保存先。読みは呼び出し側で短く打ち切る (失敗・打ち切りは投げる)。
 * 書き (set / del / acquire) は `after()` の中からだけ呼ばれる。
 */
export type SwrStore = {
  get(key: string): Promise<unknown>;
  set(key: string, entry: SwrEntry<unknown>, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** 取り直しの印を置く (SET NX EX)。置けたら true。 */
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
};

export type SwrFailKind = "denied" | "transient" | "content";

/** 取得の結果。`fetch` は投げずにこの形で返す。 */
export type SwrFetched<V> =
  | { ok: true; value: V }
  | {
      ok: false;
      /** 呼び出し側へ返す理由。 */
      reason: string;
      kind: SwrFailKind;
      /** ログ用の補足 (状態コード・例外の名前)。URL を入れない。 */
      detail?: string;
    };

export type SwrResult<V> = { ok: true; value: V } | { ok: false; reason: string };

/** ログの出口。`key` は保存先のキー (URL を含まない)。 */
export type SwrLog = (
  level: "info" | "warn",
  event: string,
  key: string,
  detail: Record<string, string | number>,
) => void;

export type SwrDeps = {
  store: SwrStore;
  /** `next/server` の `after`。関数しか渡せない形にしてある。 */
  after: (task: () => Promise<void>) => void;
  /** 現在時刻 (ms)。 */
  now: () => number;
  log: SwrLog;
  /** `next/navigation` の `unstable_rethrow` (Next の合図を握りつぶさない)。 */
  rethrow?: (e: unknown) => void;
};

export type SwrOptions<V> = {
  /** 取得の引数 (URL など) から保存先のキーを作る。URL をそのまま入れない。 */
  storeKey: (arg: string) => string;
  fetch: (arg: string) => Promise<SwrFetched<V>>;
  /** 取り直しを始める古さ (ms)。 */
  freshMs?: number;
  /** 保存先での期限 (秒)。古くなっても残す時間の保険。 */
  ttlSeconds?: number;
  /** 失敗を覚えておく時間 (ms)。 */
  failTtlMs?: number;
  /** 取り直しの印の期限 (秒)。取得の上限より長くする。 */
  lockSeconds?: number;
  /** 無いときに締め切りを超えたら返す理由。 */
  timedOutReason: string;
};

/** 失敗メモの上限 (カテゴリ数 × 2 程度しか入らない想定)。 */
const MEMO_MAX = 64;
/**
 * after が走らないまま残った取得中の印を捨てる時間 (ms)。取得の上限 (15 秒)
 * と書き込みより十分長くする。
 */
const FLIGHT_MAX_MS = 60_000;

type Outcome<V> =
  | { ok: true; value: V; fetchedAt: number }
  | { ok: false; reason: string; kind: SwrFailKind };
/**
 * 取得中の印。`miss` は描画中に始めた取得 (待てる)、`refresh` は after に
 * 予約した取り直し (応答の後まで終わらないので、描画中に待たない)。
 */
type Flight<V> = {
  mode: "miss" | "refresh";
  startedAt: number;
  done: Promise<Outcome<V>>;
};

const errorName = (e: unknown): string =>
  e instanceof Error ? e.name : typeof e;

function isEntry(v: unknown): v is SwrEntry<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { fetchedAt?: unknown }).fetchedAt === "number" &&
    "value" in v
  );
}

export function createRedisSwr<V>(deps: SwrDeps, opts: SwrOptions<V>) {
  const freshMs = opts.freshMs ?? 60_000;
  const ttlSeconds = opts.ttlSeconds ?? 86_400;
  const failTtlMs = opts.failTtlMs ?? 30_000;
  const lockSeconds = opts.lockSeconds ?? 20;
  const inflight = new Map<string, Flight<V>>();
  const failMemo = new Map<string, { at: number; reason: string }>();

  const memoReason = (key: string, t: number): string | null => {
    const m = failMemo.get(key);
    return m !== undefined && t - m.at < failTtlMs ? m.reason : null;
  };

  /** 取得中の印。after が走らないまま古くなったものは捨てる。 */
  const liveFlight = (key: string, t: number): Flight<V> | undefined => {
    const f = inflight.get(key);
    if (f && t - f.startedAt >= FLIGHT_MAX_MS) {
      inflight.delete(key);
      return undefined;
    }
    return f;
  };

  async function run(key: string, arg: string): Promise<Outcome<V>> {
    const startedAt = deps.now();
    let r: SwrFetched<V>;
    try {
      r = await opts.fetch(arg);
    } catch (e) {
      // fetch は投げない約束。破られても一時的な失敗として扱う。
      r = { ok: false, kind: "transient", reason: "fetch threw", detail: errorName(e) };
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
    deps.log("warn", "fetch failed", key, {
      kind: r.kind,
      ms: at - startedAt,
      reason: r.reason,
      ...(r.detail ? { detail: r.detail } : {}),
    });
    return { ok: false, reason: r.reason, kind: r.kind };
  }

  /** 取得の結果を保存先に反映する。⚠ after の中からだけ呼ぶ。 */
  async function settle(
    key: string,
    r: Outcome<V>,
    mode: string,
    startedAt: number,
  ): Promise<void> {
    try {
      if (r.ok) {
        await deps.store.set(key, { fetchedAt: r.fetchedAt, value: r.value }, ttlSeconds);
        deps.log("info", "written", key, { mode, ms: deps.now() - startedAt });
      } else if (r.kind === "denied") {
        await deps.store.del(key);
        deps.log("info", "deleted", key, { mode });
      }
    } catch (e) {
      deps.log("warn", "store write failed", key, { mode, error: errorName(e) });
    }
  }

  /** 無いとき: いま取得を始め、書くのは after の中。 */
  function startMiss(key: string, arg: string): Flight<V> {
    const startedAt = deps.now();
    const done = run(key, arg);
    const flight: Flight<V> = { mode: "miss", startedAt, done };
    inflight.set(key, flight);
    // 後から始まった取得の印は消さない (自分の分だけ)。
    const release = () => {
      if (inflight.get(key) === flight) inflight.delete(key);
    };
    try {
      // ⚠ 描画中に同期で登録する (await より前)。Promise ではなく関数を渡す。
      deps.after(async () => {
        try {
          await settle(key, await done, "miss", startedAt);
        } finally {
          release();
        }
      });
    } catch (e) {
      // リクエストの外 (after が投げる)。書かずに、取得した値を返すだけにする。
      deps.log("warn", "after unavailable", key, { error: errorName(e) });
      void done.then(release);
    }
    return flight;
  }

  /** 古いとき: 取り直しを after に予約する。取得も書き込みも応答の後。 */
  function scheduleRefresh(key: string, arg: string): void {
    const startedAt = deps.now();
    let resolveDone!: (o: Outcome<V>) => void;
    const done = new Promise<Outcome<V>>((r) => (resolveDone = r));
    const flight: Flight<V> = { mode: "refresh", startedAt, done };
    inflight.set(key, flight);
    const release = () => {
      if (inflight.get(key) === flight) inflight.delete(key);
    };
    try {
      deps.after(async () => {
        try {
          let locked = false;
          try {
            locked = await deps.store.acquire(`${key}:lock`, lockSeconds);
          } catch (e) {
            // 印を置けないなら取りに行かない (保存先が落ちているなら書けない)。
            deps.log("warn", "lock failed", key, { error: errorName(e) });
          }
          if (!locked) {
            resolveDone({ ok: false, reason: "skipped", kind: "transient" });
            return;
          }
          const r = await run(key, arg);
          resolveDone(r);
          await settle(key, r, "refresh", startedAt);
        } finally {
          release();
        }
      });
    } catch (e) {
      deps.log("warn", "after unavailable", key, { error: errorName(e) });
      release();
    }
  }

  /**
   * 値を返す。当たれば待たない (古ければ取り直しを after に回す)。無ければ
   * `deadlineAt` (絶対時刻、ms) まで取得を待ち、超えたら `timedOutReason`。
   */
  async function get(arg: string, deadlineAt: number): Promise<SwrResult<V>> {
    const key = opts.storeKey(arg);
    let entry: unknown = null;
    try {
      entry = await deps.store.get(key);
    } catch (e) {
      deps.rethrow?.(e);
      // 読めないときは無いのと同じに扱う (その場で取得する)。
      deps.log("warn", "store read failed", key, { error: errorName(e) });
    }
    const t = deps.now();
    if (isEntry(entry)) {
      const stale = t - entry.fetchedAt >= freshMs;
      if (stale && memoReason(key, t) === null && !liveFlight(key, t)) {
        scheduleRefresh(key, arg);
      }
      return { ok: true, value: entry.value as V };
    }
    // 無い: 失敗を覚えていて取得中でもなければ、その失敗をすぐ返す。
    // ⚠ 合流するのは描画中に始めた取得 (miss) だけ。after に予約した取り直し
    //   (refresh) は応答の後まで終わらないので、待つと締め切りまで止まる。
    const live = liveFlight(key, t);
    const flight = live?.mode === "miss" ? live : undefined;
    const memo = memoReason(key, t);
    if (!flight && memo !== null) return { ok: false, reason: memo };
    const f = flight ?? startMiss(key, arg);
    const timedOut = (): SwrResult<V> => {
      deps.log("info", "render wait exceeded", key, { ms: deps.now() - f.startedAt });
      return { ok: false, reason: opts.timedOutReason };
    };
    // 締め切りはリクエスト単位の絶対時刻なので、2 本目は残りしか待たない。
    const remaining = deadlineAt - deps.now();
    if (remaining <= 0) return timedOut();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), remaining);
    });
    try {
      const r = await Promise.race([f.done, deadline]);
      if (r === null) return timedOut();
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 検査用: プロセス内に残っている件数。 */
  const stats = () => ({ inflight: inflight.size, failMemo: failMemo.size });

  return { get, stats };
}
