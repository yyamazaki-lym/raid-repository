import "server-only";
import { cache } from "react";
import { safeFetch } from "./safe-fetch";
import {
  iconKey,
  parseSheetImageRows,
  pickIconRow,
} from "@/lib/sheet-icons";
import { extractImageCellsBySheet, unzip } from "@/lib/xlsx-lite";
import { fetchJobguideIconNames } from "./ffxiv-jobguide";

/**
 * 軽減表のアビリティ列を「アイコン画像から」割り出す (2026-08-31)。
 *
 * ## 取得経路を 2 つ持つ理由
 *
 * `=IMAGE(url)` のセルは、どうエクスポートするかで見えるものが変わる:
 *
 *   - CSV / gviz … 数式の**結果**が文字列化される → 空になる (使えない)
 *   - **xlsx**   … `<f>IMAGE("...")</f>` と数式が残る。共有が
 *                  「リンクを知っている全員が閲覧可」なら落とせる
 *   - **HTML**   … `<img>` で描画される。ただし「ウェブに公開」が要る
 *
 * 実運用のシートは「リンク共有だけ / ウェブ公開はしていない」ことが多い
 * (2026-08-31 実機で HTML 経路が失敗)。そこで **xlsx を第一経路**にし、
 * HTML を予備に回す。
 *
 * ## 失敗したときに何を返すか
 *
 * 「取得できませんでした」だけでは、共有設定なのか URL なのかシートの
 * 作りなのか切り分けられない。**どの経路を試して何が返ったか**を
 * `diagnostics` に積んでそのまま画面に出す。
 */

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 24 * 1024 * 1024;
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
  | {
      ok: true;
      icons: MitigationIconGuess[];
      namedCount: number;
      /** どの経路で取れたか (画面に出す)。 */
      source: string;
      diagnostics: string[];
    }
  | { ok: false; reason: string; diagnostics: string[] };

/** 取得できた「列 → アイコン URL」と、その出所。 */
type IconHit = { column: number; src: string };

const memo = new Map<string, { at: number; body: Uint8Array | null }>();

/** スプレッドシートのドキュメント ID (`/d/<id>/`)。公開専用 URL は null。 */
export function sheetDocId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.hostname !== "docs.google.com") return null;
    const m = /^\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** 公開 URL (`/d/e/<token>/`) のトークン。通常の共有 URL なら null。 */
export function sheetPubToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.hostname !== "docs.google.com") return null;
    const m = /^\/spreadsheets\/d\/e\/([^/]+)\//.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

async function fetchBytes(
  url: string,
  log: string[],
  label: string,
): Promise<Uint8Array | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) {
    log.push(`${label}: (キャッシュ) ${hit.body ? "取得済み" : "取得失敗"}`);
    return hit.body;
  }
  let body: Uint8Array | null = null;
  try {
    const res = await safeFetch(url, {
      headers: { "Accept-Language": "ja" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.push(`${label}: HTTP ${res.status}`);
    } else {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        log.push(`${label}: サイズ超過 (${Math.round(buf.byteLength / 1e6)}MB)`);
      } else {
        body = new Uint8Array(buf);
        log.push(`${label}: OK (${Math.round(buf.byteLength / 1024)}KB)`);
      }
    }
  } catch (e) {
    log.push(`${label}: 失敗 (${e instanceof Error ? e.message : String(e)})`);
  }
  memo.set(url, { at: Date.now(), body });
  if (memo.size > 12) memo.delete(memo.keys().next().value!);
  return body;
}

/**
 * 経路 1: xlsx をダウンロードして IMAGE 数式を読む。
 * gid は xlsx に残らないのでシート名で引く。名前が分からない / 一致しない
 * ときは「IMAGE セルが最も多いシート」を使う。
 */
async function fromXlsx(
  sheetUrl: string,
  sheetName: string | null,
  log: string[],
): Promise<IconHit[] | null> {
  const id = sheetDocId(sheetUrl);
  if (!id) {
    log.push("xlsx: 通常の共有 URL ではないため試行せず (公開専用 URL)");
    return null;
  }
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const bytes = await fetchBytes(url, log, "xlsx ダウンロード");
  if (!bytes) return null;
  const files = unzip(bytes);
  if (files.size === 0) {
    log.push("xlsx: zip として読めませんでした (ログイン画面の可能性)");
    return null;
  }
  const bySheet = extractImageCellsBySheet(files);
  log.push(
    `xlsx: シート ${bySheet.size} 件 / IMAGE セル ${[...bySheet.values()].reduce((n, c) => n + c.length, 0)} 件`,
  );
  let cells = sheetName ? bySheet.get(sheetName) : undefined;
  if (cells?.length) {
    log.push(`xlsx: シート「${sheetName}」から ${cells.length} 件`);
  } else {
    if (sheetName) log.push(`xlsx: シート「${sheetName}」に IMAGE が無く、最多のシートを使用`);
    cells = [...bySheet.values()].sort((a, b) => b.length - a.length)[0];
  }
  if (!cells?.length) return null;
  // 同じ行に固まっているものがアビリティ行。最多の行を採る。
  const byRow = new Map<number, IconHit[]>();
  for (const c of cells) {
    const list = byRow.get(c.row) ?? [];
    list.push({ column: c.column, src: c.url });
    byRow.set(c.row, list);
  }
  const best = [...byRow.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
  log.push(`xlsx: ${best[0] + 1} 行目のアイコン ${best[1].length} 件を採用`);
  return best[1];
}

/** 経路 2: HTML ビュー (`pubhtml` / `htmlview`) の `<img>` を読む。 */
async function fromHtml(
  sheetUrl: string,
  gid: string | null,
  log: string[],
): Promise<IconHit[] | null> {
  const id = sheetDocId(sheetUrl);
  const pub = sheetPubToken(sheetUrl);
  const q = gid ? `?gid=${encodeURIComponent(gid)}&single=true` : "";
  const candidates = pub
    ? [`https://docs.google.com/spreadsheets/d/e/${pub}/pubhtml${q}`]
    : id
      ? [
          `https://docs.google.com/spreadsheets/d/${id}/htmlview${q}`,
          `https://docs.google.com/spreadsheets/d/${id}/pubhtml${q}`,
        ]
      : [];
  for (const url of candidates) {
    const label = `HTML (${url.includes("pubhtml") ? "pubhtml" : "htmlview"})`;
    const bytes = await fetchBytes(url, log, label);
    if (!bytes) continue;
    const rows = parseSheetImageRows(new TextDecoder("utf-8").decode(bytes));
    const row = pickIconRow(rows);
    if (!row) {
      log.push(`${label}: 画像のある行が見つかりませんでした`);
      continue;
    }
    log.push(`${label}: ${row.row + 1} 行目のアイコン ${row.cells.length} 件を採用`);
    return row.cells;
  }
  return null;
}

export const detectMitigationIcons = cache(
  async (
    sheetUrl: string | null | undefined,
    gid: string | null,
    sheetName: string | null,
  ): Promise<MitigationIconResult> => {
    const log: string[] = [];
    if (!sheetUrl) {
      return { ok: false, reason: "シート URL が未設定です", diagnostics: log };
    }

    let source = "xlsx (数式)";
    let hits = await fromXlsx(sheetUrl, sheetName, log);
    if (!hits) {
      source = "HTML ビュー";
      hits = await fromHtml(sheetUrl, gid, log);
    }
    // シート由来の文字列をそのまま <img src> に流すので http(s) 以外は捨てる。
    const cells = (hits ?? []).filter((c) => /^https?:\/\//i.test(c.src));
    if (cells.length === 0) {
      return {
        ok: false,
        reason:
          "アイコンを読み取れませんでした。共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください。",
        diagnostics: log,
      };
    }

    // 名前解決は best-effort。失敗してもアイコンだけは返す。
    let names = new Map<string, string>();
    try {
      names = await fetchJobguideIconNames();
      log.push(`ジョブガイド: アクション ${names.size} 件を照合対象に取得`);
    } catch (e) {
      log.push(`ジョブガイド: 取得失敗 (${e instanceof Error ? e.message : String(e)})`);
    }

    const icons: MitigationIconGuess[] = cells.map((c) => {
      const key = iconKey(c.src);
      return {
        column: c.column,
        iconUrl: c.src,
        guessedName: key ? (names.get(key) ?? null) : null,
      };
    });
    return {
      ok: true,
      icons,
      namedCount: icons.filter((i) => i.guessedName !== null).length,
      source,
      diagnostics: log,
    };
  },
);
