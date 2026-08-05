import type { Attendance } from "@/lib/schedule/next-session";

/**
 * 出欠記号の UI 表現 (色 tone / 日本語ラベル / 凡例構築)。schedule-list.tsx
 * の `SessionRow` (tone 計算) と `Legend` (凡例) の双方が使うため、循環 import
 * を避けて lib に切り出した (C-5)。
 */

// 標準 5 種以外 (例: 昼 / 夜 / 全 など character-sheets 側のカスタム
// ラベル) に当てるフォールバック tone。amber 系で「未知だが値が入って
// いる」ことが視認できるように。TODO #60。
export const ATT_TONE_FALLBACK =
  "text-amber-200 bg-amber-200/10 border-amber-200/30";

export const ATT_TONE: Record<string, string> = {
  "◯": "text-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 border-[var(--neon-cyan)]/30",
  // sync (character-sheets) は ◯ (U+25EF)、native の既定値 (native-fetch.ts)
  // は ○ (U+25CB) と、経路で文字が異なる。既存 DB に両方が保存されうるため
  // どちらのキーも同じ表現に解決する (片方だけだと native 既定構成で凡例
  // ラベルが消え、tone も amber fallback に落ちる)。
  "○": "text-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 border-[var(--neon-cyan)]/30",
  "⏰": "text-amber-300 bg-amber-300/10 border-amber-300/30",
  "△": "text-[var(--neon-violet)] bg-[var(--neon-violet)]/10 border-[var(--neon-violet)]/30",
  "×": "text-rose-400 bg-rose-400/10 border-rose-400/30",
  "－": "text-muted-foreground bg-secondary/30 border-border/50",
  // character-sheets 側のカスタムラベル (TODO #62) — 既知のものは
  // amber fallback と同色で固定マッピング、辞書外は ?? で同 fallback
  // に落ちる。色を分けないのは「× / 標準 5 種に対する派生」という
  // 位置付けを視覚的に揃えるため。
  "全": ATT_TONE_FALLBACK,
  "昼": ATT_TONE_FALLBACK,
  "夜": ATT_TONE_FALLBACK,
  "早": ATT_TONE_FALLBACK,
};

/**
 * 凡例ラベル辞書。`/schedule/edit` 側には記号のみで日本語説明が無い
 * ため portal で持つ。マッピング外は説明 null (記号のみ表示)。
 */
export const ATT_LABEL_DICT: Record<string, string> = {
  "◯": "参加可",
  // ○ (U+25CB) は native 既定値の同義記号 (ATT_TONE の note 参照)。
  "○": "参加可",
  "⏰": "遅刻",
  "△": "未定",
  "×": "不可",
  "－": "未回答",
  "全": "全日参加可",
  "昼": "昼参加可",
  "夜": "夜参加可",
  "早": "早朝参加可",
};

/**
 * 凡例エントリを構築。`/schedule/edit` の `choiceValues` 由来の選択肢
 * を先頭に並べ、末尾に固定で `×` `－` を追加。choices が空 (取得失敗)
 * のときは標準 5 種 (◯⏰△×－) にフォールバック。
 */
export function buildAttendanceLegend(
  choices: readonly string[],
): { symbol: Attendance; label: string | null }[] {
  const filtered = choices.filter((c) => c !== "×" && c !== "－" && c !== "");
  const ordered =
    filtered.length > 0 ? [...filtered, "×", "－"] : ["◯", "⏰", "△", "×", "－"];
  return ordered.map((symbol) => ({
    symbol,
    label: ATT_LABEL_DICT[symbol] ?? null,
  }));
}
