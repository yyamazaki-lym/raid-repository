import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Vercel Cron entrypoint 用の認証ヘルパ (2.x, 2026-06-09)。
 *
 * 旧設計では `/api/cron/*` の各 route が「`CRON_SECRET` trim →
 * `Authorization: Bearer` 比較 → `x-vercel-cron` ヘッダ確認」を独立に
 * 書いており、1 箇所だけ check 抜け / typo が混入してもレビューで
 * 気付きづらかった。ここに 1 本化することで cron 認証は本ファイルだけ
 * 見ればよくなる。
 *
 * 認証の判定:
 *   - 環境変数 `CRON_SECRET` が未設定 → 503 を返す (deploy ミス検知)
 *   - `Authorization: Bearer ${CRON_SECRET}` ヘッダが一致 → 通過
 *   - `x-vercel-cron` ヘッダ存在 (Vercel cron / Dashboard "Run") → 通過
 *     (Vercel は外部リクエストから x-vercel-* ヘッダを edge で剥がす)
 *   - いずれも満たさない → 401 を返す
 *
 * `routeLabel` はログ識別用の短い名前 (例 "cron/discord")。
 *
 * 使い方:
 *   export async function GET(req: NextRequest) {
 *     const denied = assertCronAuth(req, "cron/discord");
 *     if (denied) return denied;
 *     // ...本処理
 *   }
 *
 * -------------------------------------------------------------------
 * 全 cron スケジュール表 (TODO #13, 2.x — 1 箇所集約):
 *
 * | route                              | schedule (UTC)  | JST    | 発火元    | 設定ファイル            |
 * | ---------------------------------- | --------------- | ------ | --------- | ----------------------- |
 * | /api/cron/import-discord           | `0 16 * * *`    | 01:00  | Vercel    | vercel.json             |
 * | /api/cron/snapshot-schedule        | `50 12 * * *`   | 21:50  | Vercel    | vercel.json             |
 * | /api/cron/notify-native-schedule   | `0 * * * *`     | 毎時00 | pg_cron   | supabase/schema.sql §13 |
 *
 * Vercel Hobby plan は cron 頻度 sub-daily (= 日 1 回以下) に限定されるため、
 * 毎時発火が必要な notify-native-schedule のみ Supabase pg_cron 経由で起動。
 * pg_cron 側は `pg_net.http_get` で本 route を `Authorization: Bearer ${CRON_SECRET}`
 * 付きで叩く (`CRON_SECRET` は Supabase vault に登録、運用前提は schema.sql §13 参照)。
 *
 * notify-native-schedule route 内では `app_settings.native_schedule_discord_notify_hour`
 * (default 12 JST) と現在時刻を比較し、目標時のみ実通知。それ以外の hour は早期 return。
 * -------------------------------------------------------------------
 */
export function assertCronAuth(
  req: NextRequest,
  routeLabel: string,
): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn(`[${routeLabel}] CRON_SECRET not configured`);
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const expected = `Bearer ${secret}`;
  const headerOk =
    authHeader === expected || authHeader?.trim() === expected;

  if (!headerOk && !isVercelCron) {
    // 詳細は本体ログにのみ吐く (response body には載せない)。
    // 長さ / prefix だけで攻撃側に full secret は推測できない。
    console.warn(
      `[${routeLabel}] auth failed`,
      JSON.stringify({
        receivedHeaderLength: authHeader?.length ?? 0,
        receivedHeaderPrefix: authHeader?.slice(0, 14) ?? null,
        expectedSecretLength: secret.length,
        hasVercelCronHeader: isVercelCron,
      }),
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
