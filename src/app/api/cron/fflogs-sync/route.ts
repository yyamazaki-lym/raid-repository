import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { linkFflogsReportsToVideos } from "@/lib/server/fflogs";
import { syncFflogsFights } from "@/lib/server/fflogs-fights";
import { assertCronAuth } from "@/lib/server/cron-auth";
import { recordCronRun } from "@/lib/server/cron-status";
import { fetchAppSetting } from "@/lib/supabase/app-settings";
import {
  FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS,
  FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC,
} from "@/lib/fflogs-sync-budget";
import { runWeeklyLogsSummary } from "@/lib/server/logs-weekly-summary";

/**
 * 週のまとめ (C-4、2026-10-05) が新しい読み取り・投稿を始めてよい期限
 * (route 開始から)。maxDuration の 45s 手前 — 期限直前に始めた 1 カテゴリ
 * (明細の読み取り + Discord への投稿 15s + 429 の待ち) を受ける余白。
 */
const WEEKLY_SUMMARY_TAIL_MS = 45_000;

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
  const routeStartMs = Date.now();
  const deadlineAtMs = routeStartMs + FFLOGS_SYNC_ROUTE_FETCH_BUDGET_MS;

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
    // 設定画面の診断表示 (GraphQL introspection 3 回) は cron では要らない。
    diagnostics: false,
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

  // 2026-10-05 (C-4): 週のまとめ。取り込みが最後まで済んだ回だけ送る
  // (月曜の夜の練習が欠けたまとめを送らない)。送ってよい日は火〜木なので、
  // 火曜に同期が途中で終わっても水・木の同期で送り直せる。
  const syncComplete = fights.ok && !fights.truncated && !result.truncated;
  const weeklySummary = syncComplete
    ? await runWeeklyLogsSummary({
        now: new Date(),
        baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
        deadlineAtMs:
          routeStartMs + FFLOGS_SYNC_ROUTE_MAX_DURATION_SEC * 1000 - WEEKLY_SUMMARY_TAIL_MS,
      })
    : ({ sent: false, skipped: "sync-incomplete" } as const);
  if (weeklySummary.sent && weeklySummary.failed > 0) {
    console.warn("[cron/fflogs-sync] weekly summary partly failed:", weeklySummary.reason);
  } else if (!weeklySummary.sent && weeklySummary.skipped === "error") {
    console.warn("[cron/fflogs-sync] weekly summary failed:", weeklySummary.reason);
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
          // C-7 (2026-10-01): レート制限での打ち切りとポイント残量。
          rateLimited: fights.rateLimited ?? false,
          pointsRemainingRatio: fights.pointsRemainingRatio ?? null,
        }
      : { skipped: fights.reason },
    // C-4 (2026-10-05): 週のまとめの結果 (送った数 / 送らなかった理由)。
    weeklySummary,
  });
}
