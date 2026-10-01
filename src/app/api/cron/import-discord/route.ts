import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { runDiscordImport } from "@/lib/server/discord-import";
import { assertCronAuth } from "@/lib/server/cron-auth";
import { recordCronRun } from "@/lib/server/cron-status";
import {
  countInsertedVideos,
  isLogsAutoSyncEnabled,
  triggerFflogsSyncRoute,
  type LogsSyncTrigger,
} from "@/lib/server/logs-auto-sync";

/**
 * Vercel Cron entrypoint — daily import of strategy / video URLs from
 * configured Discord channels into category_links.
 *
 * The actual logic lives in `lib/server/discord-import.ts`; this route only
 * deals with auth + JSON shaping. The same core function is also called
 * from the "Import now" Server Action (UI button).
 *
 * Authorization は `assertCronAuth` (src/lib/server/cron-auth.ts) に集約。
 * `Authorization: Bearer ${CRON_SECRET}` または `x-vercel-cron` ヘッダで通過。
 *
 * Schedule defined in `vercel.json`: 0 16 * * * (01:00 JST).
 *
 * 2.x (2026-06-09): maxDuration を 60 → 300 に引き上げ。N カテゴリ並列 ×
 * 5 ページの message fetch (15s timeout) × per-URL enrichment で 60s を
 * 超えるケースがあり、全カテゴリの insert がロールバックされるリスクが
 * あった。Vercel 標準 default (300s) に揃える。
 *
 * 2026-09-28: 動画が 1 件以上入ったら、Logs 同期 (`/api/cron/fflogs-sync`)
 * を別の実行として起動する。同じ実行で続けると 300s を超えるため
 * (`src/lib/server/logs-auto-sync.ts`)。JST 04:00 の同期 cron は取りこぼし
 * 拾いとして残す。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCronAuth(req, "cron/discord");
  if (denied) return denied;

  const result = await runDiscordImport();
  if (!result.ok) {
    // 2026-10-01 監査 F-2: 自動処理の最終実行として記録する。
    await recordCronRun("import-discord", "error", result.reason ?? "import failed");
    return NextResponse.json(
      { error: result.reason ?? "import failed" },
      { status: 503 },
    );
  }

  let logsSync: LogsSyncTrigger = "no-new-videos";
  if (countInsertedVideos(result.results) > 0) {
    logsSync = (await isLogsAutoSyncEnabled())
      ? await triggerFflogsSyncRoute(req.nextUrl.origin)
      : "disabled";
  }
  // 2026-10-01 監査 F-2: チャンネル単位の失敗が 1 つでもあれば失敗として
  // 記録する (どのチャンネルかは最初の 1 つだけ理由に載せる)。
  const failedChannels = result.results.filter((r) => !r.ok);
  await recordCronRun(
    "import-discord",
    failedChannels.length > 0 ? "error" : "ok",
    failedChannels.length > 0
      ? `${failedChannels.length} channel(s) failed: ${failedChannels[0]!.category}/${failedChannels[0]!.kind} ${failedChannels[0]!.reason ?? ""}`
      : null,
  );
  return NextResponse.json({ ok: true, results: result.results, logsSync });
}
