import {
  asPhaseTransitions,
  firstPhaseReaches,
  phaseSpans,
  phaseTimeTotals,
  type PhaseFirstReach,
  type PhaseSpan,
  type PhaseTimeTotal,
} from "./fflogs-fight-detail";

/**
 * 取得済みの行からフェーズ滞在時間を集計する (2026-09-09)。
 *
 * ## なぜ DB 層から分けたのか
 *
 * ⚠ **`@/` エイリアスも Supabase も import しない。** 相対 import だけなので
 * `scripts/check-fflogs-phase-totals.mjs` が単体でコンパイルして走らせられる
 * (エイリアス import があると単体 tsc で解決できず検査から呼べない)。
 * 行を取ってくるのは `supabase/fflogs-fights.ts` の仕事で、ここは集計だけ。
 */

/** 行の中で見る列だけを写した最小の型 (jsonb は unknown で受ける)。 */
export type PhaseTotalsRow = {
  start_ms?: unknown;
  end_ms?: unknown;
  phase_transitions?: unknown;
  last_phase?: unknown;
  session_date?: unknown;
};

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type PhaseTotalsResult = {
  totals: PhaseTimeTotal[];
  pulls: number;
  firstReach: PhaseFirstReach[];
};

/**
 * 取得済みの行からフェーズ滞在時間を集計する (2026-09-09)。
 *
 * ⚠ **行を読み直さない。** 以前は `fetchCategoryFights` と
 * `fetchCategoryPhaseTotals` が **同じ category_id / 同じ並び / 同じページング
 * で `fflogs_fights` を 2 回フルスキャン**していた (フェーズ集計が使う列は
 * 明細側の列に完全に含まれる)。実機の絶竜詩 1047 pull で 4 クエリ /
 * 約 2,100 行の転送になっていたので、明細の行から集計する形に寄せた。
 *
 * 母数の定義は変えない: `pulls` は**区間が取れた pull 数**で、フェーズ遷移が
 * 保存されていない pull (古い同期分) は数えない。`firstReach` は遷移が無くても
 * `last_phase` があれば数えるので、pull 数とは一致しない。
 */
export function phaseTotalsFromRows(
  rows: ReadonlyArray<PhaseTotalsRow>,
): PhaseTotalsResult | null {
  const spansList: Array<PhaseSpan[] | null> = [];
  const reaches: Array<{
    startMs: number;
    durationMs: number;
    reachedPhase: number | null;
    date: string | null;
  }> = [];
  for (const r of rows) {
    const startMs = Number(r.start_ms);
    const endMs = Number(r.end_ms);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const durationMs = Math.max(0, endMs - startMs);
    const transitions = asPhaseTransitions(r.phase_transitions);
    if (transitions !== null) spansList.push(phaseSpans(transitions, durationMs));
    // 到達フェーズ: last_phase が基本。遷移が取れていればその最大 ID とも
    // 突き合わせる (片方しか無いレポートがあるため)。
    const lastPhase = numberOrNull(r.last_phase);
    const maxTransition =
      transitions && transitions.length > 0
        ? Math.max(...transitions.map((t) => t.id))
        : null;
    const reachedPhase =
      lastPhase === null && maxTransition === null
        ? null
        : Math.max(lastPhase ?? 0, maxTransition ?? 0);
    reaches.push({
      startMs,
      durationMs,
      reachedPhase,
      date: typeof r.session_date === "string" ? r.session_date : null,
    });
  }
  const totals = phaseTimeTotals(spansList);
  if (totals.length === 0) return null;
  return {
    totals,
    pulls: spansList.filter((s) => s !== null).length,
    firstReach: firstPhaseReaches(reaches),
  };
}
