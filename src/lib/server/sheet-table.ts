import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { isPublicHttpUrl } from "@/lib/url-safe";
import {
  createSwrEntry,
  type SwrFetched,
  type SwrLog,
} from "./data-cache-swr";
import { nextSwrDeps } from "./data-cache-swr-next";
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
 * キャッシュ (2026-10-09 に変更): `data-cache-swr.ts` の自前の SWR。
 * 描画中は Data Cache を読むだけで、古ければ取り直しと書き込みを `after()`
 * に回す。以前の `unstable_cache(…, { revalidate: 60 })` を描画中に呼ぶ形は、
 * 取り直しと書き込みが応答の後に waitUntil の外で走り、凍結で落ちていた
 * (詳細は data-cache-swr.ts の冒頭)。
 *
 * ⚠ `safeFetch` は undici を直接使う (IP ピン留めのため) ので **Next の
 * fetch キャッシュ (`next: { revalidate }`) は効かない**。そこで
 * `unstable_cache` (data-cache-swr.ts の中) で関数単位にキャッシュする
 * (Next.js 16 では `use cache` が後継だが、それには `cacheComponents` の
 * 全体切替が要るのでここでは使わない)。このファイルから `unstable_cache` を
 * 直接呼ばない (`check-sheet-swr.mjs`)。
 */

const MAX_BYTES = 2 * 1024 * 1024;
/**
 * 取得そのものの上限 (redirect と本文の読み込みを含む)。
 *
 * 2026-10-09: 6 秒から 15 秒に延ばした。ページの待ち (RENDER_WAIT_MS) を
 * 超えても取得は止めず、`after()` の中で最後まで待たれる。取り直しはそもそも
 * ページを待たせないので、短くする理由が無い。6 秒のままだと Google の応答が
 * 遅いときに取り直しが打ち切られ、Data Cache が古いまま残る。
 */
const FETCH_TIMEOUT_MS = 15_000;
/**
 * ページ描画が冷えたキャッシュの取得を待つ上限。取れなければ iframe に
 * 落ちるだけで実害がないので、監査 D-1 の「外部 fetch は 8s」より短くする
 * (2026-10-09 までは取得そのものの上限だった値。ページの待ちは据え置き)。
 *
 * 1 リクエストの合計で数える (`renderDeadline`)。軽減表で gid が無く、
 * タブ一覧の後に表をもう 1 本取るときも、合わせて 6 秒に収まる。
 */
const RENDER_WAIT_MS = 6_000;
/**
 * 取り直しを始める古さ (ms)。開催中の編集は、これを過ぎた最初の表示で
 * 取り直され、次の表示で追いつく。
 *
 * 2026-09-04: 5 分のプロセス内キャッシュから 60 秒の Data Cache に変更した。
 * 単一固定向けの低トラフィック portal では Lambda インスタンスがすぐ冷える
 * ため、プロセス内 Map は **ほぼ毎回ミス** し、軽減表 / ロットを開くたびに
 * Google への往復 (最大 6 秒) がページ描画をブロックしていた (実機報告
 * 「外部サービスの読み込みにラグを感じる」)。Data Cache はインスタンスを
 * 跨いで共有され、古くなっても **古い値を返しつつ裏で更新** するので、
 * 通常の閲覧が外部 fetch を待つことはほぼ無くなる。
 *
 * 5 分から 60 秒に縮めたのは、共有キャッシュでは「冷えたインスタンスに
 * 当たれば即座に最新が見える」という逃げ道が無くなるため。シート編集 →
 * カード反映の最大待ちは 5 分から 1 分に縮まる。
 *
 * ⚠ 30 秒以下にしない (data-cache-swr.ts の W が書かなくなる。helper が
 * 作る時点で投げ、check-sheet-swr.mjs も見ている)。
 */
const FRESH_MS = 60_000;
/**
 * 失敗のプロセス内 TTL (ms)。失敗は Data Cache に載せない — 共有キャッシュに
 * 焼き付くと「共有設定を直したのに 1 分間直らない」ことになるため。代わりに
 * ここで短時間だけ抑え、非公開シートへの連打を防ぐ。タブ一覧は「ウェブに
 * 公開」していないシートで常に失敗する経路 (2026-08-30 の実機報告) なので、
 * 表と同じく必ず抑える。
 *
 * キャッシュ済みの値はこのメモに隠されない (メモを見るのは、外れたときと
 * 取り直しを控えるかの判断だけ)。
 */
const FAIL_TTL_MS = 30 * 1000;

export type SheetTableResult =
  | { ok: true; table: SheetTable; csvUrl: string }
  | { ok: false; reason: string };

/** Data Cache に置く表の値。 */
type SheetTableValue = { table: SheetTable; csvUrl: string };

/** 失敗の分類 (ログ用)。denied = 非公開、transient = 一時的、content = 中身。 */
type SheetFailKind = "denied" | "transient" | "content";
type SheetFetched<V> = SwrFetched<V> & { kind?: SheetFailKind };

/**
 * 冷えていてページの待ち上限を超えたとき。取得は after の中で続き、
 * 終われば Data Cache に書かれる (次の表示はカードになる)。
 * (理由をプロパティの形で書くのは、check-server-text が辞書の網羅をその形で
 * 拾うため。英訳は server-text-en.ts。)
 */
const RENDER_TIMED_OUT = {
  ok: false,
  reason: "シート取得が時間内に終わりませんでした",
} as const;

/** リクエストの待ちの締切。React `cache()` でリクエストごとに 1 つ。 */
const renderDeadline = cache(() => Date.now() + RENDER_WAIT_MS);

/**
 * ログ。URL (シートの ID を含む) は出さず、キーの短いハッシュを出す。
 *
 * `refresh fetched` (info) は出した直後の観測用 — 取り直しが、引き金になった
 * 閲覧と同じ要求 (`/category/<slug>/mitigation` か `/loot`) に記録される
 * ことを runtime logs で確かめたら、info は出さないようにする。書き込みの
 * 完了ではない (`write: queued` は Next が書き込みを積んだ、`skipped` は
 * 積まなかった。意味は data-cache-swr.ts の冒頭の「ログ」)。
 */
const log: SwrLog = (level, event, key, detail) => {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  console[level](`[sheet-swr] ${event}`, { key: hash, ...detail });
};

const tableSwr = createSwrEntry<SheetTableValue>(nextSwrDeps, {
  // 値の形を変えたら上げる (無印は revalidate: 60 の unstable_cache だった頃)。
  keyPart: "sheet-table-v2",
  fetch: (key) => {
    const [url, gid] = JSON.parse(key) as [string, string];
    return loadSheetTable(url, gid || null);
  },
  freshMs: FRESH_MS,
  failTtlMs: FAIL_TTL_MS,
  timedOutReason: RENDER_TIMED_OUT.reason,
  log,
});

const tabsSwr = createSwrEntry<SheetTab[]>(nextSwrDeps, {
  keyPart: "sheet-tabs-v2",
  fetch: loadSheetTabs,
  freshMs: FRESH_MS,
  failTtlMs: FAIL_TTL_MS,
  timedOutReason: RENDER_TIMED_OUT.reason,
  log,
});

/**
 * 1 リクエスト内の重複呼び出しは React `cache()` で畳み、インスタンスを
 * 跨いだ再取得は Data Cache (上の FRESH_MS) で抑える。
 */
export const fetchSheetTable = cache(
  async (
    sheetUrl: string | null | undefined,
    // 2026-08-30 (層タブ切替): 取得するワークシートの gid 上書き。
    // 未指定なら URL 自身の gid (従来挙動)。
    gid?: string | null,
  ): Promise<SheetTableResult> => {
    const url = (sheetUrl ?? "").trim();
    // 取りに行けない URL は Data Cache も読まずに返す。
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

/** 表を取りに行く (Data Cache を通さない。tableSwr の取得)。 */
async function loadSheetTable(
  sheetUrl: string,
  gid: string | null,
): Promise<SheetFetched<SheetTableValue>> {
  const csvUrl = toSheetCsvUrl(sheetUrl, gid);
  if (!csvUrl) {
    return {
      ok: false,
      kind: "content",
      reason: "CSV 取得に対応しない URL 形式",
    };
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

/** タブ一覧を取りに行く (Data Cache を通さない。tabsSwr の取得)。 */
async function loadSheetTabs(
  listUrl: string,
): Promise<SheetFetched<SheetTab[]>> {
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
