import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * タイミング攻撃耐性のある文字列比較。
 *
 * 素の `a === b` は先頭から 1 文字ずつ短絡比較するため、理論上は応答時間差
 * から secret を 1 文字ずつ推測されうる。`timingSafeEqual` は同長 Buffer 同士を
 * 定数時間で比較する。長さが異なる場合は即 false を返す (長さの差はタイミング
 * 非依存で漏れるが、secret の長さ自体は低機微なので許容)。
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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
 *   - `x-vercel-cron` ヘッダ存在 → **本番 (VERCEL_ENV='production') 以外でのみ**
 *     通過 (Dashboard "Run" / preview 検証用)。本番では Bearer を必須にする。
 *     `x-vercel-cron` はヘッダ存在のみで通るため「Vercel が外部リクエストの
 *     x-vercel-* を edge で剥がす」というプラットフォーム挙動への単一依存に
 *     なる。Vercel は `CRON_SECRET` 設定時に scheduled cron へ Bearer を自動
 *     付与する (本プロジェクトは設定済 = 未設定なら上で 503) ので、本番の 3
 *     cron は Bearer 経路で通る。非 Vercel デプロイ / 将来のプラットフォーム
 *     挙動変更で `x-vercel-cron: 1` を付けるだけの起動を防ぐための fail-safe。
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
 * | /api/cron/fflogs-sync              | `0 19 * * *`    | 04:00  | Vercel    | vercel.json             |
 * | /api/cron/notify-native-schedule   | `0 * * * *`     | 毎時00 | pg_cron   | supabase/schema.sql §13 |
 *
 * Vercel Hobby plan は cron 頻度 sub-daily (= 日 1 回以下) に限定されるため、
 * 毎時発火が必要な notify-native-schedule のみ Supabase pg_cron 経由で起動。
 * pg_cron 側は `pg_net.http_get` で本 route を `Authorization: Bearer ${CRON_SECRET}`
 * 付きで叩く (`CRON_SECRET` は Supabase vault に登録、運用前提は schema.sql §13 参照)。
 *
 * notify-native-schedule route 内では `app_settings.native_schedule_discord_notify_hour`
 * (default 12 JST) と現在時刻を比較し、目標時のみ実通知。それ以外の hour は早期 return。
 *
 * fflogs-sync route は `app_settings.fflogs_cron_enabled='false'` で skip
 * (未設定 / 'true' は実行)。OAuth token 失敗時は 200 で silent skip
 * (5xx 返すと Vercel cron retry ループに陥るため)。
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
    authHeader !== null &&
    (timingSafeStringEqual(authHeader, expected) ||
      timingSafeStringEqual(authHeader.trim(), expected));
  // x-vercel-cron ヘッダ単独通過は本番以外に限定 (Dashboard "Run" / preview
  // 検証用)。本番は Bearer 必須にしてプラットフォーム単一依存を断つ。
  const allowHeaderOnly =
    isVercelCron && process.env.VERCEL_ENV !== "production";

  if (!headerOk && !allowHeaderOnly) {
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
