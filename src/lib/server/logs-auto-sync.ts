import "server-only";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import type { ImportResult } from "./discord-import";

/**
 * Discord 取り込みの直後に Logs 同期 (FFLogs ⇔ 動画のリンク + pull 取り込み)
 * を自動で走らせるための共通部品 (2026-09-28)。
 *
 * 従来は取り込み (JST 01:00) と Logs 同期 (JST 04:00) が別 cron で、手動
 * 取り込みや日中の取り込み分は翌朝 04:00 まで Logs が付かなかった。
 *
 * 取り込みと同じ実行の中では同期しない。取り込み本体 + リンク (予算 240s) +
 * pull 取り込み (予算 120s) で Vercel の上限 300s を超えるため、必ず別の
 * 実行 (手動: 画面から続けて Server Action を呼ぶ / cron: 同期 route を
 * 起動) に分ける。
 *
 * ON/OFF は新設せず、既存の日次自動連動トグル (`fflogs_cron_enabled`) に
 * 従う。cron route と同じく `'false'` のときだけ止める fail-open。
 */

/** 取り込み結果のうち、動画として新しく入った件数。 */
export function countInsertedVideos(results: ImportResult[]): number {
  let n = 0;
  for (const r of results) {
    if (r.kind === "video" && r.ok) n += r.inserted ?? 0;
  }
  return n;
}

/** 日次自動連動トグルが OFF でないか。 */
export async function isLogsAutoSyncEnabled(): Promise<boolean> {
  const value = await fetchAppSetting("fflogs_cron_enabled");
  return value !== "false";
}

/**
 * 同期 route の起動待ち時間。route 本体は数分かかるので完了は待たず、
 * リクエストが届いた時点で打ち切る。呼び出し側を切っても Vercel は
 * 起動済みの実行を止めない (pg_cron の pg_net 経由の cron と同じ前提)。
 */
const TRIGGER_TIMEOUT_MS = 10_000;

export type LogsSyncTrigger =
  | "triggered"
  | "no-new-videos"
  | "disabled"
  | "not-configured"
  | "failed";

/**
 * `/api/cron/fflogs-sync` を別の実行として起動する (cron 取り込み用)。
 *
 * 宛先は Host ヘッダ由来の origin ではなく、Vercel が注入する本番ドメインを
 * 優先する (CRON_SECRET を載せるので、宛先はリクエスト内容に依らず固定する)。
 * 本番ドメインが無い環境 (ローカル等) だけ `fallbackOrigin` を使う。
 */
export async function triggerFflogsSyncRoute(
  fallbackOrigin: string,
): Promise<LogsSyncTrigger> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return "not-configured";

  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const origin = prodHost ? `https://${prodHost}` : fallbackOrigin;
  const url = `${origin}/api/cron/fflogs-sync`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[logs-auto-sync] fflogs-sync route returned", res.status);
      return "failed";
    }
    return "triggered";
  } catch (err) {
    // タイムアウト = 同期 route が処理中 (起動は成功している)。
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return "triggered";
    }
    console.warn("[logs-auto-sync] failed to trigger fflogs-sync", String(err));
    return "failed";
  }
}
