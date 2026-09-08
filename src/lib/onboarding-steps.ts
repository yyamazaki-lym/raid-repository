/**
 * 新規メンバーの学習パス (B-3、2026-09-08)。
 *
 * 「何から見ればいいか」を順番で示すチェックリスト。調査ノート第 1 回 B-3
 * (第 4 回 7-E に再掲) の **動画 → 散開図 → マクロ → 軽減表** を素にして、
 * portal のタブに 1 対 1 で対応させている。
 *
 * ## 順番は固定にする
 *
 * ⚠ **並べ替えや項目追加の UI は作らない。** 固定ごとに順番を変えられる
 * ようにすると「うちの順番は何が正しいのか」を決める作業が増え、**入れる前に
 * 止まる**。動画 → 図 → マクロ → 軽減表 は「全体像 → 位置 → 合図 → 担当」で
 * 依存関係の順になっていて、大半の固定に当てはまる。
 *
 * ## 自動判定はしない
 *
 * 「動画を見た」は portal からは観測できない。⚠ 観測できないものを
 * 自動で「済」にすると**見ていないのに済になる**ので、チェックは本人が
 * 手で付ける (`category_link_reads` の「見た」と同じ信頼モデル)。
 *
 * ただし **その項目の中身がまだ無いこと**は分かるので、そこは出す
 * (動画 0 本のコンテンツで「動画を見る」を促さない)。
 *
 * 検証: `node scripts/check-onboarding-steps.mjs`
 */

/** 手順 id (DB に入る値)。**変えると既存の進捗が読めなくなる。** */
export const ONBOARDING_STEP_IDS = [
  "video",
  "waymark",
  "macro",
  "mitigation",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

const STEP_SET = new Set<string>(ONBOARDING_STEP_IDS);

export function isOnboardingStepId(v: unknown): v is OnboardingStepId {
  return typeof v === "string" && STEP_SET.has(v);
}

/** 手順 → 飛び先のサブタブ (`/category/<slug>/<segment>`)。 */
export const ONBOARDING_STEP_SEGMENT: Record<OnboardingStepId, string> = {
  video: "videos",
  waymark: "macros",
  macro: "macros",
  mitigation: "mitigation",
};

export type OnboardingStepState = {
  id: OnboardingStepId;
  /** 本人が「見た」を付けているか。 */
  done: boolean;
  /**
   * その項目の中身がコンテンツに登録されているか。
   * false のときは促さない (動画 0 本で「動画を見る」を出さない)。
   */
  available: boolean;
};

export type OnboardingProgress = {
  steps: OnboardingStepState[];
  /** 中身がある手順の数 (分母)。 */
  total: number;
  /** そのうち済の数。 */
  done: number;
  /** 次にやる手順 (全部済 / 中身が無ければ null)。 */
  next: OnboardingStepId | null;
};

/**
 * 進捗を組む。
 *
 * `next` は **中身があって未済の最初の手順**。順番を示すのがこの機能の
 * 目的なので、飛ばして先の手順を勧めない。
 */
export function buildOnboardingProgress({
  doneIds,
  availability,
}: {
  doneIds: readonly string[];
  /** 手順 → 中身があるか。未指定の手順は「ある」扱い。 */
  availability: Partial<Record<OnboardingStepId, boolean>>;
}): OnboardingProgress {
  const done = new Set(doneIds);
  const steps: OnboardingStepState[] = ONBOARDING_STEP_IDS.map((id) => ({
    id,
    done: done.has(id),
    available: availability[id] !== false,
  }));
  const usable = steps.filter((s) => s.available);
  return {
    steps,
    total: usable.length,
    done: usable.filter((s) => s.done).length,
    next: usable.find((s) => !s.done)?.id ?? null,
  };
}
