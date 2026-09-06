/**
 * 「良い / 注意 / 悪い」を表す 5 段階の色スケール (2026-09-06、調査ノート
 * 第 4 回 UI-12)。
 *
 * これまで portal 内の意味色は画面ごとに別体系だった:
 *   - 残 HP% は「討伐に近いほど暖色」の熱量色 (rose = 0% 寸前 = 良い)
 *   - 死亡数・ワイプ原因は rose = 悪い
 *   - 出欠は ○ = テーマ色 (cyan)、△ = violet、× = rose
 *   - 消化チェックは 消化済 = emerald、辞退 = amber
 * 同じ rose が「もう少しで討伐」と「死亡」の両方を指し、学習コストになって
 * いた。WoWAnalyzer の `colorForPerformance` (5 段階、良 → 悪) に倣い、
 * **良い = emerald → lime → amber → orange → rose = 悪い** の 1 本に揃える。
 *
 * 原則:
 *   - 色だけで意味を伝えない (WCAG 1.4.1)。数値 / 記号 / ラベルを必ず併記する
 *     (この module は色クラスを返すだけで、併記は呼び出し側の責務)
 *   - 7 テーマ共通の固定色 (テーマの accent は「選択中 / リンク」の役割に
 *     専念させ、意味色とは混ぜない)
 *   - 層 / フェーズの識別色 (sky → teal → violet …) は「どれか」を表す
 *     カテゴリ色で、良し悪しではないのでこのスケールの対象外
 *   - Tailwind v4 はクラス文字列を静的に走査するので、レベルごとに
 *     リテラルで書く (テンプレートで色名を合成しない)
 */

export type PerfLevel = "best" | "good" | "mid" | "warn" | "bad" | "neutral";

/** 文字色 (11px の mono 数値でも 4.5:1 を満たす -300 系)。 */
export const PERF_TEXT: Record<PerfLevel, string> = {
  best: "text-emerald-300",
  good: "text-lime-300",
  mid: "text-amber-300",
  warn: "text-orange-300",
  bad: "text-rose-300",
  neutral: "text-muted-foreground",
};

/** チップ (枠 + 薄い背景 + 文字)。出欠記号・ステータスバッジ向け。 */
export const PERF_CHIP: Record<PerfLevel, string> = {
  best: "border-emerald-400/45 bg-emerald-400/10 text-emerald-200",
  good: "border-lime-400/45 bg-lime-400/10 text-lime-200",
  mid: "border-amber-400/45 bg-amber-400/10 text-amber-200",
  warn: "border-orange-400/45 bg-orange-400/10 text-orange-200",
  bad: "border-rose-400/45 bg-rose-400/10 text-rose-200",
  neutral: "border-border/50 bg-secondary/30 text-muted-foreground",
};

/** バー / 帯の塗り。 */
export const PERF_BAR: Record<PerfLevel, string> = {
  best: "bg-emerald-400/75",
  good: "bg-lime-400/70",
  mid: "bg-amber-400/70",
  warn: "bg-orange-400/70",
  bad: "bg-rose-400/70",
  neutral: "bg-secondary/50",
};

/** バーの控えめ版 (記録更新でない日など、主張を弱めたいとき)。 */
export const PERF_BAR_SOFT: Record<PerfLevel, string> = {
  best: "bg-emerald-400/40",
  good: "bg-lime-400/40",
  mid: "bg-amber-400/40",
  warn: "bg-orange-400/40",
  bad: "bg-rose-400/40",
  neutral: "bg-secondary/40",
};

/** 日本語ラベル (title / aria 用)。 */
export const PERF_LABEL: Record<PerfLevel, string> = {
  best: "良い",
  good: "やや良い",
  mid: "ふつう",
  warn: "注意",
  bad: "悪い",
  neutral: "—",
};

/**
 * 0〜1 の達成率 (高いほど良い) → レベル。閾値は WoWAnalyzer の
 * colorForPerformance と同じ (≥1.0 / >2/3 / >1/2 / >1/3 / それ以下)。
 */
export function perfForRatio(ratio: number | null | undefined): PerfLevel {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return "neutral";
  }
  if (ratio >= 1) return "best";
  if (ratio > 2 / 3) return "good";
  if (ratio > 1 / 2) return "mid";
  if (ratio > 1 / 3) return "warn";
  return "bad";
}

/**
 * ボス残 HP% (低いほど良い) → レベル。討伐 (0%) = best。
 *   ≤ 10% = good / ≤ 30% = mid / ≤ 60% = warn / それ以上 = bad。
 * 旧「熱量色」(残りが少ないほど暖色) を置き換える。閾値は旧実装の区切り
 * (2 / 10 / 30 / 60) を踏襲し、2% 未満の区別は数値 (小数 2 桁) に任せる。
 */
export function perfForRemainingPercent(
  percent: number | null | undefined,
): PerfLevel {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return "neutral";
  }
  if (percent <= 0) return "best";
  if (percent <= 10) return "good";
  if (percent <= 30) return "mid";
  if (percent <= 60) return "warn";
  return "bad";
}

/** 到達度 (0〜100、高いほど良い) → レベル。 */
export function perfForProgress(progress: number | null | undefined): PerfLevel {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) {
    return "neutral";
  }
  return perfForRatio(Math.max(0, Math.min(100, progress)) / 100);
}

/**
 * 1 pull の PT 死亡数 (少ないほど良い) → レベル。
 *   0 = best / 1 = good / 2 = mid / 3〜4 = warn / 5 以上 = bad。
 */
export function perfForDeaths(deaths: number | null | undefined): PerfLevel {
  if (deaths === null || deaths === undefined || !Number.isFinite(deaths)) {
    return "neutral";
  }
  if (deaths <= 0) return "best";
  if (deaths === 1) return "good";
  if (deaths === 2) return "mid";
  if (deaths <= 4) return "warn";
  return "bad";
}
