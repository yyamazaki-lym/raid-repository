/**
 * XivGear `/fulldata` レスポンスの要約 (2026-08-30、Tier2 follow-up)。
 *
 * BiS はリンクを開かないと中身が分からず、「誰の BiS が組み終わっているか」
 * 「どの部位がまだ空か」を見るのに毎回タブを開く必要があった。API から
 * 取れる範囲で要約を作り、ポータル側に出す。
 *
 * **型は上流の実装で確認済み** (xiv-gear-planner/gear-planner の
 * `packages/xivmath/src/geartypes.ts`):
 *   - `/fulldata` は常に `SheetStatsExport` を返す (単一セットでも)
 *   - `SheetStatsExport = SheetExport & { sets: SetStatsExport[] }`
 *   - `SetExport.items` は `{ [EquipSlotKey]?: { id, materia[] } }`
 *     — **item ID しか持たない** (名前も IL も無い)。名前を出すには
 *     XIVAPI 等の別 lookup が要るため、ここでは扱わない
 *   - `SetStatsExport.computedStats` は `RawStats` を継承 (crit /
 *     determination / spellspeed / skillspeed / piety / tenacity など)
 *
 * 外部依存なしの純関数。取得は server 側 (`server/xivgear-fetch.ts`)。
 */

/** 装備スロット (上流 `EquipSlots` と同一順序)。 */
export const XIVGEAR_EQUIP_SLOTS = [
  "Weapon",
  "OffHand",
  "Head",
  "Body",
  "Hand",
  "Legs",
  "Feet",
  "Ears",
  "Neck",
  "Wrist",
  "RingLeft",
  "RingRight",
] as const;

export type XivgearEquipSlot = (typeof XIVGEAR_EQUIP_SLOTS)[number];

/** 日本語のスロット名 (未設定スロットの表示用)。 */
export const SLOT_LABEL_JA: Record<XivgearEquipSlot, string> = {
  Weapon: "武器",
  OffHand: "盾",
  Head: "頭",
  Body: "胴",
  Hand: "手",
  Legs: "脚",
  Feet: "足",
  Ears: "耳",
  Neck: "首",
  Wrist: "腕",
  RingLeft: "指輪(左)",
  RingRight: "指輪(右)",
};

/**
 * 盾を持つのはナイトだけ。他ジョブで OffHand が空なのは正常なので、
 * 「未設定」に数えない。
 */
const OFFHAND_JOBS = new Set(["PLD"]);

export type XivgearSetSummary = {
  /** セット名 (シート名ではなくセット側)。 */
  name: string;
  /** ジョブ略称 (セット個別の jobOverride があればそちら)。 */
  job: string | null;
  level: number | null;
  /** 装備が入っているスロット数。 */
  filledSlots: number;
  /** そのジョブで埋まるべきスロット数 (盾はナイトのみ)。 */
  expectedSlots: number;
  /** 未設定スロットの日本語名。 */
  missingSlots: string[];
  /** マテリアが挿さっている数 (id > 0 のもの)。 */
  materiaCount: number;
  /** 食事が設定されているか。 */
  hasFood: boolean;
  /** 主要サブステータス (0 のものは含めない)。 */
  stats: Array<{ label: string; value: number }>;
};

export type XivgearSheetSummary = {
  /** シート名。 */
  sheetName: string;
  job: string | null;
  level: number | null;
  sets: XivgearSetSummary[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** サブステの表示順と日本語名 (値が 0 のものは出さない)。 */
const STAT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "crit", label: "クリティカル" },
  { key: "determination", label: "意志力" },
  { key: "dhit", label: "ダイレクト" },
  { key: "spellspeed", label: "SS(魔法)" },
  { key: "skillspeed", label: "SS(物理)" },
  { key: "piety", label: "信仰" },
  { key: "tenacity", label: "不屈" },
];

/**
 * `/fulldata` の JSON を要約する。解釈できない形なら null
 * (呼び出し側は「取得できませんでした」を出すだけ)。
 */
export function parseXivgearFulldata(json: unknown): XivgearSheetSummary | null {
  const root = asRecord(json);
  if (!root) return null;
  const setsRaw = Array.isArray(root.sets) ? root.sets : null;
  if (!setsRaw) return null;

  const sheetJob = typeof root.job === "string" ? root.job : null;
  const sheetLevel = asNumber(root.level);

  const sets: XivgearSetSummary[] = [];
  for (const s of setsRaw) {
    const set = asRecord(s);
    if (!set) continue;
    // セパレータ行は実データではないので飛ばす。
    if (set.isSeparator === true) continue;

    const job =
      typeof set.jobOverride === "string" && set.jobOverride
        ? set.jobOverride
        : sheetJob;
    const items = asRecord(set.items) ?? {};

    let filledSlots = 0;
    let materiaCount = 0;
    const missingSlots: string[] = [];
    for (const slot of XIVGEAR_EQUIP_SLOTS) {
      // 盾はナイト以外では存在しないので、未設定に数えない。
      const slotApplies = slot !== "OffHand" || (job !== null && OFFHAND_JOBS.has(job));
      const entry = asRecord(items[slot]);
      if (entry && asNumber(entry.id) !== null) {
        filledSlots += 1;
        const materia = Array.isArray(entry.materia) ? entry.materia : [];
        for (const m of materia) {
          const mm = asRecord(m);
          const id = mm ? asNumber(mm.id) : null;
          // id = -1 は「空きスロット」を意味する (上流 TSDoc)。
          if (id !== null && id > 0) materiaCount += 1;
        }
      } else if (slotApplies) {
        missingSlots.push(SLOT_LABEL_JA[slot]);
      }
    }
    const expectedSlots = XIVGEAR_EQUIP_SLOTS.filter(
      (slot) => slot !== "OffHand" || (job !== null && OFFHAND_JOBS.has(job)),
    ).length;

    const computed = asRecord(set.computedStats);
    const stats: Array<{ label: string; value: number }> = [];
    if (computed) {
      for (const f of STAT_FIELDS) {
        const v = asNumber(computed[f.key]);
        if (v !== null && v > 0) stats.push({ label: f.label, value: v });
      }
    }

    sets.push({
      name: typeof set.name === "string" ? set.name : "",
      job,
      level: asNumber(set.level) ?? sheetLevel,
      filledSlots,
      expectedSlots,
      missingSlots,
      materiaCount,
      hasFood: asNumber(set.food) !== null,
      stats,
    });
  }

  if (sets.length === 0) return null;
  return {
    sheetName: typeof root.name === "string" ? root.name : "",
    job: sheetJob,
    level: sheetLevel,
    sets,
  };
}
