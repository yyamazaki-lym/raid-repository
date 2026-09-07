/**
 * BiS の部位別「取得済」進捗 (W-23、2026-09-07)。
 *
 * 「消化週の残り目標が一目で分かる」ようにするための純関数。持つのは
 * **部位 × 取得済** だけで、部位ごとのアイテム名やソースは Google Sheets の
 * ロット表が正 (二重管理にしない — 調査ノート第 4 回 W-23 のデメリット欄)。
 *
 * 検証: `node scripts/check-bis-slots.mjs`
 */

import {
  SLOT_LABEL_JA,
  XIVGEAR_EQUIP_SLOTS,
  type XivgearEquipSlot,
} from "./xivgear-set";

/**
 * 盾を装備するのはナイトだけ。他ジョブで OffHand を数えると分母が
 * 12 になり「11/12 で完成」になってしまう (`xivgear-set.ts` と同じ判断)。
 */
const OFFHAND_JOBS = new Set(["PLD"]);

/**
 * そのジョブで数える部位。ジョブ不明 (null) のときは **11 部位**
 * (OffHand を除く) にする — 大半のジョブがそうで、分母を大きく見せる方が
 * 「まだ埋まっていない」と誤認させるため。
 */
export function bisSlotsForJob(
  job: string | null | undefined,
): XivgearEquipSlot[] {
  const usesOffHand = job !== null && job !== undefined && OFFHAND_JOBS.has(job.toUpperCase());
  return XIVGEAR_EQUIP_SLOTS.filter((s) => s !== "OffHand" || usesOffHand);
}

/** 部位の日本語ラベル (英語ロケールは略称をそのまま出す)。 */
export function bisSlotLabel(
  slot: XivgearEquipSlot,
  locale: "ja" | "en" = "ja",
): string {
  if (locale === "en") return slot;
  return SLOT_LABEL_JA[slot];
}

export type BisProgress = {
  /** 取得済みの部位数。 */
  obtained: number;
  /** 数える部位の総数 (ジョブによって 11 or 12)。 */
  total: number;
  /** 0-100 の百分率 (総数 0 なら 0)。 */
  percent: number;
  /** まだ取得していない部位。 */
  remaining: XivgearEquipSlot[];
};

/**
 * 取得済み集合から進捗を出す。
 *
 * `obtainedSlots` に**そのジョブで数えない部位**が入っていても無視する
 * (ジョブを後から変えたときに「12/11 取得」にならないように)。
 */
export function bisProgress(
  job: string | null | undefined,
  obtainedSlots: ReadonlyArray<string>,
): BisProgress {
  const slots = bisSlotsForJob(job);
  const set = new Set(obtainedSlots);
  const remaining = slots.filter((s) => !set.has(s));
  const obtained = slots.length - remaining.length;
  return {
    obtained,
    total: slots.length,
    percent: slots.length === 0 ? 0 : Math.round((obtained / slots.length) * 100),
    remaining,
  };
}

/**
 * 進捗バッジの配色。5 段階にはせず 3 段階 — BiS は「完成した / だいぶ
 * 埋まった / まだ」の 3 状態しか運用上意味がない。
 */
export function bisProgressToneClass(p: BisProgress): string {
  if (p.total === 0) return "border-border/50 text-muted-foreground";
  if (p.obtained >= p.total) {
    return "border-emerald-400/45 bg-emerald-400/10 text-emerald-200";
  }
  if (p.percent >= 50) {
    return "border-amber-400/45 bg-amber-400/10 text-amber-200";
  }
  return "border-border/50 bg-secondary/30 text-muted-foreground";
}
