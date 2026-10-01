import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { linkFflogsReportsToVideos } from "@/lib/server/fflogs";
import { syncFflogsFights } from "@/lib/server/fflogs-fights";
import { assertCronAuth } from "@/lib/server/cron-auth";
import { recordCronRun } from "@/lib/server/cron-status";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import { FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS } from "@/lib/fflogs-sync-budget";

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
  // C-1 (2026-10-01 監査): 2 段 (リンク → pull 取り込み) で 1 つの期限を
  // 共有する。段ごとに予算を数えると 240s + 120s で maxDuration (300s) を
  // 超え、wipe 後・再リンク前に kill され得た。内訳は fflogs-sync-budget.ts。
  // 認証より前に切るのは、ここからが関数の実行時間だから。
  const deadlineAtMs = Date.now() + FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS;

  const denied = assertCronAuth(req, "cron/fflogs-sync");
  if (denied) return denied;

  const enabled = await fetchAppSetting("fflogs_cron_enabled");
  if (enabled === "false") {
    await recordCronRun("fflogs-sync", "skipped", "disabled");
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  // useServiceRole: cron はユーザーセッション cookie を持たず anon ロールに
  // なるため、cookie ベースのクライアントだと RLS の admin write ポリシーで
  // 全書き込みが silent に 0 行更新される (2.8 follow-up で修正)。CRON_SECRET
  // 認証 (上の assertCronAuth) 済みの経路なので service role で書き込む。
  const result = await linkFflogsReportsToVideos({
    useServiceRole: true,
    deadlineAtMs,
  });
  if (!result.ok) {
    console.warn(
      "[cron/fflogs-sync] linkFflogsReportsToVideos failed:",
      result.reason,
    );
    await recordCronRun("fflogs-sync", "error", `link: ${result.reason}`);
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
  //
  // C-1: リンク段が期限を使い切っていたら pull 取り込みは始めない (次の
  // 同期 — 翌日の cron か画面のボタン — が台帳の未取得分から続ける)。
  // 取り込みの中の自動発見や後処理も外部 / DB を叩くので、段ごと飛ばす。
  const fights =
    Date.now() < deadlineAtMs
      ? await syncFflogsFights({ useServiceRole: true, deadlineAtMs })
      : ({
          ok: false,
          // 応答 JSON の他の skipped 値 (disabled / link-failed) と同じ英語コード。
          reason: "deadline-exhausted",
        } as const);
  if (!fights.ok) {
    console.warn("[cron/fflogs-sync] syncFflogsFights failed:", fights.reason);
  }
  // 2026-10-01 監査 F-2: 期限切れで pull 取り込みを回した / 打ち切った回は
  // 「一部」、取り込み自体の失敗 (OAuth 未接続など) は「失敗」として記録する。
  await recordCronRun(
    "fflogs-sync",
    !fights.ok
      ? fights.reason === "deadline-exhausted"
        ? "partial"
        : "error"
      : result.truncated || fights.truncated
        ? "partial"
        : "ok",
    !fights.ok
      ? `fights: ${fights.reason}`
      : result.truncated || fights.truncated
        ? "truncated"
        : null,
  );

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
