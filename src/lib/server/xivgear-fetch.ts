import "server-only";
import { cache } from "react";
import { isPublicHttpUrl } from "@/lib/url-safe";
import { safeFetch } from "./safe-fetch";
import {
  buildXivgearFulldataUrl,
  parseXivgearSetUuid,
} from "@/lib/xivgear-url";
import {
  parseXivgearFulldata,
  type XivgearSheetSummary,
} from "@/lib/xivgear-set";

/**
 * XivGear `/fulldata` の取得 (2026-08-30)。
 *
 * 読み取り専用・失敗は必ず `{ ok: false }`。BiS の表示は従来どおりリンク +
 * 埋め込みで成立しているので、**取れなくても機能後退しない** (sheet-table.ts
 * と同じ設計)。
 *
 * 注意点:
 *   - 上流ドキュメントが `/fulldata` を "significantly slower" と明記して
 *     いるため、プロセス内 TTL キャッシュを必ず噛ませる
 *   - URL は uuid から組み立てるので host は api.xivgear.app 固定だが、
 *     他のユーザー入力 URL 取得経路と同様に SSRF 二層 (isPublicHttpUrl +
 *     safeFetch の IP ピン留め) を通す
 */

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** 装備構成は頻繁には変わらないので長めで良い。 */
const TTL_MS = 30 * 60 * 1000;

export type XivgearSummaryResult =
  | { ok: true; summary: XivgearSheetSummary }
  | { ok: false; reason: string };

const memo = new Map<string, { at: number; result: XivgearSummaryResult }>();

export const fetchXivgearSummary = cache(
  async (bisUrl: string | null | undefined): Promise<XivgearSummaryResult> => {
    const uuid = parseXivgearSetUuid(bisUrl);
    if (!uuid) {
      return { ok: false, reason: "XivGear の共有 URL ではありません" };
    }
    const hit = memo.get(uuid);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
    const result = await fetchUncached(uuid);
    memo.set(uuid, { at: Date.now(), result });
    if (memo.size > 64) {
      for (const k of memo.keys()) {
        memo.delete(k);
        if (memo.size <= 32) break;
      }
    }
    return result;
  },
);

async function fetchUncached(uuid: string): Promise<XivgearSummaryResult> {
  const url = buildXivgearFulldataUrl(uuid);
  if (!isPublicHttpUrl(url)) return { ok: false, reason: "URL が不正です" };
  try {
    const res = await safeFetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 404
            ? "セットが見つかりませんでした (URL を確認してください)"
            : `XivGear API エラー (${res.status})`,
      };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_BYTES) {
      return { ok: false, reason: "レスポンスが大きすぎます" };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, reason: "レスポンスが大きすぎます" };
    }
    const json = JSON.parse(new TextDecoder("utf-8").decode(buf)) as unknown;
    const summary = parseXivgearFulldata(json);
    if (!summary) {
      return { ok: false, reason: "セット情報を解釈できませんでした" };
    }
    return { ok: true, summary };
  } catch (e) {
    console.warn("[xivgear] fulldata fetch error:", e);
    return { ok: false, reason: "XivGear から取得できませんでした" };
  }
}
