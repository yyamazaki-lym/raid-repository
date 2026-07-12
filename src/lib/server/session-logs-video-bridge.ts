import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FflogsLinkDetail } from "@/lib/server/fflogs";
import {
  jstYmdKey,
  resolveVideoJstYmd,
  toJstYmd,
  VIDEO_POSTED_AT_BUFFER_MS,
  type JstYmd,
} from "@/lib/video-jst-date";

/**
 * 日付登録 Logs ↔ 同日動画の橋渡し (2026-07-12)。
 *
 * 背景: FFLogs URL の保存先は2系統ある —
 *   (1) `category_links.logs_url` … 動画カードのバッジが参照
 *   (2) `schedule_past_session_logs` / `native_schedule_session_logs`
 *       … スケジュール行の Logs アイコンが参照
 * auto 同期 (fflogs.ts) は両方に書くが、日付 popover からの手動登録
 * (`addSessionLogsUrl` 系) は (2) だけに書いていたため、「日付から登録した
 * Logs が同日の動画 (バッジ) に紐づかない」ギャップがあった。本モジュール
 * が (2)→(1) の橋渡しを担う。
 *
 * 同日判定は TOP の動画紐付け表示 `buildSessionVideoLinkMap` と完全一致
 * (video-jst-date.ts の resolveVideoJstYmd を共有: タイトル日付優先 →
 * posted_at JST fallback)。
 *
 * 書込みは常に `logs_url IS NULL` の動画のみ (既存の auto/手動リンクを
 * 上書きしない)。source は 'manual' で書くため auto wipe (source='auto'
 * のみ NULL 化) に消されず、毎晩の cron 再実行でも冪等。
 */

// fflogs.ts の linkers と同型: cookie client / service role の両方を許容。
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

/** 対象日 (JST 暦日) の候補動画を取得し、同日解決された行だけ返す。 */
async function fetchSameDayVideos(
  supabase: SupabaseLike,
  parsedMs: number,
): Promise<
  | { ok: true; videos: { id: string; title: string }[] }
  | { ok: false; reason: string }
> {
  const targetKey = jstYmdKey(toJstYmd(parsedMs));
  // buildSessionVideoLinkMap と同型のプリフィルタ: 対象日 ±7d の posted_at
  // 範囲 + `posted_at IS NULL` (タイトル日付のみで解決される動画) の OR。
  // [day-7d, day+1d] にしないのは「raid 4/1・動画は 4/5 アップロードだが
  // タイトルに【2026/04/01】」のような後日アップロードを拾うため。
  const minIso = new Date(parsedMs - VIDEO_POSTED_AT_BUFFER_MS).toISOString();
  const maxIso = new Date(parsedMs + VIDEO_POSTED_AT_BUFFER_MS).toISOString();
  const { data, error } = await supabase
    .from("category_links")
    .select("id, title, posted_at")
    .eq("kind", "video")
    .is("logs_url", null)
    .or(
      `and(posted_at.gte.${minIso},posted_at.lte.${maxIso}),posted_at.is.null`,
    );
  if (error) return { ok: false, reason: error.message };
  const videos = ((data ?? []) as {
    id: string;
    title: string;
    posted_at: string | null;
  }[])
    .filter((v) => {
      const ymd = resolveVideoJstYmd(v.title, v.posted_at);
      return ymd !== null && jstYmdKey(ymd) === targetKey;
    })
    .map((v) => ({ id: v.id, title: v.title }));
  return { ok: true, videos };
}

/**
 * 手動 Logs URL を同日 (JST) の logs_url 未設定動画すべてへ設定する。
 * 同日複数動画は全件に設定 (TOP link map の「1 session : N videos」と同じ)。
 *
 * 注意 (仕様、レビュー 2026-07-12): 手動橋渡しは auto linker のような
 * コンテンツ照合 (contentMismatchPenalty) を行わず、同日の未設定動画へ
 * 無条件に URL を設定する。1 日に複数コンテンツ (例 零式 + Criterion) の
 * 動画があると 1 本の Logs URL が両方にバッジ表示される。これは「日付
 * 起点の登録」という仕様上の定義挙動で、TOP の buildSessionVideoLinkMap
 * (1 session : N videos) と一致し、toast で件数も提示される。
 */
export async function bridgeLogsUrlToSameDayVideos(
  supabase: SupabaseLike,
  parsedDateIso: string,
  url: string,
): Promise<{ ok: true; updated: number } | { ok: false; reason: string }> {
  const parsedMs = new Date(parsedDateIso).getTime();
  if (!Number.isFinite(parsedMs)) {
    return { ok: false, reason: `invalid parsed_date: ${parsedDateIso}` };
  }
  const found = await fetchSameDayVideos(supabase, parsedMs);
  if (!found.ok) return found;
  if (found.videos.length === 0) return { ok: true, updated: 0 };

  const { data: rows, error } = await supabase
    .from("category_links")
    .update({ logs_url: url, logs_url_source: "manual" })
    .in(
      "id",
      found.videos.map((v) => v.id),
    )
    // 取得と更新の間に auto/手動リンクが入った場合の lost-update 防止再ガード。
    .is("logs_url", null)
    .select("id");
  if (error) return { ok: false, reason: error.message };
  return { ok: true, updated: rows?.length ?? 0 };
}

/**
 * 対称解除: 同日動画のうち `logs_url == url` かつ `logs_url_source='manual'`
 * の行のみ NULL に戻す。auto 由来のリンク (コンテンツ照合済み) は消さない。
 * logs_url_source は既定 'manual' のまま放置 (clearAllFflogsLinks と同じ流儀)。
 *
 * 「同日 (targetKey)」でスコープするのは、動画編集ダイアログから独立に
 * 設定された同一 URL の manual リンク (別日の動画) を巻き添え解除しない
 * ための保守的な設計。bridge/dialog はどちらも source='manual' で由来を
 * 区別できないため、日付一致を橋渡し由来の proxy として使う。
 *
 * 既知の非破壊エッジ (許容、レビュー 2026-07-12): タイトルに日付が無い
 * 動画は posted_at で日付解決されるため、bridge 後に posted_at が
 * 再取得 (resolvePostedAt) で別日へずれると、この unbridge の日付判定から
 * 外れて logs_url が残る (stale バッジ)。発生条件が狭く非破壊 (実在の
 * FFLogs URL を指すだけ) で、動画編集ダイアログから 1 操作で消せる。
 * 恒久解決には橋渡し由来を示す第3の source 値 ('bridge') 導入 = CHECK
 * 制約変更が要るためコスト対効果で見送り。
 */
export async function unbridgeLogsUrlFromSameDayVideos(
  supabase: SupabaseLike,
  parsedDateIso: string,
  url: string,
): Promise<{ ok: true; updated: number } | { ok: false; reason: string }> {
  const parsedMs = new Date(parsedDateIso).getTime();
  if (!Number.isFinite(parsedMs)) {
    return { ok: false, reason: `invalid parsed_date: ${parsedDateIso}` };
  }
  const targetKey = jstYmdKey(toJstYmd(parsedMs));
  const minIso = new Date(parsedMs - VIDEO_POSTED_AT_BUFFER_MS).toISOString();
  const maxIso = new Date(parsedMs + VIDEO_POSTED_AT_BUFFER_MS).toISOString();
  const { data, error } = await supabase
    .from("category_links")
    .select("id, title, posted_at")
    .eq("kind", "video")
    .eq("logs_url", url)
    .eq("logs_url_source", "manual")
    .or(
      `and(posted_at.gte.${minIso},posted_at.lte.${maxIso}),posted_at.is.null`,
    );
  if (error) return { ok: false, reason: error.message };
  const ids = ((data ?? []) as {
    id: string;
    title: string;
    posted_at: string | null;
  }[])
    .filter((v) => {
      const ymd = resolveVideoJstYmd(v.title, v.posted_at);
      return ymd !== null && jstYmdKey(ymd) === targetKey;
    })
    .map((v) => v.id);
  if (ids.length === 0) return { ok: true, updated: 0 };

  const { data: rows, error: updErr } = await supabase
    .from("category_links")
    .update({ logs_url: null })
    .in("id", ids)
    .eq("logs_url", url)
    .eq("logs_url_source", "manual")
    .select("id");
  if (updErr) return { ok: false, reason: updErr.message };
  return { ok: true, updated: rows?.length ?? 0 };
}

/**
 * cron 第4ステップ用バックフィル: sync / native の manual session logs
 * 全件を親の parsed_date で日毎にまとめ、各日の logs_url 未設定動画へ
 * 橋渡しする。
 *
 * カバーするケース:
 *   (a) 動画が Discord 取込 (JST 01:00) で登録の翌日に入り、登録時点では
 *       橋渡し先の動画行が存在しなかった
 *   (b) 本機能導入前に登録済みの既存 manual logs のバックフィル
 *
 * 同日に複数の manual log がある場合は sync/native 横断で created_at
 * 最古の 1 URL を採用する (動画の logs_url は単一カラムのため)。
 */
export async function bridgeAllManualSessionLogsToVideos(
  supabase: SupabaseLike,
  deadlineAtMs: number,
): Promise<{
  scannedDays: number;
  updated: number;
  skippedBudget: boolean;
  details: FflogsLinkDetail[];
}> {
  const empty = { scannedDays: 0, updated: 0, details: [] as FflogsLinkDetail[] };
  if (Date.now() > deadlineAtMs) return { ...empty, skippedBudget: true };

  // 逐次 4 クエリ (数百行規模の小テーブル)。embed の型体操を避け、既存
  // linkers と同じ「全件 SELECT + in-memory join」で組む。
  // 各 SELECT の失敗は空結果で graceful degrade (warn のみ)。橋渡しは
  // best-effort で、翌晩の cron が再試行する。
  const warn = (step: string, msg: string) =>
    console.warn(`[logs-video-bridge] ${step} failed:`, msg);
  const { data: logs, error: e1 } = await supabase
    .from("schedule_past_session_logs")
    .select("raw_date, url, created_at")
    .eq("source", "manual");
  if (e1) {
    warn("manual logs select", e1.message);
    return { ...empty, skippedBudget: false };
  }
  const { data: parents, error: e2 } = await supabase
    .from("schedule_past_sessions")
    .select("raw_date, parsed_date");
  if (e2) {
    warn("past sessions select", e2.message);
    return { ...empty, skippedBudget: false };
  }
  const { data: nlogs, error: e3 } = await supabase
    .from("native_schedule_session_logs")
    .select("native_session_id, url, created_at")
    .eq("source", "manual");
  if (e3) {
    warn("native manual logs select", e3.message);
    return { ...empty, skippedBudget: false };
  }
  const { data: nparents, error: e4 } = await supabase
    .from("native_schedule_sessions")
    .select("id, parsed_date");
  if (e4) {
    warn("native sessions select", e4.message);
    return { ...empty, skippedBudget: false };
  }

  const parentByRawDate = new Map(
    ((parents ?? []) as { raw_date: string; parsed_date: string }[]).map(
      (p) => [p.raw_date, p.parsed_date],
    ),
  );
  const nativeParentById = new Map(
    ((nparents ?? []) as { id: string; parsed_date: string }[]).map((p) => [
      p.id,
      p.parsed_date,
    ]),
  );

  type ManualLog = { parsedMs: number; url: string; createdAt: string };
  const manualLogs: ManualLog[] = [];
  for (const l of (logs ?? []) as {
    raw_date: string;
    url: string;
    created_at: string;
  }[]) {
    const parsed = parentByRawDate.get(l.raw_date);
    const ms = parsed ? new Date(parsed).getTime() : NaN;
    if (Number.isFinite(ms))
      manualLogs.push({ parsedMs: ms, url: l.url, createdAt: l.created_at });
  }
  for (const l of (nlogs ?? []) as {
    native_session_id: string;
    url: string;
    created_at: string;
  }[]) {
    const parsed = nativeParentById.get(l.native_session_id);
    const ms = parsed ? new Date(parsed).getTime() : NaN;
    if (Number.isFinite(ms))
      manualLogs.push({ parsedMs: ms, url: l.url, createdAt: l.created_at });
  }
  if (manualLogs.length === 0)
    return { ...empty, skippedBudget: false };

  // 日毎に created_at 最古の 1 エントリを採用。
  const byDay = new Map<string, ManualLog>();
  for (const l of manualLogs) {
    const key = jstYmdKey(toJstYmd(l.parsedMs));
    const cur = byDay.get(key);
    if (!cur || l.createdAt < cur.createdAt) byDay.set(key, l);
  }

  // 候補動画を 1 クエリで取得 (対象日全体の min/max ±7d、logs_url IS NULL)。
  const allMs = [...byDay.values()].map((l) => l.parsedMs);
  const minIso = new Date(
    Math.min(...allMs) - VIDEO_POSTED_AT_BUFFER_MS,
  ).toISOString();
  const maxIso = new Date(
    Math.max(...allMs) + VIDEO_POSTED_AT_BUFFER_MS,
  ).toISOString();
  const { data: vids, error: e5 } = await supabase
    .from("category_links")
    .select("id, title, posted_at")
    .eq("kind", "video")
    .is("logs_url", null)
    .or(
      `and(posted_at.gte.${minIso},posted_at.lte.${maxIso}),posted_at.is.null`,
    );
  if (e5) {
    warn("candidate videos select", e5.message);
    return { ...empty, skippedBudget: false };
  }

  const videosByDay = new Map<string, { id: string; title: string; ymd: JstYmd }[]>();
  for (const v of (vids ?? []) as {
    id: string;
    title: string;
    posted_at: string | null;
  }[]) {
    const ymd = resolveVideoJstYmd(v.title, v.posted_at);
    if (!ymd) continue;
    const key = jstYmdKey(ymd);
    if (!byDay.has(key)) continue; // manual log の無い日は対象外
    const bucket = videosByDay.get(key);
    const entry = { id: v.id, title: v.title, ymd };
    if (bucket) bucket.push(entry);
    else videosByDay.set(key, [entry]);
  }

  let updated = 0;
  let skippedBudget = false;
  const details: FflogsLinkDetail[] = [];
  for (const [key, log] of byDay) {
    // D-3 (2026-07-12) の時間予算パターン: 日ループ先頭で deadline を
    // チェックし、超過したら残りは翌晩の cron に委ねる (logs_url IS NULL
    // のみ対象なので途中打ち切りでも自己修復可能)。
    if (Date.now() > deadlineAtMs) {
      skippedBudget = true;
      break;
    }
    const targets = videosByDay.get(key);
    if (!targets || targets.length === 0) continue;
    const { data: rows, error } = await supabase
      .from("category_links")
      .update({ logs_url: log.url, logs_url_source: "manual" })
      .in(
        "id",
        targets.map((t) => t.id),
      )
      .is("logs_url", null)
      .select("id");
    if (error) {
      warn(`day ${key} update`, error.message);
      continue; // 単日の失敗は他の日へ波及させない
    }
    const done = new Set(((rows ?? []) as { id: string }[]).map((r) => r.id));
    updated += done.size;
    const dayLabel = key.replace(/-/g, "/");
    for (const t of targets) {
      if (!done.has(t.id)) continue;
      details.push({
        kind: "video",
        label: t.title,
        reportTitle: "手動登録 Logs (日付連携バックフィル)",
        reportUrl: log.url,
        videoDate: dayLabel,
        reportDate: dayLabel,
      });
    }
  }
  return { scannedDays: byDay.size, updated, skippedBudget, details };
}
