import { bisSlotsForJob } from "./bis-slots";
import type { XivgearEquipSlot } from "./xivgear-set";

/**
 * ロットの「欲しい人」行列と優先度の提案 (W-24 + W-25、2026-09-08)。
 *
 * ## 何を根拠にするか
 *
 * W-23 で入れた **BiS の部位別「取得済」チェック**だけ。アイテム名や
 * ドロップ元 (どの層で出るか) は持たない — ノートのデメリット欄が
 * 「ルールが固定ごとに多様」「Sheets との二重管理リスク」で、**ゲーム側の
 * データ表を抱えると保守が続かない**ためである。
 *
 * ⚠ **層 × 部位の対応表は作らない。** どの層で何が出るかは固定の人が
 * 知っているので、行列は **部位 × メンバー**にする。アイテムが落ちた瞬間に
 * 知りたいのは「この部位を欲しいのは誰か」であって、層の分類ではない。
 * (ユーザー指定 2026-09-08「ロット表を作らない固定向けであっても良い」に
 * 沿う形 — Sheets のロット表が無くてもこれだけで回る。)
 *
 * ## 提案止まりにする
 *
 * 並べるのは「取得済が少ない人が先」という 1 つの規則だけで、**確定する
 * ボタンは作らない**。ノートのデメリット欄が「ルールが固定ごとに多様
 * (左取り抜け / 優先制 / フリロ)」なので、順番は提案として出し、決める
 * のは人に残す。
 *
 * 検証: `node scripts/check-loot-priority.mjs`
 */

/** 1 人ぶんの入力 (BiS リンク 1 本 = 1 人 1 ジョブ)。 */
export type LootMemberInput = {
  bisLinkId: string;
  /** 表示名 (`owner_name` があればそれ、無ければリンクの label)。 */
  label: string;
  /** ジョブ略称 (`PLD` 等)。null なら 11 部位で数える。 */
  job: string | null;
  /** 取得済みの部位。 */
  obtainedSlots: readonly string[];
};

export type LootWanter = {
  bisLinkId: string;
  label: string;
  /** 取得済みの部位数 (提案の理由として画面に出す)。 */
  obtained: number;
  /** そのジョブで数える部位の総数。 */
  total: number;
  /** 1 始まりの提案順。 */
  rank: number;
};

export type LootSlotRow = {
  slot: XivgearEquipSlot;
  /** その部位を欲しい人 (提案順)。 */
  wanters: LootWanter[];
  /** その部位を既に取っている人 (表示は済マーク)。 */
  doneIds: string[];
  /** その部位を数える人数 (分母)。 */
  totalCount: number;
};

export type LootWantMatrix = {
  /** 列の並び (入力順をそのまま使う)。 */
  members: Array<{ bisLinkId: string; label: string; obtained: number; total: number }>;
  rows: LootSlotRow[];
  /** 1 部位も欲しい人が居ない (全員完成) か。 */
  allDone: boolean;
};

/**
 * 行列を組む。
 *
 * 提案順は **取得済の少ない順 → 残りの多い順 → 表示名**。
 * 「取得済が少ない人が先」は固定運用で最も広く使われている公平規則で、
 * 残りの多い順を第 2 キーにするのは、同じ取得数なら**完成が遠い人**を
 * 先にする方が全体の完成が早いため。第 3 キーの表示名は、同条件のときに
 * 並びが実行ごとに揺れないようにするためだけのもの。
 */
export function buildLootWantMatrix(
  members: readonly LootMemberInput[],
): LootWantMatrix {
  const prepared = members.map((mem) => {
    const slots = bisSlotsForJob(mem.job);
    const obtained = new Set(mem.obtainedSlots);
    // そのジョブで数えない部位が入っていても無視する (bis-slots と同じ方針)。
    const obtainedCount = slots.filter((s) => obtained.has(s)).length;
    return {
      ...mem,
      slots,
      obtained,
      obtainedCount,
      total: slots.length,
    };
  });

  // 行に出す部位は、誰かが数えている部位の和集合 (OffHand はナイトが
  // 居るときだけ行が出る)。並びは `bisSlotsForJob` の順を保つ。
  const slotOrder: XivgearEquipSlot[] = [];
  for (const p of prepared) {
    for (const s of p.slots) if (!slotOrder.includes(s)) slotOrder.push(s);
  }

  const rows: LootSlotRow[] = slotOrder.map((slot) => {
    const counted = prepared.filter((p) => p.slots.includes(slot));
    const doneIds = counted
      .filter((p) => p.obtained.has(slot))
      .map((p) => p.bisLinkId);
    const wanters = counted
      .filter((p) => !p.obtained.has(slot))
      .sort(
        (a, b) =>
          a.obtainedCount - b.obtainedCount ||
          b.total - b.obtainedCount - (a.total - a.obtainedCount) ||
          a.label.localeCompare(b.label, "ja"),
      )
      .map((p, i) => ({
        bisLinkId: p.bisLinkId,
        label: p.label,
        obtained: p.obtainedCount,
        total: p.total,
        rank: i + 1,
      }));
    return { slot, wanters, doneIds, totalCount: counted.length };
  });

  return {
    members: prepared.map((p) => ({
      bisLinkId: p.bisLinkId,
      label: p.label,
      obtained: p.obtainedCount,
      total: p.total,
    })),
    rows,
    allDone: rows.every((r) => r.wanters.length === 0),
  };
}

/**
 * セルの意味 (W-25 の 3 色セマンティクス)。
 *
 *   - `first`  … 提案順 1 番目 (最良の相手)
 *   - `other`  … 欲しいが 1 番目ではない (代替あり)
 *   - `done`   … 既に取得済
 *   - `n/a`    … そのジョブで数えない部位
 */
export type LootCellKind = "first" | "other" | "done" | "n/a";

export function lootCellKind(
  row: LootSlotRow,
  bisLinkId: string,
): LootCellKind {
  if (row.doneIds.includes(bisLinkId)) return "done";
  const w = row.wanters.find((x) => x.bisLinkId === bisLinkId);
  if (!w) return "n/a";
  return w.rank === 1 ? "first" : "other";
}
