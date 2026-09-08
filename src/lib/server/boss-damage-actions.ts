"use server";

import { createClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { getValidFflogsOAuthToken } from "./fflogs-oauth";
import {
  buildBossDamageTimeline,
  type BossDamageRow,
} from "@/lib/logs/boss-damage-timeline";

/**
 * ボスの被ダメージ時系列 (W-10 + W-9 の x 軸、2026-09-08)。
 *
 * 新層初週の軽減表づくりを短縮するための取得。押されたときだけ、選んだ
 * pull 1 本の `events(dataType: DamageTaken)` を引き、
 * `時刻 / 技名 / 対象人数 / 合計 / 最大` に畳んで返す。
 *
 * ## 同期には載せない / 保存しない
 *
 * W-8 と同じ判断。`DamageTaken` は 1 pull で数百〜千件返るので、同期に
 * 載せると毎晩の取り直しで時間予算を食う。**新層初週にしか使わない**
 * 機能なので、押されたときだけ取り、保存もしない。
 *
 * ## 軽減の判定はしない
 *
 * ⚠ 「どの技が軽減か」「軽減率は何%か」は出さない (`lib/logs/
 * boss-damage-timeline.ts` の docstring)。ゲーム側のデータ表を抱えると
 * パッチごとの保守が続かない。出すのは実測値だけ。
 *
 * ## 上限
 *
 * `limit` は 1 リクエスト 1000 件まで (FFLogs の上限)。1 pull の被弾は
 * 全体攻撃 × 8 人 + 継続ダメージで数百件になるので、**足りない場合は
 * 打ち切って画面にそう出す** — 続きを取るためのページングは入れていない
 * (軽減表の雛形に要るのは大きい技で、それは前半に出そろう)。
 */

const FFLOGS_GRAPHQL_URL = "https://www.fflogs.com/api/v2/user";
const FETCH_TIMEOUT_MS = 25_000;
const EVENT_LIMIT = 1000;
/**
 * 雛形に載せる最小の合計ダメージ。継続ダメージ (毒 / 出血) の細かい行を
 * 落とすためのもので、**軽減表に要る大きい技だけ**を残す。
 */
const MIN_TOTAL_DAMAGE = 20_000;

export type BossDamageResult =
  | {
      ok: true;
      rows: BossDamageRow[];
      /** FFLogs の返却が上限に達したか (雛形が途中までの可能性)。 */
      truncated: boolean;
    }
  | { ok: false; reason: string };

export async function fetchBossDamageTimelineAction(
  reportCode: string,
  fightId: number,
): Promise<BossDamageResult> {
  await requireDiscordMember();
  const code = (reportCode ?? "").trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code) || !Number.isInteger(fightId)) {
    return { ok: false, reason: "pull の指定が不正です" };
  }

  const token = await getValidFflogsOAuthToken();
  if (!token) {
    return {
      ok: false,
      reason:
        "FFLogs OAuth が未接続です — 設定ダイアログから接続すると軽減表の雛形を作れます",
    };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("fflogs_fights")
    .select("start_ms, end_ms, report_start_ms")
    .eq("report_code", code)
    .eq("fight_id", fightId)
    .maybeSingle();
  if (!row) return { ok: false, reason: "この pull は取り込まれていません" };
  const startMs = Number((row as { start_ms: number }).start_ms);
  const endMs = Number((row as { end_ms: number }).end_ms);
  const reportStartMs = (row as { report_start_ms: number | null })
    .report_start_ms;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    reportStartMs === null
  ) {
    return {
      ok: false,
      reason:
        "この pull はレポート開始時刻を保存できていません (同期をもう一度実行してください)",
    };
  }
  // 保存値は絶対時刻。events はレポート相対なので引き戻す (W-8 と同じ)。
  const relStart = startMs - Number(reportStartMs);
  const relEnd = endMs - Number(reportStartMs);

  const query = `query ($code: String!, $fight: Int!, $limit: Int!) {
    reportData {
      report(code: $code) {
        events(
          dataType: DamageTaken
          hostilityType: Friendlies
          fightIDs: [$fight]
          limit: $limit
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }`;

  try {
    const res = await fetch(FFLOGS_GRAPHQL_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { code, fight: fightId, limit: EVENT_LIMIT },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `FFLogs から取得できませんでした (${res.status})`,
      };
    }
    const json = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        reportData?: {
          report?: {
            events?: { data?: unknown; nextPageTimestamp?: number | null } | null;
          } | null;
        } | null;
      } | null;
    };
    if (json.errors?.length) {
      return {
        ok: false,
        reason:
          json.errors[0]?.message?.slice(0, 200) ??
          "FFLogs から取得できませんでした",
      };
    }
    const events = json.data?.reportData?.report?.events ?? null;
    const rows = buildBossDamageTimeline(
      events?.data ?? null,
      relStart,
      relEnd,
      MIN_TOTAL_DAMAGE,
    );
    return {
      ok: true,
      rows,
      truncated: (events?.nextPageTimestamp ?? null) !== null,
    };
  } catch (e) {
    console.warn("[boss-damage] fetch failed:", e);
    return { ok: false, reason: "FFLogs から取得できませんでした" };
  }
}
