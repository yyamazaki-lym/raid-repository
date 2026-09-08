"use server";

import { createClient } from "@/lib/supabase/server";
import { requireDiscordMember } from "./auth";
import {
  asDeathEvents,
  asPhaseTransitions,
  deathAbilityLabel,
  phaseAt,
  type StoredDeathEvent,
} from "@/lib/fflogs-fight-detail";
import { getLocale } from "@/lib/i18n/server";
import { attachAbilityNames } from "./xivapi-action-names";

/**
 * pull 1 本の構造化リキャップ (UI-14、2026-09-08)。
 *
 * ## なぜ行の展開時に取るのか
 *
 * 死亡イベントは既に `fflogs_fights.death_events` に入っている (W-1) が、
 * **一覧の payload には載せていない**。明細は最大 20,000 pull まで返すので、
 * 1 pull あたり数百バイトの配列を全行に付けると
 * `scripts/check-fights-payload.mjs` の gzip 予算 (300 KB) を軽く超える。
 * 展開したときだけ 1 行を引けば、一覧の重さは 1 バイトも増えない。
 *
 * ## 何を返さないか
 *
 * `death_events` は **プレイヤー名を持たない** (W-1 の設計。保存形は
 * `{t, job, ability, id, ja, en}`)。したがってこのリキャップにも名前は
 * 出ない。「誰が落ちたか」ではなく「どのジョブが何で落ちたか」を並べる。
 *
 * ## 技名は表示言語で出す (L-7、2026-09-08)
 *
 * 保存に**その言語の名前が無い pull は、ここで XIVAPI に引きに行く**。
 * 同期時に解決した ja / en は保存済みだが、それ以前に取り込んだ pull には
 * 何も入っていない。展開は「押したときだけ」なので、ここで 1 回引く方が
 * 一覧の表示を待たせずに済む。
 *
 * ⚠ 引いた結果は**保存しない**。ここは読み取り (RLS の anon クライアント)
 * で、書き戻すには service role が必要になる。保存済みデータの一括解決は
 * 設定の「技名を解決」(admin) 側に置いてある。
 */

export type PullDetailDeath = {
  /** pull 開始からの相対 ms。 */
  t: number;
  job: string | null;
  /** 致命技の表示名 (表示言語で解決できたものがあればそれ)。 */
  ability: string | null;
  /** その時刻のフェーズ (遷移が取れていれば)。 */
  phase: number | null;
  /**
   * 直前の死亡から何 ms 後か (先頭は null)。連続死亡の「まとめて落ちた」
   * を数えずに見分けられるようにするため。
   */
  sincePrev: number | null;
};

export type PullDetailResult =
  | {
      ok: true;
      deaths: PullDetailDeath[];
      /** 死亡イベントが保存されていない pull か (未取得 / kill)。 */
      missing: boolean;
    }
  | { ok: false; reason: string };

export async function fetchPullDetailAction(
  reportCode: string,
  fightId: number,
): Promise<PullDetailResult> {
  // 閲覧はメンバー限定 (練習ログ自体と同じ)。書き込みは無いので admin は不要。
  await requireDiscordMember();
  const code = (reportCode ?? "").trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(code)) {
    return { ok: false, reason: "レポートコードが不正です" };
  }
  if (!Number.isInteger(fightId) || fightId < 0) {
    return { ok: false, reason: "pull の指定が不正です" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fflogs_fights")
    .select("death_events, phase_transitions")
    .eq("report_code", code)
    .eq("fight_id", fightId)
    .maybeSingle();
  if (error) {
    return { ok: false, reason: "pull の詳細を取得できませんでした" };
  }
  if (!data) return { ok: true, deaths: [], missing: true };

  const events = asDeathEvents(
    (data as { death_events?: unknown }).death_events,
  );
  const transitions = asPhaseTransitions(
    (data as { phase_transitions?: unknown }).phase_transitions,
  );
  if (!events || events.length === 0) {
    return { ok: true, deaths: [], missing: events === null };
  }

  const sorted = [...events].sort((a, b) => a.t - b.t);
  // L-7: 表示言語の名前が欠けているぶんだけ XIVAPI に引く (in place)。
  // 失敗しても元の名前で表示は続くので、戻り値は見ない。
  const locale = await getLocale();
  await attachAbilityNames(sorted, locale);
  const deaths: PullDetailDeath[] = sorted.map(
    (e: StoredDeathEvent, i: number) => ({
      t: e.t,
      job: e.job ?? null,
      ability: deathAbilityLabel(e, locale),
      phase: phaseAt(transitions, e.t),
      sincePrev: i === 0 ? null : e.t - sorted[i - 1]!.t,
    }),
  );
  return { ok: true, deaths, missing: false };
}
