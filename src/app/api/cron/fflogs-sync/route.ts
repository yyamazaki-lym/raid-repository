import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { linkFflogsReportsToVideos } from "@/lib/server/fflogs";
import { syncFflogsFights } from "@/lib/server/fflogs-fights";
import { assertCronAuth } from "@/lib/server/cron-auth";
import { fetchAppSetting } from "@/lib/supabase/app-settings";

/**
 * FFLogs ⇔ 動画 / 確定スケジュール (sync + native) を auto link する
 * cron route (TODO #73 follow-up、2.x — 2026-06)。
 *
 * 従来は admin が settings dialog の「FFLogs と動画を連動」button を
 * 押した時のみ起動していた。日次自動化することで運用負荷を解消する。
 *
 * 発火元は Vercel Cron (`vercel.json` の `crons` 配列、`0 19 * * *` =
 * UTC 19:00 = JST 04:00)。既存 import-discord (JST 01:00) / snapshot
 * (JST 21:50) と被らない深夜帯。
 *
 * Authorization は `assertCronAuth` (cron-auth.ts) に集約。
 * `Authorization: Bearer ${CRON_SECRET}` (Vercel cron が注入) または
 * `x-vercel-cron` ヘッダで通過。
 *
 * `app_settings.fflogs_cron_enabled='false'` のときは早期 return
 * (`{ ok: true, skipped: "disabled" }`) で no-op。未設定 / 'true' なら
 * 走らせる fail-open 設計 (新規 fork / 未設定 portal でも自動的に有効)。
 *
 * `linkFflogsReportsToVideos()` 自体が `ok: false` を返すケース
 * (FFLogs OAuth token 未取得 / refresh 失敗 / FFLogs API 障害) は
 * 200 で silent skip + `console.warn`。Vercel cron は 5xx で retry する
 * 仕様のため、token 失敗時に 503 を返すと一時障害で再試行ループに陥る。
 * admin は次回 settings dialog 開いた時 / 手動 button push 時に
 * 同 reason を見て対応する。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/fflogs-sync");
  if (denied) return denied;

  const enabled = await fetchAppSetting("fflogs_cron_enabled");
  if (enabled === "false") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  // useServiceRole: cron はユーザーセッション cookie を持たず anon ロールに
  // なるため、cookie ベースのクライアントだと RLS の admin write ポリシーで
  // 全書き込みが silent に 0 行更新される (2.8 follow-up で修正)。CRON_SECRET
  // 認証 (上の assertCronAuth) 済みの経路なので service role で書き込む。
  const result = await linkFflogsReportsToVideos({ useServiceRole: true });
  if (!result.ok) {
    console.warn(
      "[cron/fflogs-sync] linkFflogsReportsToVideos failed:",
      result.reason,
    );
    return NextResponse.json({
      ok: true,
      skipped: "link-failed",
      reason: result.reason,
    });
  }

  // TODO #94 (2026-08-28): リンク確定後に pull 単位の fights を materialize
  // する (練習ログタブ A-1 / A-2 のデータ源)。report ↔ カテゴリ / 日付の対応は
  // 直前の link 処理が更新した既存資産をそのまま読むので、この順序で走らせる。
  // OAuth 未接続などで取れない場合も link 結果は返したいので、失敗は握って
  // レスポンスに理由だけ載せる (cron の retry ループを避ける既存方針と同じ)。
  const fights = await syncFflogsFights({ useServiceRole: true });
  if (!fights.ok) {
    console.warn("[cron/fflogs-sync] syncFflogsFights failed:", fights.reason);
  }

  return NextResponse.json({
    ok: true,
    // D-3: 時間予算超過の部分同期 (wipe スキップ・追加リンクのみ)。
    // 次回 cron の全量 sync で整合する。
    truncated: result.truncated ?? false,
    reportsScanned: result.reportsScanned,
    videosScanned: result.videosScanned,
    matched: result.matched,
    sessionsScanned: result.sessionsScanned,
    sessionsMatched: result.sessionsMatched,
    nativeSessionsScanned: result.nativeSessionsScanned,
    nativeSessionsMatched: result.nativeSessionsMatched,
    // 第4ステップ (2026-07-12): 日付登録 Logs → 同日動画への橋渡し件数。
    manualLogsBridged: result.manualLogsBridged ?? 0,
    manualLogDaysScanned: result.manualLogDaysScanned ?? 0,
    // TODO #94: pull 単位ログの取り込み結果。
    fights: fights.ok
      ? {
          reportsKnown: fights.reportsKnown,
          reportsFetched: fights.reportsFetched,
          fightsUpserted: fights.fightsUpserted,
          failed: fights.failed,
          truncated: fights.truncated,
        }
      : { skipped: fights.reason },
  });
}
