/**
 * スケジュールの詳細表で、メンバー列を表の入れ物に収まるよう詰める
 * (2026-10-05、実機報告「10 月に入ってメンバー一覧が横に少し伸び、スクロール
 * バーが出た」)。
 *
 * メンバー列は最低幅 5rem (80px) で揃え、見出しの名前は 7rem で省略していた。
 * 名前の長い列は中身の幅まで広がるので、本番 (入れ物 974px) では列の合計が
 * 976px になり、2px のはみ出しで横スクロールバーが出ていた。
 *
 * 詰め方は 2 段:
 *   1. メンバー列の最低幅を、入れ物に収まる最大の値まで下げる (揃った見た目を
 *      なるべく保つ)。下限は 44px (出欠の記号の枠 1.75rem + 左右の余白)
 *   2. 下限まで下げても収まらなければ、見出しの名前を省略する上限 (既定 7rem)
 *      を下げる (省略した名前はマウスを乗せると全体が出る)。下限は 40px
 * それでも収まらないほどメンバーが多いときだけ、横スクロールに任せる。
 *
 * `@/` を import しない純モジュール (`scripts/check-fit-member-columns.mjs`)。
 */

/** メンバー列の最低幅の上限 (これまでの 5rem)。 */
export const MEMBER_COL_PREFERRED_PX = 80;
/** メンバー列の最低幅の下限 (出欠の記号の枠 1.75rem + 左右の余白)。 */
export const MEMBER_COL_FLOOR_PX = 44;
/** 見出しの名前を省略する上限の既定 (これまでの 7rem)。 */
export const MEMBER_NAME_PREFERRED_PX = 112;
/** 名前の省略の上限をこれより狭くはしない。 */
export const MEMBER_NAME_FLOOR_PX = 40;

/** 二分探索: [lo, hi] の整数で `ok` を満たす最大の値。満たさなければ null。 */
function largestFitting(lo: number, hi: number, ok: (v: number) => boolean): number | null {
  if (!ok(lo)) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * メンバー列の最低幅 m を決める。列の幅は `max(m, 中身の幅)` になるので、
 * `fixed + Σ max(m, contents[i]) <= available` を満たす最大の整数 m を
 * [floor, preferred] の中から選ぶ。floor でも収まらなければ floor を返す。
 *
 * @param available 表を入れる箱の幅 (px)
 * @param fixed     メンバー以外の列 (日程・確定) の中身の幅の合計 (px)
 * @param contents  メンバー列ごとの中身の幅 (px、左右の余白込み)
 */
export function fitMemberMinWidth(input: {
  available: number;
  fixed: number;
  contents: ReadonlyArray<number>;
  preferred?: number;
  floor?: number;
}): number {
  const preferred = input.preferred ?? MEMBER_COL_PREFERRED_PX;
  const floor = input.floor ?? MEMBER_COL_FLOOR_PX;
  if (!(input.available > 0) || input.contents.length === 0) return preferred;
  const total = (m: number) =>
    input.fixed + input.contents.reduce((sum, c) => sum + Math.max(m, c), 0);
  return largestFitting(floor, preferred, (m) => total(m) <= input.available) ?? floor;
}

/** メンバー列 1 つの測った幅。 */
export type MemberColumnWidth = {
  /** 列の中身の幅 (px、左右の余白込み。名前は既定の上限で省略した状態)。 */
  content: number;
  /** そのうち見出しの名前の幅 (px)。 */
  name: number;
};

/**
 * メンバー列の最低幅と、見出しの名前を省略する上限を決める (上の 2 段)。
 * 名前の上限を N に下げると、その列の中身は `content - max(0, name - N)` になる。
 */
export function fitMemberColumns(input: {
  available: number;
  fixed: number;
  columns: ReadonlyArray<MemberColumnWidth>;
}): { minWidth: number; nameMax: number } {
  const minWidth = fitMemberMinWidth({
    available: input.available,
    fixed: input.fixed,
    contents: input.columns.map((c) => c.content),
  });
  const total = (m: number, cap: number) =>
    input.fixed +
    input.columns.reduce((sum, c) => sum + Math.max(m, c.content - Math.max(0, c.name - cap)), 0);
  if (!(input.available > 0) || total(minWidth, MEMBER_NAME_PREFERRED_PX) <= input.available) {
    return { minWidth, nameMax: MEMBER_NAME_PREFERRED_PX };
  }
  const nameMax =
    largestFitting(MEMBER_NAME_FLOOR_PX, MEMBER_NAME_PREFERRED_PX, (cap) => total(minWidth, cap) <= input.available) ??
    MEMBER_NAME_FLOOR_PX;
  return { minWidth, nameMax };
}
