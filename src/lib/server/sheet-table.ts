import "server-only";
import { cache } from "react";
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
/** プロセス内 TTL キャッシュの寿命。開催中の編集が最大この時間で追いつく。 */
const TTL_MS = 5 * 60 * 1000;

export type SheetTableResult =
  | { ok: true; table: SheetTable; csvUrl: string }
  | { ok: false; reason: string };

/**
 * プロセス内 TTL キャッシュ。
 *
 * ⚠ `safeFetch` は undici を直接使う (IP ピン留めのため) ので **Next の
 * fetch キャッシュ (`next: { revalidate }`) は効かない**。素で書くと
 * 軽減表/ロットを開くたびに Google へ取りに行くことになるため、ここで
 * 明示的にキャッシュする。Lambda インスタンス単位なので厳密な共有では
 * ないが、「編集の正は Sheets 側」という前提では十分。
 */
const memo = new Map<string, { at: number; result: SheetTableResult }>();

/**
 * 1 リクエスト内の重複呼び出しは React `cache()` で畳み、インスタンスを
 * 跨いだ再取得は上の TTL で抑える。
 */
export const fetchSheetTable = cache(
  async (
    sheetUrl: string | null | undefined,
    // 2026-08-30 (層タブ切替): 取得するワークシートの gid 上書き。
    // 未指定なら URL 自身の gid (従来挙動)。
    gid?: string | null,
  ): Promise<SheetTableResult> => {
    const key = `${(sheetUrl ?? "").trim()}#gid=${gid ?? ""}`;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
    const result = await fetchSheetTableUncached(sheetUrl, gid);
    // 失敗も短時間キャッシュする (非公開シートに毎回取りに行かない)。
    memo.set(key, { at: Date.now(), result });
    // 際限なく増えないように上限を切る (カテゴリ数 × 2 程度しか入らない)。
    if (memo.size > 64) {
      for (const k of memo.keys()) {
        memo.delete(k);
        if (memo.size <= 32) break;
      }
    }
    return result;
  },
);

/** タブ一覧のプロセス内 TTL キャッシュ (fetchSheetTable の memo と同方式)。 */
const tabsMemo = new Map<string, { at: number; tabs: SheetTab[] }>();

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
    const hit = tabsMemo.get(listUrl);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.tabs;
    let tabs: SheetTab[] = [];
    try {
      const res = await safeFetch(listUrl, {
        headers: { Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        // htmlview はシート全体の HTML を含むため CSV よりだいぶ大きい。
        // タブバーは文書末尾にあるので全体を読むが、上限は CSV の 2 倍。
        const text = await readCapped(res, MAX_BYTES * 2);
        if (text !== null) tabs = parseSheetTabs(text);
      }
    } catch (e) {
      console.warn("[sheet-table] tabs fetch error:", e);
    }
    tabsMemo.set(listUrl, { at: Date.now(), tabs });
    if (tabsMemo.size > 64) {
      for (const k of tabsMemo.keys()) {
        tabsMemo.delete(k);
        if (tabsMemo.size <= 32) break;
      }
    }
    return tabs;
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
