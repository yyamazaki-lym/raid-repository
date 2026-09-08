"use server";

import { createClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import { getValidFflogsOAuthToken } from "./fflogs-oauth";
import {
  parseDeathLeadUp,
  type LeadUpDeath,
} from "@/lib/logs/death-leadup";

/**
 * 死亡の直前を FFLogs から取る (W-8、2026-09-08)。
 *
 * ## 同期では取らない
 *
 * 調査ノート第 4 回 7-A W-8 のデメリット欄は **「`includeResources` で
 * 帯域大。+1 往復/死亡」**。同期に載せると、直近レポートの取り直しで
 * 毎晩この重いクエリが走る (時間予算を食って pull の取り込み自体が
 * 遅れる) ので、**押されたときだけ 1 pull 分を取りに行く**。
 *
 * 保存もしない。振り返りの最中に 1 回見る値で、溜めておく意味が薄く、
 * 「その瞬間に何がかかっていたか」を DB に持つと **個人の立ち回りの記録**
 * になってしまう (§1-F の方針と衝突する)。
 *
 * ## 軽減率の計算はしない
 *
 * かかっていた効果を名前のまま並べるだけ (`lib/logs/death-leadup.ts` の
 * docstring)。パッチごとに変わる軽減率テーブルを抱えないため。
 *
 * ## 前提
 *
 * v2 (OAuth) で読めるレポートだけ。代替経路 (v1 / cookie) で取り込んだ
 * レポートは `events` を引けないので、その旨を返す。
 */

const FFLOGS_GRAPHQL_URL = "https://www.fflogs.com/api/v2/user";
const FETCH_TIMEOUT_MS = 20_000;
/** 1 pull で読む死亡イベントの上限 (FFLogs の `limit`)。 */
const EVENT_LIMIT = 60;

export type DeathLeadUpResult =
  | { ok: true; deaths: LeadUpDeath[] }
  | { ok: false; reason: string };

export async function fetchDeathLeadUpAction(
  reportCode: string,
  fightId: number,
): Promise<DeathLeadUpResult> {
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
        "FFLogs OAuth が未接続です — 設定ダイアログから接続すると死亡の直前を読めます",
    };
  }

  // pull のレポート相対の開始 / 終了 (events の timestamp を pull 相対に
  // 直すのに使う)。保存済みの値を使うので FFLogs には聞かない。
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
  // 保存しているのは絶対時刻。events はレポート相対なので引き戻す。
  const relStart = startMs - Number(reportStartMs);
  const relEnd = endMs - Number(reportStartMs);

  const query = `query ($code: String!, $fight: Int!, $limit: Int!) {
    reportData {
      report(code: $code) {
        events(
          dataType: Deaths
          fightIDs: [$fight]
          includeResources: true
          limit: $limit
        ) {
          data
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
          report?: { events?: { data?: unknown } | null } | null;
        } | null;
      } | null;
    };
    if (json.errors?.length) {
      // private / unlisted で読めない場合もここに来る。
      return {
        ok: false,
        reason:
          json.errors[0]?.message?.slice(0, 200) ??
          "FFLogs から取得できませんでした",
      };
    }
    const deaths = parseDeathLeadUp(
      json.data?.reportData?.report?.events?.data ?? null,
      relStart,
      relEnd,
    );
    return { ok: true, deaths };
  } catch (e) {
    console.warn("[death-leadup] fetch failed:", e);
    return { ok: false, reason: "FFLogs から取得できませんでした" };
  }
}
