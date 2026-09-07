/**
 * 日付メモの重要度 (UI-3、2026-09-07)。
 *
 * 日付メモは平坦な時系列リストで、「今夜必ず直すこと」と「参考情報」が
 * 同じ見た目で並んでいた (調査ノート第 4 回 8-3 UI-3、出典 xivanalysis の
 * Suggestions)。3 段階のラベルを付けて、並び替えと絞り込みができるように
 * する。
 *
 * ## 4 値にした理由 (既定は `none`)
 *
 * 段階は major / medium / minor の 3 つだが、**既定値は `none` (未設定)**。
 * 既存のメモに後から「medium」を割り当てると、ただの連絡が全部
 * 「注意」の色で並ぶことになり、色の意味が薄れる。重要度は付けたい人が
 * 付けるものにして、付いていないメモは今までと同じ見た目のままにする。
 *
 * ## 並び順
 *
 * major → medium → 未設定 → minor。同じ段階の中は従来どおり時系列。
 * minor を未設定より後ろにするのは「minor = 意識的に下げた」印で、
 * 未設定 (= まだ判断していない) より低く扱ってよいから。
 *
 * ## 色だけで区別しない
 *
 * 調査ノートの注意書き (`ラベルは色 + アイコン + 文字を必須に`) に従い、
 * UI 側は色・記号・文字の 3 つを必ず出す。赤緑の色覚多様性で読めない、
 * モノクロ印刷で消える、を避けるため。
 *
 * 検証: `node scripts/check-memo-severity.mjs`
 */

export const MEMO_SEVERITIES = ["major", "medium", "minor", "none"] as const;
export type MemoSeverity = (typeof MEMO_SEVERITIES)[number];

/** 既定値。既存メモと「重要度を付けずに書いたメモ」がここに入る。 */
export const MEMO_SEVERITY_DEFAULT: MemoSeverity = "none";

export function isMemoSeverity(v: unknown): v is MemoSeverity {
  return typeof v === "string" && (MEMO_SEVERITIES as readonly string[]).includes(v);
}

/** DB から読んだ値を正規化する。未知の値・null は既定へ倒す。 */
export function parseMemoSeverity(v: unknown): MemoSeverity {
  return isMemoSeverity(v) ? v : MEMO_SEVERITY_DEFAULT;
}

/** 並び順の順位 (小さいほど上)。 */
export function memoSeverityRank(s: MemoSeverity): number {
  switch (s) {
    case "major":
      return 0;
    case "medium":
      return 1;
    case "none":
      return 2;
    case "minor":
      return 3;
  }
}

/**
 * 重要度 → 時系列で並べ替える (純関数、入力は変更しない)。
 *
 * 同じ重要度の中の順序は**呼び出し時点の並びを保つ** (安定ソート)。
 * 一覧側が新しい順で持っていれば新しい順のまま、古い順なら古い順のまま。
 */
export function sortByMemoSeverity<T extends { severity: MemoSeverity }>(
  items: ReadonlyArray<T>,
): T[] {
  return [...items].sort(
    (a, b) => memoSeverityRank(a.severity) - memoSeverityRank(b.severity),
  );
}

/** `minor` を隠す絞り込み (トグル用)。`none` は隠さない。 */
export function filterMemoSeverity<T extends { severity: MemoSeverity }>(
  items: ReadonlyArray<T>,
  hideMinor: boolean,
): T[] {
  return hideMinor ? items.filter((i) => i.severity !== "minor") : [...items];
}

/** 隠される件数 (トグルのラベルに出す)。 */
export function countMinor<T extends { severity: MemoSeverity }>(
  items: ReadonlyArray<T>,
): number {
  return items.filter((i) => i.severity === "minor").length;
}

/**
 * バッジの配色。`none` は枠も色も付けない (今までのメモと同じ見た目)。
 *
 * 赤 (major) / 橙 (medium) / 青 (minor) は調査ノートの指定どおり。
 * 練習ログの熱量色 (UI-12 の 5 段階) とは役割が違うので混ぜない
 * — あちらは「達成度」、こちらは「対応の優先度」。
 */
export function memoSeverityToneClass(s: MemoSeverity): string {
  switch (s) {
    case "major":
      return "border-rose-400/50 bg-rose-500/12 text-rose-200";
    case "medium":
      return "border-amber-400/45 bg-amber-400/10 text-amber-200";
    case "minor":
      return "border-sky-400/40 bg-sky-400/10 text-sky-200";
    case "none":
      return "border-border/50 text-muted-foreground";
  }
}

/** バッジの記号 (色以外の手がかり)。 */
export function memoSeverityMark(s: MemoSeverity): string {
  switch (s) {
    case "major":
      return "↑";
    case "medium":
      return "→";
    case "minor":
      return "↓";
    case "none":
      return "";
  }
}
