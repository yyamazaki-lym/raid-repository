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
import {
  type CategoryRef,
  resolveFightCategory,
} from "@/lib/fflogs-category";

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
      remaining: number;
      fetchedViaV2: number;
      fetchedViaFallback: number;
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
export async function importFflogsReportsAction(
  text: string,
  /** 取り込みを実行したコンテンツ (2026-09-07)。未分類レポートの既定カテゴリ。 */
  categoryId?: string | null,
): Promise<
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
    importCategoryId:
      typeof categoryId === "string" && /^[0-9a-f-]{36}$/i.test(categoryId)
        ? categoryId
        : null,
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

/** 1 レポートの診断結果 (2026-09-07、FFLogs は叩かず DB だけを見る)。 */
export type FflogsReportDiag = {
  code: string;
  blocked: boolean;
  ledger: {
    ok: boolean;
    reason: string | null;
    title: string | null;
    zoneName: string | null;
    zoneId: number | null;
    categoryName: string | null;
    syncedAt: string | null;
  } | null;
  fights: {
    total: number;
    inCategory: number;
    unassigned: number;
    otherCategory: number;
    /** fight 名ごとの件数と、今の分類器がその名前から決めるカテゴリ名。 */
    names: Array<{
      name: string | null;
      count: number;
      resolvedCategoryName: string | null;
      difficulty: number | null;
      encounterId: number | null;
    }>;
  };
};

/**
 * レポート URL を貼って「portal に何が入っているか」を見る診断 (2026-09-07)。
 *
 * 実機で「URL 取り込みしても絶オメガに出ない」が続き、DB を見られない側から
 * は原因を絞れなかった。台帳 (取得できたか / zone 名 / カテゴリ) と fights
 * (どのカテゴリに何件、fight 名は何で、分類器はそれをどこに落とすか) を
 * そのまま画面に出す。FFLogs API は叩かない (読み取りのみ、admin 限定)。
 */
export async function diagnoseFflogsReportsAction(
  text: string,
  currentCategoryId: string,
): Promise<{ ok: true; reports: FflogsReportDiag[] } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  const codes = extractFflogsReportCodes(text ?? "").slice(0, 25);
  if (codes.length === 0) return { ok: false, reason: "レポート URL が見つかりませんでした" };

  const supabase = await createClient();
  const [{ data: cats }, { data: ledger }, { data: fights }, { data: blocked }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, expected_fflogs_zone_ids, fflogs_match_keywords"),
      supabase
        .from("fflogs_report_syncs")
        .select("report_code, ok, reason, title, zone_name, zone_id, category_id, synced_at")
        .in("report_code", codes),
      supabase
        .from("fflogs_fights")
        .select("report_code, category_id, name, difficulty, encounter_id")
        .in("report_code", codes),
      supabase.from("fflogs_report_blocklist").select("report_code").in("report_code", codes),
    ]);
  const categories: CategoryRef[] = (cats ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    zoneIds: (r.expected_fflogs_zone_ids as number[] | null) ?? [],
    keywords: (r.fflogs_match_keywords as string[] | null) ?? [],
  }));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const blockedSet = new Set((blocked ?? []).map((b) => b.report_code as string));
  const ledgerBy = new Map(
    (ledger ?? []).map((l) => [l.report_code as string, l as Record<string, unknown>]),
  );
  const fightsBy = new Map<string, Array<Record<string, unknown>>>();
  for (const f of (fights ?? []) as Array<Record<string, unknown>>) {
    const code = f.report_code as string;
    const list = fightsBy.get(code) ?? [];
    list.push(f);
    fightsBy.set(code, list);
  }

  const reports: FflogsReportDiag[] = codes.map((code) => {
    const l = ledgerBy.get(code);
    const rows = fightsBy.get(code) ?? [];
    const byName = new Map<
      string,
      { name: string | null; count: number; difficulty: number | null; encounterId: number | null }
    >();
    let inCategory = 0;
    let unassigned = 0;
    let otherCategory = 0;
    for (const r of rows) {
      const cid = (r.category_id as string | null) ?? null;
      if (cid === currentCategoryId) inCategory += 1;
      else if (cid === null) unassigned += 1;
      else otherCategory += 1;
      const name = (r.name as string | null) ?? null;
      const key = name ?? "";
      const cur = byName.get(key);
      if (cur) cur.count += 1;
      else
        byName.set(key, {
          name,
          count: 1,
          difficulty: typeof r.difficulty === "number" ? r.difficulty : null,
          encounterId: typeof r.encounter_id === "number" ? r.encounter_id : null,
        });
    }
    return {
      code,
      blocked: blockedSet.has(code),
      ledger: l
        ? {
            ok: l.ok === true,
            reason: (l.reason as string | null) ?? null,
            title: (l.title as string | null) ?? null,
            zoneName: (l.zone_name as string | null) ?? null,
            zoneId: typeof l.zone_id === "number" ? l.zone_id : null,
            categoryName: l.category_id ? (nameOf.get(l.category_id as string) ?? "?") : null,
            syncedAt: (l.synced_at as string | null) ?? null,
          }
        : null,
      fights: {
        total: rows.length,
        inCategory,
        unassigned,
        otherCategory,
        names: [...byName.values()]
          .sort((a, b) => b.count - a.count)
          .map((n) => {
            const cid = resolveFightCategory(categories, n.name, null, {
              encounterId: n.encounterId,
              zoneName: l ? ((l.zone_name as string | null) ?? null) : null,
            });
            return { ...n, resolvedCategoryName: cid ? (nameOf.get(cid) ?? "?") : null };
          }),
      },
    };
  });
  return { ok: true, reports };
}

/**
 * 指定レポートの pull を **すべて** このコンテンツに割り当てる (2026-09-07)。
 * 分類器で決められないレポート (Legacy zone + 想定外の fight 名など) の最終手段。
 * 台帳の代表カテゴリも合わせて更新する。FFLogs は叩かない。
 */
export async function assignFflogsReportsToCategoryAction(
  text: string,
  categoryId: string,
): Promise<{ ok: true; reports: number; fights: number } | { ok: false; reason: string }> {
  const auth = await assertAdminResult();
  if (!auth.ok) return { ok: false, reason: "ADMIN ロールが必要です" };
  if (!/^[0-9a-f-]{36}$/i.test(categoryId)) return { ok: false, reason: "カテゴリ ID が不正です" };
  const codes = extractFflogsReportCodes(text ?? "").slice(0, 25);
  if (codes.length === 0) return { ok: false, reason: "レポート URL が見つかりませんでした" };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("fflogs_fights")
    .update({ category_id: categoryId })
    .in("report_code", codes)
    .select("id");
  if (error) return { ok: false, reason: dbError("pull の割り当て", error) };
  const { error: ledgerErr } = await supabase
    .from("fflogs_report_syncs")
    .update({ category_id: categoryId })
    .in("report_code", codes);
  if (ledgerErr) console.warn("[fflogs-fights] ledger assign failed:", ledgerErr.message);
  revalidateQuietly();
  return { ok: true, reports: codes.length, fights: updated?.length ?? 0 };
}
