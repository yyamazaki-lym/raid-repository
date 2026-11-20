import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isPublicHttpUrl } from "@/lib/url-safe";
import {
  createRedisSwr,
  type SwrFetched,
  type SwrLog,
} from "./redis-swr";
import { getSwrStore, SWR_NAMESPACE } from "./redis-swr-store";
import { safeFetch } from "./safe-fetch";
import {
  parseCsv,
  parseSheetTabs,
  toSheetCsvUrl,
  toSheetTabListUrl,
  toSheetTable,
  type SheetTab,
  type SheetTable,
} from "@/lib/sheet-csv";

/**
 * Google Sheets を CSV で取得してテーブル化する (TODO #94 / A-3)。
 *
 * 読み取り専用。失敗はすべて `{ ok: false }` で返し、呼び出し側 (page) は
 * 従来どおり iframe を描くだけなので **失敗しても機能後退はしない**。
 *
 * 安全性: URL は admin が設定ダイアログで入れた値だが、SSRF 対策の
 * 二層 (`isPublicHttpUrl` + `safeFetch` の IP ピン留め) を他の
 * ユーザー入力 URL 取得経路と同様に通す。加えて
 *   - docs.google.com 以外は `toSheetCsvUrl` が null を返して弾かれる
 *   - 応答は 2MB / 15 秒で打ち切り (ページが待つのは最大 6 秒。下の
 *     FETCH_TIMEOUT_MS / RENDER_WAIT_MS)
 *
 * キャッシュ (2026-11-20 に変更、L-24): `redis-swr.ts` の自前の SWR で、
 * Upstash Redis に置く。描画中は読むだけで、古ければ取り直しと書き込みを
 * `after()` に回す。以前の `unstable_cache(…, { revalidate: 60 })` は、取り直しが
 * 応答の後に waitUntil の外で走り、凍結で落ちて「revalidating cache with key」
 * のエラーを別のルートに残していた (詳細は redis-swr.ts の冒頭)。
 * ⚠ このファイルで `unstable_cache` を使わない (`check-sheet-swr.mjs`)。
 */

const MAX_BYTES = 2 * 1024 * 1024;
/**
 * 取得そのものの上限 (redirect と本文の読み込みを含む)。ページの待ち
 * (RENDER_WAIT_MS) を超えても取得は止めず、`after()` の中で最後まで待たれる。
 * 取り直しはそもそもページを待たせないので、短くする理由が無い。
 */
const FETCH_TIMEOUT_MS = 15_000;
/**
 * ページ描画が、保存先に無いシートの取得を待つ上限。取れなければ iframe に
 * 落ちるだけで実害がないので、監査 D-1 の「外部 fetch は 8s」より短くする。
 * 1 リクエストの合計で数える (`renderDeadline`)。軽減表で gid が無く、
 * タブ一覧の後に表をもう 1 本取るときも、合わせて 6 秒に収まる。
 */
const RENDER_WAIT_MS = 6_000;
/**
 * 取り直しを始める古さ (ms)。開催中の編集は、これを過ぎた最初の表示で
 * 取り直され、次の表示で追いつく (シート編集 → カード反映の最大待ちは
 * おおむね 1 分。2026-09-04 に 5 分のプロセス内キャッシュから縮めた値)。
 */
const FRESH_MS = 60_000;
/**
 * 保存先での期限 (秒)。古くなっても「古い値を返しつつ取り直す」ために残す
 * 時間の保険。1 日開かれなかったシートは、次の表示でその場で取りに行く。
 */
const STORE_TTL_SECONDS = 86_400;
/**
 * 失敗のプロセス内 TTL (ms)。失敗は保存先に載せない — 共有の保存先に焼き
 * 付くと「共有設定を直したのに直らない」ことになるため。代わりにここで短時間
 * だけ抑え、非公開シートへの連打を防ぐ。タブ一覧は「ウェブに公開」していない
 * シートで常に失敗する経路 (2026-08-30 の実機報告) なので、表と同じく必ず抑える。
 */
const FAIL_TTL_MS = 30 * 1000;

export type SheetTableResult =
  | { ok: true; table: SheetTable; csvUrl: string }
  | { ok: false; reason: string };

/** 保存先に置く表の値。 */
type SheetTableValue = { table: SheetTable; csvUrl: string };

/**
 * 無くてページの待ち上限を超えたとき。取得は after の中で続き、
 * 終われば保存先に書かれる (次の表示はカードになる)。
 * (理由をプロパティの形で書くのは、check-server-text が辞書の網羅をその形で
 * 拾うため。英訳は server-text-en.ts。)
 */
const RENDER_TIMED_OUT = {
  ok: false,
  reason: "シート取得が時間内に終わりませんでした",
} as const;

/** リクエストの待ちの締め切り。React `cache()` でリクエストごとに 1 つ。 */
const renderDeadline = cache(() => Date.now() + RENDER_WAIT_MS);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * 保存先のキー。本番・デモ・手元を分け、URL はハッシュにする (キーにも
 * ログにも URL を出さない)。値の形を変えたら v を上げる。
 */
const storeKey = (kind: "table" | "tabs") => (arg: string) =>
  `sheet:v1:${SWR_NAMESPACE}:${kind}:${sha256(arg).slice(0, 32)}`;

/**
 * ログ。キーの末尾の短いハッシュだけを出す。
 *
 * `written` (info) は出した直後の観測用 — 書き込みが、引き金になった閲覧と
 * 同じ要求 (`/category/<slug>/mitigation` か `/loot`) に記録されることを
 * runtime logs で確かめたら、info は出さないようにする。
 */
const log: SwrLog = (level, event, key, detail) => {
  console[level](`[sheet-swr] ${event}`, { key: key.slice(-8), ...detail });
};

const deps = {
  store: getSwrStore(),
  after,
  now: Date.now,
  log,
  rethrow: unstable_rethrow,
};

const tableSwr = createRedisSwr<SheetTableValue>(deps, {
  storeKey: storeKey("table"),
  fetch: (arg) => {
    const [url, gid] = JSON.parse(arg) as [string, string];
    return loadSheetTable(url, gid || null);
  },
  freshMs: FRESH_MS,
  ttlSeconds: STORE_TTL_SECONDS,
  failTtlMs: FAIL_TTL_MS,
  timedOutReason: RENDER_TIMED_OUT.reason,
});

const tabsSwr = createRedisSwr<SheetTab[]>(deps, {
  storeKey: storeKey("tabs"),
  fetch: loadSheetTabs,
  freshMs: FRESH_MS,
  ttlSeconds: STORE_TTL_SECONDS,
  failTtlMs: FAIL_TTL_MS,
  timedOutReason: RENDER_TIMED_OUT.reason,
});

/**
 * 1 リクエスト内の重複呼び出しは React `cache()` で畳み、インスタンスを
 * 跨いだ再取得は保存先 (上の FRESH_MS) で抑える。
 */
export const fetchSheetTable = cache(
  async (
    sheetUrl: string | null | undefined,
    // 2026-08-30 (層タブ切替): 取得するワークシートの gid 上書き。
    // 未指定なら URL 自身の gid (従来挙動)。
    gid?: string | null,
  ): Promise<SheetTableResult> => {
    const url = (sheetUrl ?? "").trim();
    // 取りに行けない URL は保存先も読まずに返す。
    const csvUrl = url ? toSheetCsvUrl(url, gid) : null;
    if (!csvUrl) return { ok: false, reason: "CSV 取得に対応しない URL 形式" };
    if (!isPublicHttpUrl(csvUrl)) return { ok: false, reason: "URL が不正" };
    const r = await tableSwr.get(
      JSON.stringify([url, gid ?? ""]),
      renderDeadline(),
    );
    return r.ok ? { ok: true, ...r.value } : { ok: false, reason: r.reason };
  },
);

/**
 * シートのワークシート (層タブ) 一覧を pubhtml / htmlview から取得する
 * (2026-08-30、軽減表の層切り替え)。CSV export はタブを列挙できないため
 * HTML のフッタータブバーを parse する。失敗は [] — 呼び出し側は
 * タブ UI を出さないだけで、従来の単一シート表示にフォールバックする。
 */
export const fetchSheetTabs = cache(
  async (sheetUrl: string | null | undefined): Promise<SheetTab[]> => {
    const listUrl = toSheetTabListUrl(sheetUrl);
    if (!listUrl || !isPublicHttpUrl(listUrl)) return [];
    const r = await tabsSwr.get(listUrl, renderDeadline());
    return r.ok ? r.value : [];
  },
);

/** 表を取りに行く (保存先を通さない。tableSwr の取得)。 */
async function loadSheetTable(
  sheetUrl: string,
  gid: string | null,
): Promise<SwrFetched<SheetTableValue>> {
  const csvUrl = toSheetCsvUrl(sheetUrl, gid);
  if (!csvUrl) {
    return { ok: false, kind: "content", reason: "CSV 取得に対応しない URL 形式" };
  }
  if (!isPublicHttpUrl(csvUrl)) {
    return { ok: false, kind: "content", reason: "URL が不正" };
  }

  try {
    const res = await safeFetch(csvUrl, {
      headers: { Accept: "text/csv,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const denied = res.status === 401 || res.status === 403;
      return {
        ok: false,
        kind: denied ? "denied" : "transient",
        detail: `status ${res.status}`,
        reason: denied
          ? "シートが非公開です（「ウェブに公開」または「リンクを知っている全員が閲覧可」が必要）"
          : `シート取得に失敗しました (${res.status})`,
      };
    }
    // Content-Type が text/html のときは「公開されていない」ケース
    // (Google がログイン画面 HTML を返す)。
    const ctype = res.headers.get("content-type") ?? "";
    if (/text\/html/i.test(ctype)) {
      return {
        ok: false,
        kind: "denied",
        reason: "シートが非公開です（CSV ではなく HTML が返りました）",
      };
    }
    const text = await readCapped(res);
    if (text === null) {
      return { ok: false, kind: "content", reason: "シートが大きすぎます" };
    }
    const table = toSheetTable(parseCsv(text));
    if (!table) return { ok: false, kind: "content", reason: "シートが空です" };
    return { ok: true, value: { table, csvUrl } };
  } catch (e) {
    // タイムアウト / DNS / ブロック済みアドレスなど。iframe fallback で継続。
    // 例外の本文は URL やホストを含みうるので、ログには名前だけを出す。
    return {
      ok: false,
      kind: "transient",
      detail: e instanceof Error ? e.name : typeof e,
      reason: "シート取得に失敗しました",
    };
  }
}

/** タブ一覧を取りに行く (保存先を通さない。tabsSwr の取得)。 */
async function loadSheetTabs(listUrl: string): Promise<SwrFetched<SheetTab[]>> {
  try {
    const res = await safeFetch(listUrl, {
      headers: { Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const denied = res.status === 401 || res.status === 403;
      return {
        ok: false,
        kind: denied ? "denied" : "transient",
        reason: `tabs ${res.status}`,
      };
    }
    // htmlview はシート全体の HTML を含むため CSV よりだいぶ大きい。
    // タブバーは文書末尾にあるので全体を読むが、上限は CSV の 2 倍。
    const text = await readCapped(res, MAX_BYTES * 2);
    if (text === null) {
      return { ok: false, kind: "content", reason: "tabs too large" };
    }
    return { ok: true, value: parseSheetTabs(text) };
  } catch (e) {
    return {
      ok: false,
      kind: "transient",
      reason: e instanceof Error ? e.name : typeof e,
    };
  }
}

/** 応答本文を maxBytes で打ち切って読む。 */
async function readCapped(
  res: Response,
  maxBytes: number = MAX_BYTES,
): Promise<string | null> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > maxBytes) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) return null;
  return new TextDecoder("utf-8").decode(buf);
}
