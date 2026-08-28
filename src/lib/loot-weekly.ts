/**
 * 週制限の消化チェック (TODO #94 / A-4) の共有型。
 *
 * 「部位ごとのロット表」は従来どおり Google Sheets が正。ここで portal が
 * 持つのは **今週分を消化したかどうか** だけ — 開催前に「誰がまだ未消化か」
 * を人力で確認していた手間を消すための最小データ (調査ノート §3 A-4)。
 */

export const LOOT_WEEKLY_STATUSES = ["未消化", "消化済", "辞退"] as const;
export type LootWeeklyStatus = (typeof LOOT_WEEKLY_STATUSES)[number];

export function isLootWeeklyStatus(v: unknown): v is LootWeeklyStatus {
  return (
    typeof v === "string" &&
    (LOOT_WEEKLY_STATUSES as readonly string[]).includes(v)
  );
}

export type LootWeeklyRow = {
  id: string;
  displayName: string;
  status: LootWeeklyStatus;
  note: string | null;
  /** 閲覧者本人の行かどうか (Discord ID は client に渡さず server 側で判定)。 */
  isMe: boolean;
  updatedAt: string | null;
};

export type CategoryBisLink = {
  id: string;
  categoryId: string;
  label: string;
  url: string;
  job: string | null;
  ownerName: string | null;
  note: string | null;
  sortOrder: number;
};
