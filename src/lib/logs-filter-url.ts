/**
 * 練習ログの絞り込みを URL に載せる (UI-5、2026-09-08)。純関数のみ。
 *
 * 調査ノート第 4 回 8-3 UI-5「フェーズ・セグメント + URL 状態同期
 * (`?phase=2` を Discord に貼れる)」。層フィルタ (2026-08-30) はコンポーネント
 * のローカル state だったので、「4層後半だけ見て」を共有する手段が
 * 「開いてから押して」しかなかった。
 *
 * ## パラメータの形
 *
 * 貼られた URL は**人が読む**ので、内部 index ではなく画面のラベルに寄せる:
 *
 *   | 画面    | URL            |
 *   |---------|----------------|
 *   | 3層      | `?floor=3`     |
 *   | 4層前半  | `?floor=4a`    |
 *   | 4層後半  | `?floor=4b`    |
 *   | P2      | `?phase=2`     |
 *
 * 層の内部 index は前半 / 後半を別番号にする (4層前半 = 4 / 4層後半 = 5) ため、
 * そのまま出すと「5層」があるように読める。表示層番号 + `a` / `b` にすると
 * 画面のチップと 1:1 で対応する。
 *
 * ## 値は必ず「実在する区間」に照合する
 *
 * `parseFloorParam` / `parsePhaseParam` は**候補の一覧を受け取り**、その中に
 * 無い値は `null` (= 全件) に倒す。閲覧者が URL に任意の値を書けるので、
 * 照合せずに使うと「どの pull にも一致しない空の一覧」が出る
 * (軽減表の `?gid=` を登録済みタブに限っているのと同じ考え)。
 *
 * 検証: `node scripts/check-logs-filter-url.mjs`
 */

/** 層フィルタの選択肢 (呼び出し側の `floorChoices` の部分集合)。 */
export type FloorParamChoice = {
  /** 層 index (1 始まり。前半 / 後半は別 index)。 */
  index: number;
  /** 表示上の層番号 (前半 / 後半とも 4)。 */
  displayFloor: number;
  /** 最終層の前半 / 後半 (分割の無い層は null)。 */
  half: "first" | "second" | null;
};

/** 層の選択肢 → URL 値 (`3` / `4a` / `4b`)。 */
export function floorParamValue(choice: FloorParamChoice): string {
  const suffix =
    choice.half === "first" ? "a" : choice.half === "second" ? "b" : "";
  return `${choice.displayFloor}${suffix}`;
}

/**
 * URL 値 → 層 index。候補に無ければ null (= 全層)。
 *
 * 大文字 (`4A`) と前後の空白は許容する — Discord に貼った URL が
 * クライアント側で整形されることがあるため。
 */
export function parseFloorParam(
  raw: string | null | undefined,
  choices: ReadonlyArray<FloorParamChoice>,
): number | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const c of choices) {
    if (floorParamValue(c).toLowerCase() === key) return c.index;
  }
  return null;
}

/**
 * URL 値 → フェーズ番号。観測済みのフェーズに無ければ null (= 全フェーズ)。
 * `P2` のように接頭辞つきで貼られることがあるので受け付ける。
 */
export function parsePhaseParam(
  raw: string | null | undefined,
  phases: ReadonlyArray<number>,
): number | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/^p/, "");
  if (!key || !/^\d+$/.test(key)) return null;
  const n = Number(key);
  return phases.includes(n) ? n : null;
}

/**
 * クエリ文字列を 1 キーだけ差し替える。`value` が null / 空なら**キーごと
 * 落とす** (「全層」に戻したときに `?floor=` が残らないように)。
 *
 * 戻り値は `?` を含まない生のクエリ (空なら空文字)。呼び出し側が
 * `pathname + (q ? "?" + q : "")` を組み立てて
 * `history.replaceState` に渡す — 空文字をそのまま replaceState に渡すと
 * 「現在の URL のまま」を意味してクエリが消えない。
 *
 * 他のキー (将来の `?tab=` 等) は順序ごと保つ。
 */
export function withParam(
  search: string,
  key: string,
  value: string | null,
): string {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
  return params.toString();
}
