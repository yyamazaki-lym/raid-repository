import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { fetchAppSettings } from "@/lib/supabase/app-settings";
import {
  LOGS_NOTIFY_KINDS,
  detectLogsEvents,
  formatLogsNotifyMessage,
  logsNotifyKey,
  parseLogsNotifyEnabled,
  type LogsEvent,
  type LogsNotifyKind,
  type LogsSnapshot,
} from "@/lib/logs-notify";

/**
 * 練習ログのイベント通知 (W-35)。2026-09-07。
 *
 * 同期の最後に呼ばれ、カテゴリごとに
 *   1. いまの到達度を `fflogs_fights` から出す
 *   2. 前回通知時のスナップショット (`fflogs_notify_state`) と比べる
 *   3. 種類ごとの ON/OFF を見て Discord に流す
 *   4. スナップショットを更新する
 * を行う。判定そのものは純関数 (`src/lib/logs-notify.ts`) 側。
 *
 * **通知は全部既定 OFF**。通知過多が調査ノート第 4 回 W-35 のデメリット欄
 * そのものなので、必要なものだけ管理者が ON にする。
 *
 * 通知先チャンネルは native スケジュール通知と同じ設定を使い回す
 * (通知先を 2 つ持たせると設定が増えるだけで、実運用では同じ ch に流す)。
 */

/** 通知先チャンネル (native スケジュール通知と共用)。 */
const NOTIFY_CHANNEL_KEY = "native_schedule_discord_notify_channel_id";

export type LogsNotifyResult = {
  /** 実際に投稿したメッセージ数。 */
  posted: number;
  /** イベントはあったが設定 OFF / 送信不能で送らなかった数。 */
  skipped: number;
  /** 送信に失敗した理由 (最初の 1 件だけ)。 */
  reason?: string;
};

/**
 * 同期後の通知。`categoryIds` は今回の同期で pull が入ったカテゴリ。
 *
 * 1 カテゴリでも失敗しても他は続行する — 通知は同期の付随処理で、ここで
 * 例外を投げると同期全体が失敗扱いになってしまう。
 */
export async function notifyLogsEvents(input: {
  /** カテゴリ ID → そのカテゴリで新しく取り込んだレポート数。 */
  newReportsByCategory: ReadonlyMap<string, number>;
  /** 練習ログの絶対 URL を組む (無ければ URL を付けない)。 */
  baseUrl?: string | null;
}): Promise<LogsNotifyResult> {
  const result: LogsNotifyResult = { posted: 0, skipped: 0 };
  if (input.newReportsByCategory.size === 0) return result;

  // 種類ごとの ON/OFF を 1 回で読む。全部 OFF なら DB も Discord も触らない。
  const keys = LOGS_NOTIFY_KINDS.map(logsNotifyKey);
  const settings = await fetchAppSettings([...keys, NOTIFY_CHANNEL_KEY]);
  const enabled = new Map<LogsNotifyKind, boolean>(
    LOGS_NOTIFY_KINDS.map((k) => [
      k,
      parseLogsNotifyEnabled(settings[logsNotifyKey(k)]),
    ]),
  );
  if (![...enabled.values()].some(Boolean)) return result;

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = (settings[NOTIFY_CHANNEL_KEY] ?? "").trim();
  const canPost = Boolean(botToken && channelId);

  const db = createSupabaseServiceRoleClient();
  for (const [categoryId, newReports] of input.newReportsByCategory) {
    try {
      const [snapshot, prev, meta] = await Promise.all([
        readSnapshot(db, categoryId),
        readNotifyState(db, categoryId),
        readCategoryMeta(db, categoryId),
      ]);
      if (!snapshot || !meta) continue;

      const all = detectLogsEvents(prev, snapshot, newReports);
      // スナップショットは通知の可否に関係なく必ず進める。OFF の間に起きた
      // 更新を溜めておいて ON にした瞬間に全部飛ばす、という挙動を避ける。
      await writeNotifyState(db, categoryId, snapshot);

      const events = all.filter((e) => enabled.get(e.kind) === true);
      if (events.length === 0) continue;
      if (!canPost) {
        result.skipped += 1;
        result.reason ??= botToken
          ? "通知先チャンネル ID 未設定"
          : "DISCORD_BOT_TOKEN 未設定";
        continue;
      }

      const url =
        input.baseUrl && meta.slug
          ? `${input.baseUrl.replace(/\/+$/, "")}/category/${encodeURIComponent(meta.slug)}/logs`
          : null;
      const content = formatLogsNotifyMessage({
        categoryName: meta.name,
        events,
        url,
      });
      const posted = await postToDiscord({
        botToken: botToken!,
        channelId,
        content,
      });
      if (posted.ok) {
        result.posted += 1;
      } else {
        result.skipped += 1;
        result.reason ??= posted.reason;
      }
    } catch (e) {
      result.skipped += 1;
      result.reason ??= e instanceof Error ? e.message : String(e);
      console.warn("[logs-notify] category failed:", categoryId, e);
    }
  }
  return result;
}

type Db = ReturnType<typeof createSupabaseServiceRoleClient>;

/**
 * いまの到達度。最深フェーズは `last_phase` の最大、残 HP% は**その最深
 * フェーズの pull だけ**の最小を採る。
 *
 * フェーズを絞らずに最小の残 HP% を採ると、浅いフェーズで粘った pull
 * (P2 で 1% など) が「ベスト」になってしまい、フェーズが進んでも
 * 「後退」と判定される。
 *
 * `last_phase` が 1 つも取れていないカテゴリ (零式で層情報だけの古いログ)
 * では最深フェーズが null になり、残 HP% は全 pull の最小になる。この場合
 * 「フェーズが進んだ」判定は起きず、残 HP% の更新だけが通知される。
 */
async function readSnapshot(
  db: Db,
  categoryId: string,
): Promise<LogsSnapshot | null> {
  const [phaseRes, clearRes] = await Promise.all([
    db
      .from("fflogs_fights")
      .select("last_phase")
      .eq("category_id", categoryId)
      .not("last_phase", "is", null)
      .order("last_phase", { ascending: false })
      .limit(1),
    db
      .from("fflogs_fights")
      .select("report_code", { count: "exact", head: true })
      .eq("category_id", categoryId)
      .eq("kill", true),
  ]);
  if (phaseRes.error || clearRes.error) {
    console.warn(
      "[logs-notify] snapshot read failed:",
      phaseRes.error?.message ?? clearRes.error?.message,
    );
    return null;
  }
  const bestPhase =
    ((phaseRes.data ?? []) as Array<{ last_phase: number | null }>)[0]
      ?.last_phase ?? null;

  let pctQuery = db
    .from("fflogs_fights")
    .select("fight_percentage")
    .eq("category_id", categoryId)
    .not("fight_percentage", "is", null)
    .order("fight_percentage", { ascending: true })
    .limit(1);
  if (bestPhase !== null) pctQuery = pctQuery.eq("last_phase", bestPhase);
  const pctRes = await pctQuery;
  if (pctRes.error) {
    console.warn("[logs-notify] percentage read failed:", pctRes.error.message);
    return null;
  }
  const raw =
    ((pctRes.data ?? []) as Array<{ fight_percentage: number | null }>)[0]
      ?.fight_percentage ?? null;
  // 100 倍値で入っている環境があるので読み出し側と同じ正規化をかける。
  const bestPercentage =
    raw === null ? null : raw > 100 ? Math.min(100, raw / 100) : raw;

  return {
    bestPhase,
    bestPercentage,
    hasClear: (clearRes.count ?? 0) > 0,
  };
}

async function readNotifyState(
  db: Db,
  categoryId: string,
): Promise<LogsSnapshot | null> {
  const { data, error } = await db
    .from("fflogs_notify_state")
    .select("best_phase, best_percentage, has_clear")
    .eq("category_id", categoryId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    best_phase: number | null;
    best_percentage: number | null;
    has_clear: boolean | null;
  };
  return {
    bestPhase: row.best_phase ?? null,
    bestPercentage: row.best_percentage === null ? null : Number(row.best_percentage),
    hasClear: row.has_clear === true,
  };
}

async function writeNotifyState(
  db: Db,
  categoryId: string,
  snapshot: LogsSnapshot,
): Promise<void> {
  const { error } = await db.from("fflogs_notify_state").upsert(
    {
      category_id: categoryId,
      best_phase: snapshot.bestPhase,
      best_percentage:
        snapshot.bestPercentage === null
          ? null
          : Math.round(snapshot.bestPercentage * 1000) / 1000,
      has_clear: snapshot.hasClear,
    },
    { onConflict: "category_id" },
  );
  if (error) {
    console.warn("[logs-notify] state write failed:", error.message);
  }
}

async function readCategoryMeta(
  db: Db,
  categoryId: string,
): Promise<{ name: string; slug: string | null } | null> {
  const { data, error } = await db
    .from("categories")
    .select("name, slug")
    .eq("id", categoryId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { name: string; slug: string | null };
  return { name: row.name, slug: row.slug ?? null };
}

/**
 * Discord へ投稿する。**メンションは一切飛ばさない** (`parse: []`) —
 * 練習ログのイベントは「見に来る動機」を作るのが目的で、全員を叩き起こす
 * ものではない。催促 (attendance-reminder) とは性質が違う。
 */
async function postToDiscord(input: {
  botToken: string;
  channelId: string;
  content: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${input.channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${input.botToken}`,
          "Content-Type": "application/json",
          "User-Agent": "RaidRepositoryBot/0.1",
        },
        body: JSON.stringify({
          content: input.content,
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(15000),
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

export type { LogsEvent };
