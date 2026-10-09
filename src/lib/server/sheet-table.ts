import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { isPublicHttpUrl } from "@/lib/url-safe";
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
 *   - 応答は 2MB / 15 秒で打ち切り
 */

const MAX_BYTES = 2 * 1024 * 1024;
// ページ描画をブロックする経路なので短め。監査 D-1 の「外部 fetch は 8s」
// より更に短くする (取れなければ iframe に落ちるだけで実害がない)。
const TIMEOUT_MS = 6_000;
/**
 * Data Cache の TTL (秒)。開催中の編集が最大この時間で追いつく。
 *
 * 2026-09-04: 5 分のプロセス内キャッシュから 60 秒の Data Cache に変更した。
 * 単一固定向けの低トラフィック portal では Lambda インスタンスがすぐ冷える
 * ため、プロセス内 Map は **ほぼ毎回ミス** し、軽減表 / ロットを開くたびに
 * Google への往復 (最大 6 秒) がページ描画をブロックしていた (実機報告
 * 「外部サービスの読み込みにラグを感じる」)。Data Cache はインスタンスを
 * 跨いで共有され、TTL 超過後も **stale を返しつつ裏で更新** するので、
 * 通常の閲覧が外部 fetch を待つことはほぼ無くなる。
 *
 * TTL を 5 分から 60 秒に縮めたのは、共有キャッシュでは「冷えたインスタンスに
 * 当たれば即座に最新が見える」という逃げ道が無くなるため。シート編集 →
 * カード反映の最大待ちは 5 分から 1 分に縮まる。
 */
const CACHE_TTL_SECONDS = 60;
/**
 * 失敗のプロセス内 TTL (ms)。失敗は Data Cache に載せない — 共有キャッシュに
 * 焼き付くと「共有設定を直したのに 1 分間直らない」ことになるため。代わりに
 * ここで短時間だけ抑え、非公開シートへの連打を防ぐ。
 */
const FAIL_TTL_MS = 30 * 1000;

export type SheetTableResult =
  | { ok: true; table: SheetTable; csvUrl: string }
  | { ok: false; reason: string };

/**
 * シート取得の Data Cache タグ。無効化が要るときはこのタグを叩く。
 *
 * ⚠ `safeFetch` は undici を直接使う (IP ピン留めのため) ので **Next の
 * fetch キャッシュ (`next: { revalidate }`) は効かない**。そこで
 * `unstable_cache` で関数単位にキャッシュする (Next.js 16 では `use cache`
 * が後継だが、それには `cacheComponents` の全体切替が要るのでここでは使わない)。
 */
export const SHEET_CACHE_TAG = "sheet";

/**
 * 失敗した取得のプロセス内メモ (Data Cache には載せない)。
 *
 * 失敗を Data Cache に載せないぶん、ここが無いと **失敗するたびに毎回
 * 取りに行く** ことになる。タブ一覧は「ウェブに公開」していないシートで
 * 常に失敗する経路 (2026-08-30 の実機報告) なので、表と同じく必ず抑える。
 */
const failMemo = new Map<string, { at: number; result: SheetTableResult }>();
const tabsFailMemo = new Map<string, number>();

/** 失敗メモの上限を切る (カテゴリ数 × 2 程度しか入らない想定)。 */
function trimMemo(m: Map<string, unknown>): void {
  if (m.size <= 64) return;
  for (const k of m.keys()) {
    m.delete(k);
    if (m.size <= 32) break;
  }
}

/**
 * 取得失敗を表す例外。`unstable_cache` の中から投げることで **失敗を
 * キャッシュさせない** (rejection は Data Cache に書かれない)。
 */
class SheetFetchError extends Error {}

/**
 * Data Cache 本体。引数 (URL と gid) がそのままキーになる。
 * 成功時のみ値を返し、失敗は投げる。
 */
const cachedSheetTable = unstable_cache(
  async (sheetUrl: string, gid: string): Promise<SheetTableResult> => {
    const result = await fetchSheetTableUncached(sheetUrl, gid || null);
    if (!result.ok) throw new SheetFetchError(result.reason);
    return result;
  },
  ["sheet-table"],
  { revalidate: CACHE_TTL_SECONDS, tags: [SHEET_CACHE_TAG] },
);

/**
 * 1 リクエスト内の重複呼び出しは React `cache()` で畳み、インスタンスを
 * 跨いだ再取得は Data Cache (上の TTL) で抑える。
 */
export const fetchSheetTable = cache(
  async (
    sheetUrl: string | null | undefined,
    // 2026-08-30 (層タブ切替): 取得するワークシートの gid 上書き。
    // 未指定なら URL 自身の gid (従来挙動)。
    gid?: string | null,
  ): Promise<SheetTableResult> => {
    const url = (sheetUrl ?? "").trim();
    if (!url) return { ok: false, reason: "CSV 取得に対応しない URL 形式" };
    const key = `${url}#gid=${gid ?? ""}`;
    const failed = failMemo.get(key);
    if (failed && Date.now() - failed.at < FAIL_TTL_MS) return failed.result;
    try {
      return await cachedSheetTable(url, gid ?? "");
    } catch (e) {
      const result: SheetTableResult = {
        ok: false,
        reason:
          e instanceof SheetFetchError
            ? e.message
            : "シート取得に失敗しました",
      };
      failMemo.set(key, { at: Date.now(), result });
      trimMemo(failMemo);
      return result;
    }
  },
);

/** タブ一覧の Data Cache (fetchSheetTable と同方式)。 */
const cachedSheetTabs = unstable_cache(
  async (listUrl: string): Promise<SheetTab[]> => {
    const res = await safeFetch(listUrl, {
      headers: { Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new SheetFetchError(`tabs ${res.status}`);
    // htmlview はシート全体の HTML を含むため CSV よりだいぶ大きい。
    // タブバーは文書末尾にあるので全体を読むが、上限は CSV の 2 倍。
    const text = await readCapped(res, MAX_BYTES * 2);
    if (text === null) throw new SheetFetchError("tabs too large");
    return parseSheetTabs(text);
  },
  ["sheet-tabs"],
  { revalidate: CACHE_TTL_SECONDS, tags: [SHEET_CACHE_TAG] },
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
    const failedAt = tabsFailMemo.get(listUrl);
    if (failedAt !== undefined && Date.now() - failedAt < FAIL_TTL_MS) return [];
    try {
      return await cachedSheetTabs(listUrl);
    } catch (e) {
      console.warn("[sheet-table] tabs fetch error:", e);
      tabsFailMemo.set(listUrl, Date.now());
      trimMemo(tabsFailMemo);
      return [];
    }
  },
);

async function fetchSheetTableUncached(
  sheetUrl: string | null | undefined,
  gid?: string | null,
): Promise<SheetTableResult> {
  const csvUrl = toSheetCsvUrl(sheetUrl, gid);
  if (!csvUrl) return { ok: false, reason: "CSV 取得に対応しない URL 形式" };
  if (!isPublicHttpUrl(csvUrl)) return { ok: false, reason: "URL が不正" };

  try {
    const res = await safeFetch(csvUrl, {
      headers: { Accept: "text/csv,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 401 || res.status === 403
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
        reason: "シートが非公開です（CSV ではなく HTML が返りました）",
      };
    }
    const text = await readCapped(res);
    if (text === null) return { ok: false, reason: "シートが大きすぎます" };
    const table = toSheetTable(parseCsv(text));
    if (!table) return { ok: false, reason: "シートが空です" };
    return { ok: true, table, csvUrl };
  } catch (e) {
    // タイムアウト / DNS / ブロック済みアドレスなど。iframe fallback で継続。
    console.warn("[sheet-table] fetch error:", e);
    return { ok: false, reason: "シート取得に失敗しました" };
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
