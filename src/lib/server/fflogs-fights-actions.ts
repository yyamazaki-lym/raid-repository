"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdminResult } from "./auth";
import { dbError } from "./db-error";
import { syncFflogsFights } from "./fflogs-fights";
import { httpUrlError } from "@/lib/url-validation";
import {
  extractFflogsReportCodes,
  parseFflogsReportCode,
} from "@/lib/fflogs-url";

/**
 * 練習ログ (fights) タブの書き込み系 Server Action (TODO #94)。
 * どちらも admin gate + RLS の二層。
 */

type WriteResult = { ok: true } | { ok: false; reason: string };

/** 手動同期。cron (`/api/cron/fflogs-sync`) と同じ処理を admin が即時実行する。 */
export async function syncFflogsFightsAction(): Promise<
  | {
      ok: true;
      reportsKnown: number;
      reportsFetched: number;
      fightsUpserted: number;
      failed: number;
      truncated: boolean;
      reattributed: number;
      failures: Array<{ reportCode: string; reason: string }>;
    }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  // 手動同期は「cookie を登録し直した / 公開設定を変えた」直後に押される
  // 想定なので、恒久失敗 (private) も含めて再試行する。cron は再試行しない。
  const result = await syncFflogsFights({ retryPermanentFailures: true });
  if (result.ok) revalidateQuietly();
  return result;
}

/**
 * URL 貼り付けインポート (2026-08-28)。
 *
 * unlisted レポートは一覧 API に出ない (発見できない) が、code さえ
 * 分かれば取得できる。fflogs.com のレポート一覧を見られるのは本人だけ
 * なので、そのページの URL (丸ごとコピペでも可) を貼ってもらい、portal 側で
 * code を抽出して取得チェーン (v2 → v1 → cookie) に流す。
 */
export async function importFflogsReportsAction(text: string): Promise<
  | {
      ok: true;
      codesFound: number;
      fightsUpserted: number;
      failed: number;
      reattributed: number;
      failures: Array<{ reportCode: string; reason: string }>;
    }
  | { ok: false; reason: string }
> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  const codes = extractFflogsReportCodes(text ?? "").slice(0, 25);
  if (codes.length === 0) {
    return {
      ok: false,
      reason:
        "レポート URL が見つかりませんでした — https://www.fflogs.com/reports/... を含むテキストを貼り付けてください",
    };
  }

  const result = await syncFflogsFights({
    onlyCodes: codes,
    retryPermanentFailures: true,
  });
  if (!result.ok) return result;
  revalidateQuietly();
  return {
    ok: true,
    codesFound: codes.length,
    fightsUpserted: result.fightsUpserted,
    failed: result.failed,
    reattributed: result.reattributed,
    failures: result.failures,
  };
}

/**
 * report ↔ 動画のオフセット登録 (A-2)。
 *
 * 「レポート開始時刻が動画の何秒地点か」を 1 回入れておけば、以降の全 pull の
 * 動画内時刻が計算で出る。動画の URL 自体は空でもよい (後から入れられる)。
 */
export async function setReportVideoAction(input: {
  reportCode: string;
  videoUrl: string | null;
  offsetSeconds: number;
}): Promise<WriteResult> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };

  // reportCode は UI から渡ってくるが、念のため形を検証する。
  const code = input.reportCode.trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code)) {
    return { ok: false, reason: "レポートコードが不正です" };
  }

  const rawUrl = (input.videoUrl ?? "").trim();
  if (rawUrl) {
    const err = httpUrlError(rawUrl);
    if (err) return { ok: false, reason: err };
    if (rawUrl.length > 2000) return { ok: false, reason: "URL が長すぎます" };
  }

  const offset = Math.trunc(input.offsetSeconds);
  if (!Number.isFinite(offset) || offset < -86400 || offset > 86400) {
    return { ok: false, reason: "オフセットは ±24 時間以内で指定してください" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("fflogs_report_videos").upsert(
    {
      report_code: code,
      video_url: rawUrl || null,
      offset_seconds: offset,
    },
    { onConflict: "report_code" },
  );
  if (error) return { ok: false, reason: dbError("動画オフセット保存", error) };
  revalidateQuietly();
  return { ok: true };
}

/**
 * 動画リンク (`category_links.logs_url`) から report code を引いて、
 * オフセット未設定の report に動画 URL だけ先に入れておくヘルパー。
 * UI の「この report の動画を選ぶ」用途で使う。
 */
export async function suggestVideoForReportAction(
  reportCode: string,
): Promise<{ ok: true; videoUrl: string | null } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_links")
    .select("url, logs_url")
    .eq("kind", "video")
    .not("logs_url", "is", null)
    .limit(500);
  if (error) return { ok: false, reason: dbError("動画検索", error) };
  for (const row of data ?? []) {
    if (parseFflogsReportCode(row.logs_url as string) === reportCode) {
      return { ok: true, videoUrl: (row.url as string) ?? null };
    }
  }
  return { ok: true, videoUrl: null };
}

function revalidateQuietly() {
  try {
    revalidatePath("/category", "layout");
  } catch {
    // best-effort
  }
}
