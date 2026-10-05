import "server-only";
import { discordFetch } from "@/lib/server/discord-api";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAllCategoryFightRows } from "@/lib/supabase/fflogs-fights";
import { claimMarker, type MarkerClaimOps } from "@/lib/schedule/marker-claim";
import { jstYmdString } from "@/lib/jst-date";
import {
  isProgressModel,
  resolveFloorCount,
  resolveProgressModel,
} from "@/lib/content-model";
import {
  buildFloorMap,
  filterToFloorCluster,
  normalizePercentage,
  type FightRow,
} from "@/lib/fflogs-progress";
import { logsNotifyKey, parseLogsNotifyEnabled } from "@/lib/logs-notify";
import {
  formatWeeklySummaryMessage,
  isWeeklySummaryDue,
  latestCompletedRaidWeek,
  summarizeWeek,
  type RaidWeek,
} from "@/lib/logs-weekly-summary";

/**
 * 練習ログの週のまとめ (2026-10-05、C-4)。集計と文面は純関数
 * (`src/lib/logs-weekly-summary.ts`) 側。
 *
 * `/api/cron/fflogs-sync` の最後に呼ばれ、
 *   1. 週のまとめが ON か / 今日が送ってよい日 (火〜木) か / その週を送ったか
 *   2. その週に pull があるカテゴリを探す
 *   3. 送る前に印 (送った週の開始日) を取る (`claimMarker`)
 *   4. カテゴリごとに 1 通ずつ投稿する
 * を行う。設定画面のプレビュー (`previewWeeklyLogsSummary`) は 2 と 4 の
 * 文面づくりだけを使い、印も投稿も触らない。
 */

/** 送った週の開始日 (`YYYY-MM-DD`) を置く `app_settings` のキー。 */
export const WEEKLY_SUMMARY_LAST_SENT_KEY = "logs_weekly_summary_last_week";
/** 通知先チャンネル (native スケジュール通知 / 練習ログの通知と共用)。 */
const NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";

type Db = ReturnType<typeof createSupabaseServiceRoleClient>;

export type WeeklySummaryMessage = {
  categoryId: string;
  categoryName: string;
  content: string;
};

export type WeeklySummaryRunResult =
  | {
      sent: true;
      week: RaidWeek;
      posted: number;
      failed: number;
      /** 失敗の理由 (最初の 1 件だけ)。 */
      reason?: string;
    }
  | {
      sent: false;
      /** 英語の短いコード (cron の応答 JSON に載せる)。 */
      skipped:
        | "disabled"
        | "not-due"
        | "already-sent"
        | "no-practice"
        | "no-channel"
        | "no-time"
        | "error";
      week?: RaidWeek;
      reason?: string;
    };

/**
 * cron から呼ぶ。`deadlineAtMs` を過ぎたら新しいカテゴリの読み取り・投稿を
 * 始めない (残りは送れないまま印だけ付く — 週のまとめは取りこぼしても次の週に
 * 響かないので、二重送信を避ける方を取る)。
 */
export async function runWeeklyLogsSummary(input: {
  now: Date;
  baseUrl: string | null;
  deadlineAtMs: number;
}): Promise<WeeklySummaryRunResult> {
  try {
    const db = createSupabaseServiceRoleClient();
    const settings = await readSettings(db, [
      logsNotifyKey("weeklySummary"),
      WEEKLY_SUMMARY_LAST_SENT_KEY,
      NOTIFY_CHANNEL_KEY,
    ]);
    if (!parseLogsNotifyEnabled(settings.get(logsNotifyKey("weeklySummary")))) {
      return { sent: false, skipped: "disabled" };
    }
    const today = jstYmdString(input.now);
    if (!isWeeklySummaryDue(today)) return { sent: false, skipped: "not-due" };
    const week = latestCompletedRaidWeek(today);
    if ((settings.get(WEEKLY_SUMMARY_LAST_SENT_KEY) ?? "") === week.start) {
      return { sent: false, skipped: "already-sent", week };
    }

    const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
    const channelId = (settings.get(NOTIFY_CHANNEL_KEY) ?? "").trim();
    if (!botToken || !channelId) {
      // 印は取らない (設定を直せば水・木の同期で送れる)。
      return {
        sent: false,
        skipped: "no-channel",
        week,
        reason: botToken ? "通知先チャンネル ID 未設定" : "DISCORD_BOT_TOKEN 未設定",
      };
    }
    if (Date.now() >= input.deadlineAtMs) {
      return { sent: false, skipped: "no-time", week };
    }

    const active = await categoriesPracticedIn(db, week);
    // 練習が無い週も印を付ける (同じ週を水・木にもう一度探さない)。
    if (!(await claimMarker(weeklyMarkerOps(db, week.start)))) {
      return { sent: false, skipped: "already-sent", week };
    }
    if (active.length === 0) return { sent: false, skipped: "no-practice", week };

    let posted = 0;
    let failed = 0;
    let reason: string | undefined;
    for (const category of active) {
      if (Date.now() >= input.deadlineAtMs) {
        failed += 1;
        reason ??= "時間切れ";
        continue;
      }
      try {
        const message = await buildCategoryMessage(db, category, week, input.baseUrl);
        if (!message) continue;
        const res = await postToDiscord({ botToken, channelId, content: message.content });
        if (res.ok) posted += 1;
        else {
          failed += 1;
          reason ??= res.reason;
        }
      } catch (e) {
        failed += 1;
        reason ??= e instanceof Error ? e.message : String(e);
        console.warn("[logs-weekly-summary] category failed:", category.id, e);
      }
    }
    return { sent: true, week, posted, failed, ...(reason ? { reason } : {}) };
  } catch (e) {
    console.warn("[logs-weekly-summary] failed:", e);
    return { sent: false, skipped: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 設定画面のプレビュー。直近に終わった週の文面を作るだけで、印も投稿も
 * 触らない (ON/OFF や送ってよい日にも関係なく作る)。
 */
export async function previewWeeklyLogsSummary(input: {
  now: Date;
  baseUrl: string | null;
}): Promise<{ week: RaidWeek; messages: WeeklySummaryMessage[] }> {
  const db = createSupabaseServiceRoleClient();
  const week = latestCompletedRaidWeek(jstYmdString(input.now));
  const active = await categoriesPracticedIn(db, week);
  const messages: WeeklySummaryMessage[] = [];
  for (const category of active) {
    const message = await buildCategoryMessage(db, category, week, input.baseUrl);
    if (message) messages.push(message);
  }
  return { week, messages };
}

async function readSettings(db: Db, keys: string[]): Promise<Map<string, string | null>> {
  const { data, error } = await db.from("app_settings").select("key, value").in("key", keys);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as Array<{ key: string; value: string | null }>).map((r) => [r.key, r.value]),
  );
}

type CategoryMeta = {
  id: string;
  name: string;
  slug: string | null;
  progressModel: string | null;
};

/** その週に pull があるカテゴリ (カテゴリの並び順)。 */
async function categoriesPracticedIn(db: Db, week: RaidWeek): Promise<CategoryMeta[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, slug, progress_model, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  const categories = (data ?? []) as Array<{
    id: string;
    name: string;
    slug: string | null;
    progress_model: string | null;
  }>;
  const counts = await Promise.all(
    categories.map((c) =>
      db
        .from("fflogs_fights")
        .select("fight_id", { count: "exact", head: true })
        .eq("category_id", c.id)
        .gte("session_date", week.start)
        .lte("session_date", week.end),
    ),
  );
  return categories
    .filter((_, i) => {
      const res = counts[i]!;
      if (res.error) throw new Error(res.error.message);
      return (res.count ?? 0) > 0;
    })
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, progressModel: c.progress_model }));
}

/** 集計に要る列だけ読む (明細の表示用の重い列は読まない)。 */
const FIGHT_COLUMNS =
  "report_code, fight_id, session_date, kill, fight_percentage, last_phase, encounter_id, deaths, start_ms, end_ms";

async function buildCategoryMessage(
  db: Db,
  category: CategoryMeta,
  week: RaidWeek,
  baseUrl: string | null,
): Promise<WeeklySummaryMessage | null> {
  const paged = await fetchAllCategoryFightRows(db, FIGHT_COLUMNS, category.id);
  if (!paged) throw new Error("練習ログを読めませんでした");
  const fights: FightRow[] = paged.rows.map((r) => ({
    reportCode: String(r.report_code),
    fightId: Number(r.fight_id),
    sessionDate: (r.session_date as string | null) ?? null,
    name: null,
    kill: r.kill === true,
    fightPercentage: normalizePercentage(numberOrNull(r.fight_percentage)),
    lastPhase: numberOrNull(r.last_phase),
    encounterId: numberOrNull(r.encounter_id),
    difficulty: null,
    partyDps: null,
    deaths: numberOrNull(r.deaths),
    wipe: null,
    phases: null,
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    reportStartMs: null,
  }));
  // 練習ログの画面 (`logs-view.tsx`) と同じ層 / フェーズの決め方。
  const model = isProgressModel(category.progressModel) ? category.progressModel : "auto";
  const phaseModel = resolveProgressModel(model, category.name) === "phases";
  const floors = phaseModel
    ? null
    : buildFloorMap(fights, resolveFloorCount(model, category.name), "ja");
  const tierFights = filterToFloorCluster(fights, floors);
  const summary = summarizeWeek(tierFights, week, floors, phaseModel, "ja");
  if (!summary) return null;
  const url =
    baseUrl && category.slug
      ? `${baseUrl.replace(/\/+$/, "")}/category/${encodeURIComponent(category.slug)}/logs`
      : null;
  return {
    categoryId: category.id,
    categoryName: category.name,
    content: formatWeeklySummaryMessage({
      categoryName: category.name,
      summary,
      floors,
      phaseModel,
      url,
    }),
  };
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `claimMarker` に渡す 3 段の条件付き書き込み (`app_settings` の 1 行)。
 * 出欠の催促 (`attendance-reminder.ts`) と同じ形。
 */
function weeklyMarkerOps(db: Db, marker: string): MarkerClaimOps {
  const touched = (res: { data: unknown[] | null; error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
    return (res.data?.length ?? 0) > 0;
  };
  return {
    replaceDifferent: async () =>
      touched(
        await db
          .from("app_settings")
          .update({ value: marker })
          .eq("key", WEEKLY_SUMMARY_LAST_SENT_KEY)
          .neq("value", marker)
          .select("key"),
      ),
    replaceNull: async () =>
      touched(
        await db
          .from("app_settings")
          .update({ value: marker })
          .eq("key", WEEKLY_SUMMARY_LAST_SENT_KEY)
          .is("value", null)
          .select("key"),
      ),
    insertIfAbsent: async () =>
      touched(
        await db
          .from("app_settings")
          .upsert(
            { key: WEEKLY_SUMMARY_LAST_SENT_KEY, value: marker },
            { onConflict: "key", ignoreDuplicates: true },
          )
          .select("key"),
      ),
  };
}

/** メンションは一切飛ばさない (`parse: []`)。練習ログの通知と同じ。 */
async function postToDiscord(input: {
  botToken: string;
  channelId: string;
  content: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await discordFetch(
      `https://discord.com/api/v10/channels/${input.channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${input.botToken}`,
          "Content-Type": "application/json",
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        body: JSON.stringify({ content: input.content, allowed_mentions: { parse: [] } }),
        timeoutMs: 15000,
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `discord ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
