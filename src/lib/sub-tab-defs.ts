import {
  Activity,
  BookOpen,
  Dice5,
  Film,
  ShieldHalf,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/**
 * コンテンツ詳細のサブタブ定義 (single source of truth)。
 *
 * 以前は `sub-tabs.tsx` / `category-switcher.tsx` / `category-list.tsx` の
 * 3 箇所に同じ配列がコピーされており、TODO #94 で「練習ログ」を追加した際に
 * sub-tabs.tsx しか更新されず、**コンテンツカードとカテゴリ切替メニューから
 * 練習ログのアイコンだけが消える** という不整合が出た。定義をここに集約して
 * 再発を防ぐ。
 *
 * 並び順 = 使用頻度。タブを増やすときは
 *   1. この配列
 *   2. `CATEGORY_TAB_IDS` (supabase/types.ts)
 *   3. `categories_default_tab_check` (supabase/schema.sql)
 * の 3 点を必ず揃えること。
 */
export type SubTabDef = {
  id: string;
  label: string;
  segment: string;
  Icon: LucideIcon;
};

export const SUB_TAB_DEFS: SubTabDef[] = [
  { id: "mitigation", label: "軽減表", segment: "mitigation", Icon: ShieldHalf },
  { id: "loot", label: "ロット管理", segment: "loot", Icon: Dice5 },
  { id: "strategy", label: "攻略情報", segment: "strategy", Icon: BookOpen },
  { id: "videos", label: "動画", segment: "videos", Icon: Film },
  { id: "macros", label: "マクロ", segment: "macros", Icon: Terminal },
  { id: "logs", label: "練習ログ", segment: "logs", Icon: Activity },
];

/** id → 既定ラベル (カテゴリ編集ダイアログのプレースホルダ等で参照)。 */
export const DEFAULT_SUB_TAB_LABELS: Record<string, string> = Object.fromEntries(
  SUB_TAB_DEFS.map((t) => [t.id, t.label]),
);
