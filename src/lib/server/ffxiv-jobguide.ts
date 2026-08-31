import "server-only";
import { safeFetch } from "./safe-fetch";
import {
  extractIconNamePairs,
  extractJobPaths,
} from "@/lib/sheet-icons";

/**
 * 公式ジョブガイドから「アイコン画像 → アクション名」の対応表を作る
 * (2026-08-30 実機情報「アイコンは公式ジョブガイドの画像にリンクされている」)。
 *
 * 軽減表のアビリティ欄は `=IMAGE("https://lds-img.finalfantasyxiv.com/...")`
 * で公式アイコンを貼っている。同じ画像がジョブガイドのアクション一覧にも
 * 使われているので、**画像のファイル名をキーに名前を引ける**。
 *
 * ⚠ ジョブガイドは公式サイトの HTML であり、構造が変わればここは壊れる。
 * 壊れたときは「自動判定できませんでした」になるだけで、手入力の導線は
 * 常に残る (この機能は入力補助であって、依存先ではない)。
 *
 * 取得は admin が明示的にボタンを押したときだけ。ジョブ数ぶんのページを
 * 取りに行くので、プロセス内に長めのキャッシュを持つ。
 */

const JOBGUIDE_BASE = "https://jp.finalfantasyxiv.com";
const JOBGUIDE_INDEX = `${JOBGUIDE_BASE}/jobguide/battle/`;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 3 * 1024 * 1024;
/** アクション一覧はパッチ単位でしか変わらないので長めに持つ。 */
const TTL_MS = 24 * 60 * 60 * 1000;
/** 1 回の実行で取りに行くジョブページ数の上限 (時間予算の保険)。 */
const MAX_JOB_PAGES = 24;

let cache: { at: number; map: Map<string, string> } | null = null;

/** ジョブガイドから引いた「アイコンキー → アクション名」。失敗時は空 Map。 */
export async function fetchJobguideIconNames(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, string>();
  try {
    const indexHtml = await fetchText(JOBGUIDE_INDEX);
    if (indexHtml) {
      const jobPaths = extractJobPaths(indexHtml).slice(0, MAX_JOB_PAGES);
      for (const path of jobPaths) {
        const html = await fetchText(`${JOBGUIDE_BASE}${path}`);
        if (!html) continue;
        for (const [key, name] of extractIconNamePairs(html)) {
          if (!map.has(key)) map.set(key, name);
        }
      }
    }
  } catch (e) {
    console.warn("[jobguide] fetch failed:", e);
  }
  // 失敗しても空 Map をキャッシュして連打で毎回取りに行かないようにする
  // (TTL 経過後に再試行される)。
  cache = { at: Date.now(), map };
  return map;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return null;
  }
}
