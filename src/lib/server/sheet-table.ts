import "server-only";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { safeFetch } from "./safe-fetch";
import { parseCsv, toSheetCsvUrl, toSheetTable, type SheetTable } from "@/lib/sheet-csv";

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
const TIMEOUT_MS = 15_000;

export type SheetTableResult =
  | { ok: true; table: SheetTable; csvUrl: string }
  | { ok: false; reason: string };

export async function fetchSheetTable(
  sheetUrl: string | null | undefined,
): Promise<SheetTableResult> {
  const csvUrl = toSheetCsvUrl(sheetUrl);
  if (!csvUrl) return { ok: false, reason: "CSV 取得に対応しない URL 形式" };
  if (!isPublicHttpUrl(csvUrl)) return { ok: false, reason: "URL が不正" };

  try {
    const res = await safeFetch(csvUrl, {
      // ISR: 5 分キャッシュ。開催中に編集された軽減表が 5 分で追いつく。
      next: { revalidate: 300 },
      headers: { Accept: "text/csv,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
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

/** 応答本文を MAX_BYTES で打ち切って読む。 */
async function readCapped(res: Response): Promise<string | null> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BYTES) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return null;
  return new TextDecoder("utf-8").decode(buf);
}
