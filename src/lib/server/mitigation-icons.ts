import "server-only";
import { cache } from "react";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { safeFetch } from "./safe-fetch";
import { toSheetTabListUrl } from "@/lib/sheet-csv";
import {
  iconKey,
  parseSheetImageRows,
  pickIconRow,
  type SheetImageRow,
} from "@/lib/sheet-icons";
import { fetchJobguideIconNames } from "./ffxiv-jobguide";

/**
 * 軽減表のアビリティ列を「アイコン画像から」割り出す (2026-08-30)。
 *
 * CSV には画像が出ないが、pubhtml / htmlview は `<img>` として描画するので
 * そこから列 → アイコン URL を取れる。さらに公式ジョブガイドのアクション
 * アイコンと同じ画像なら、ファイル名をキーに名前まで引ける。
 *
 * 自動判定はあくまで**入力補助**。名前が引けなくてもアイコンを見せるだけで
 * 「どの列が何か」は人が判断できるので、そこまでは必ず返す。
 */

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;

export type MitigationIconGuess = {
  /** 0 始まりの列番号 (CSV 側と一致)。 */
  column: number;
  /** アイコン画像の URL (そのまま <img> で表示できる)。 */
  iconUrl: string;
  /** ジョブガイドから引けたアクション名 (引けなければ null)。 */
  guessedName: string | null;
};

export type MitigationIconResult =
  | { ok: true; icons: MitigationIconGuess[]; namedCount: number }
  | { ok: false; reason: string };

const htmlMemo = new Map<string, { at: number; rows: SheetImageRow[] }>();

/**
 * シート HTML を取得してアイコン行を解析する。gid 指定で層ごとに切り替わる。
 */
async function fetchIconRow(
  sheetUrl: string,
  gid: string | null,
): Promise<SheetImageRow | null> {
  const base = toSheetTabListUrl(sheetUrl);
  if (!base) return null;
  // htmlview / pubhtml とも gid で対象シートを指定できる。
  const url = gid ? `${base}?gid=${encodeURIComponent(gid)}&single=true` : base;
  if (!isPublicHttpUrl(url)) return null;
  const hit = htmlMemo.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return pickIconRow(hit.rows);
  try {
    const res = await safeFetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;
    const html = new TextDecoder("utf-8").decode(buf);
    const rows = parseSheetImageRows(html);
    htmlMemo.set(url, { at: Date.now(), rows });
    if (htmlMemo.size > 32) {
      for (const k of htmlMemo.keys()) {
        htmlMemo.delete(k);
        if (htmlMemo.size <= 16) break;
      }
    }
    return pickIconRow(rows);
  } catch (e) {
    console.warn("[mitigation-icons] sheet html fetch failed:", e);
    return null;
  }
}

export const detectMitigationIcons = cache(
  async (
    sheetUrl: string | null | undefined,
    gid: string | null,
  ): Promise<MitigationIconResult> => {
    if (!sheetUrl) return { ok: false, reason: "シート URL が未設定です" };
    const iconRow = await fetchIconRow(sheetUrl, gid);
    if (!iconRow || iconRow.cells.length === 0) {
      return {
        ok: false,
        reason:
          "シートからアイコンを読み取れませんでした (共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください)",
      };
    }

    // 名前解決は best-effort。失敗してもアイコンだけは返す。
    let names = new Map<string, string>();
    try {
      names = await fetchJobguideIconNames();
    } catch (e) {
      console.warn("[mitigation-icons] jobguide lookup failed:", e);
    }

    const icons: MitigationIconGuess[] = iconRow.cells
      // シート由来の文字列をそのまま <img src> に流すので、http(s) 以外は捨てる。
      .filter((c) => /^https?:\/\//i.test(c.src))
      .map((c) => {
        const key = iconKey(c.src);
        return {
          column: c.column,
          iconUrl: c.src,
          guessedName: key ? (names.get(key) ?? null) : null,
        };
      });
    if (icons.length === 0) {
      return { ok: false, reason: "アイコン画像の URL を読み取れませんでした" };
    }
    return {
      ok: true,
      icons,
      namedCount: icons.filter((i) => i.guessedName !== null).length,
    };
  },
);
