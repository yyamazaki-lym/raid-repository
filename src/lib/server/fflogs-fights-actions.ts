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
      videosBridged: number;
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
      videosBridged: number;
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
    videosBridged: result.videosBridged,
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

/**
 * 誤って取り込んだレポートを練習ログから削除する (2026-08-30 実機報告
 * 「ノーマルのものを登録してしまった際に削除できない」)。
 *
 * pull (`fflogs_fights`) と同期台帳 (`fflogs_report_syncs`) を消したうえで
 * **除外リストに登録する**。動画リンクや日付ログからそのレポートが参照され
 * 続けている限り、消すだけでは次の同期で再取得されてしまうため。
 * 除外を解いて取り込み直したくなったら、除外リストから外して再同期する。
 */
export async function deleteFflogsReportAction(
  reportCode: string,
  reason?: string,
): Promise<{ ok: true; removedFights: number } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const code = reportCode.trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code)) {
    return { ok: false, reason: "レポートコードが不正です" };
  }

  const supabase = await createClient();
  const { data: removed, error: delErr } = await supabase
    .from("fflogs_fights")
    .delete()
    .eq("report_code", code)
    .select("id");
  if (delErr) return { ok: false, reason: dbError("pull 削除", delErr) };

  // 台帳を消してから除外登録 (順序が逆だと、間に同期が走って再取得しうる)。
  const { error: ledgerErr } = await supabase
    .from("fflogs_report_syncs")
    .delete()
    .eq("report_code", code);
  if (ledgerErr) {
    console.warn("[fflogs-fights] ledger delete failed:", ledgerErr.message);
  }
  const { error: blockErr } = await supabase
    .from("fflogs_report_blocklist")
    .upsert(
      { report_code: code, reason: reason?.slice(0, 200) ?? null },
      { onConflict: "report_code" },
    );
  if (blockErr) return { ok: false, reason: dbError("除外登録", blockErr) };

  revalidateQuietly();
  return { ok: true, removedFights: removed?.length ?? 0 };
}

/** 除外を解除する (次回同期で取り込み直される)。 */
export async function unblockFflogsReportAction(
  reportCode: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const code = reportCode.trim();
  const supabase = await createClient();
  const { error } = await supabase
    .from("fflogs_report_blocklist")
    .delete()
    .eq("report_code", code);
  if (error) return { ok: false, reason: dbError("除外解除", error) };
  revalidateQuietly();
  return { ok: true };
}

/**
 * 取り込み難易度の下限を設定する (2026-08-30)。
 *
 * FFLogs の `difficulty` はコンテンツ種別で値が変わるが公開された対応表が
 * 無いため、**取り込み済みの実データを画面に出して admin に選んでもらう**
 * 方式にしている (推測した固定値でノーマル判定をすると、絶などを巻き添えに
 * 除外する恐れがある)。null で無効化。
 */
export async function setCategoryMinDifficultyAction(
  categoryId: string,
  minDifficulty: number | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (
    minDifficulty !== null &&
    (!Number.isInteger(minDifficulty) ||
      minDifficulty < 0 ||
      minDifficulty > 1000)
  ) {
    return { ok: false, reason: "難易度は 0〜1000 の整数で指定してください" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ fflogs_min_difficulty: minDifficulty })
    .eq("id", categoryId);
  if (error) return { ok: false, reason: dbError("難易度設定の保存", error) };
  revalidateQuietly();
  return { ok: true };
}
