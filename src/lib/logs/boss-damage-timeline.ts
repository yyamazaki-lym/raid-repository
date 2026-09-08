/**
 * ボスの被ダメージ時系列と軽減表の雛形 (W-10 + W-9 の x 軸、2026-09-08)。
 *
 * FFLogs の `events(dataType: DamageTaken)` は **1 ヒット = 1 件**で返る。
 * 全体攻撃は 8 人ぶんが同じ瞬間に並ぶので、そのまま並べても軽減表には
 * ならない。ここで **「同じ技 × ほぼ同時刻」を 1 行に畳んで**、
 * `時刻 / 技名 / 対象人数 / 合計ダメージ` にする。これが軽減表の 1 行と
 * 同じ粒度になる。
 *
 * ## 何を作らないか
 *
 * ⚠ **軽減率の計算と「どの技が軽減か」の判定はしない。** 調査ノート第 4 回
 * 7-A W-9 のデメリット欄が「軽減 ID 許可リストのパッチ毎保守」で、
 * ゲーム側のデータ表を抱えると保守が続かない (W-8 で同じ判断をした)。
 * 出すのは **実測値だけ** — 「いつ・何が・何人に・どれだけ」。
 *
 * ⚠ **計画 (Sheets の軽減表) との重ね合わせもしない。** シートの技名は
 * 固定ごとの略称で、FFLogs の正式名と文字列一致しない。無理に突き合わせると
 * 「合っているのに合っていないと出る」方が害が大きい。**雛形を出して人が
 * 貼る**形にとどめる (ノートの W-10 がまさにこの形)。
 *
 * 検証: `node scripts/check-boss-damage-timeline.mjs`
 */

/** 同時刻とみなす幅 (ms)。全体攻撃は 8 人ぶんが数十 ms 内に散る。 */
export const SAME_CAST_WINDOW_MS = 700;

export type BossDamageRow = {
  /** pull 開始からの相対 ms (畳んだ中で最も早いヒット)。 */
  t: number;
  /** 技名 (FFLogs の ability.name)。取れなければ null。 */
  ability: string | null;
  /** ゲーム内 action ID (取れなければ null)。 */
  abilityId: number | null;
  /** 何人に当たったか (畳んだヒット数)。 */
  targets: number;
  /** 合計ダメージ。 */
  total: number;
  /** 1 人あたりの最大ダメージ (即死級かどうかの判断に使う)。 */
  max: number;
};

type Rec = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `events(dataType: DamageTaken)` の JSON を軽減表の行に畳む。
 *
 * @param raw          `data` 配列か、その親オブジェクト
 * @param fightStartMs レポート相対の pull 開始 ms
 * @param fightEndMs   レポート相対の pull 終了 ms
 * @param minTotal     この合計ダメージ未満の行は捨てる (継続ダメージ避け)
 */
export function buildBossDamageTimeline(
  raw: unknown,
  fightStartMs: number,
  fightEndMs: number,
  minTotal = 0,
): BossDamageRow[] {
  const events = pickEventArray(raw);
  if (!events) return [];
  // キー = 技 ID (無ければ名前)。**丸めではなく「その行の先頭のヒットから
  // SAME_CAST_WINDOW_MS 以内か」で判定する。**
  //   - 丸めにしない理由: 境界をまたいだ同じ全体攻撃が 2 行に割れる
  //   - 「直前のヒットから」にしない理由: 一定間隔で続く継続ダメージが
  //     **際限なく 1 行に繋がる** (600ms ごとに刻む技が 1 行になり、
  //     対象人数が数十になって軽減表の行として意味を失う)
  const rows: BossDamageRow[] = [];
  const lastIndexByAbility = new Map<string, number>();

  const sorted = events
    .map((e) => (e && typeof e === "object" ? (e as Rec) : null))
    .filter((e): e is Rec => e !== null)
    .map((e) => {
      const ts = num(e["timestamp"]);
      const abilityObj =
        e["ability"] && typeof e["ability"] === "object"
          ? (e["ability"] as Rec)
          : null;
      return {
        ts,
        amount: num(e["amount"]) ?? 0,
        // 吸収 (シールドで消えた分) は「飛んできた量」に含める — 軽減表を
        // 作るときに知りたいのは素の威力に近い側なので。
        absorbed: num(e["absorbed"]) ?? 0,
        name:
          abilityObj && typeof abilityObj["name"] === "string"
            ? (abilityObj["name"] as string)
            : null,
        id: abilityObj ? num(abilityObj["guid"]) : null,
      };
    })
    .filter((e) => e.ts !== null)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  for (const e of sorted) {
    const rel = (e.ts ?? 0) - fightStartMs;
    if (rel < -5_000 || rel > fightEndMs - fightStartMs + 5_000) continue;
    const t = Math.max(0, Math.round(rel));
    const key = e.id !== null ? `id:${e.id}` : `name:${e.name ?? "?"}`;
    const amount = e.amount + e.absorbed;
    const prevIdx = lastIndexByAbility.get(key);
    const prev = prevIdx === undefined ? undefined : rows[prevIdx];
    if (prev && t - prev.t <= SAME_CAST_WINDOW_MS) {
      prev.targets += 1;
      prev.total += amount;
      if (amount > prev.max) prev.max = amount;
      continue;
    }
    rows.push({
      t,
      ability: e.name,
      abilityId: e.id,
      targets: 1,
      total: amount,
      max: amount,
    });
    lastIndexByAbility.set(key, rows.length - 1);
  }

  const filtered = minTotal > 0 ? rows.filter((r) => r.total >= minTotal) : rows;
  filtered.sort((a, b) => a.t - b.t);
  return filtered;
}

function pickEventArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Rec;
  if (Array.isArray(r["data"])) return r["data"] as unknown[];
  const events = r["events"];
  if (events && typeof events === "object") {
    const d = (events as Rec)["data"];
    if (Array.isArray(d)) return d as unknown[];
  }
  return null;
}

/** `m:ss` (軽減表の時刻列と同じ書式)。 */
export function formatTimelineClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * Sheets に貼る TSV (W-10)。
 *
 * ⚠ **タブ区切りにする。** Google Sheets はクリップボードの TSV を
 * そのままセルへ展開するので、貼るだけで表になる (CSV だと 1 列に入る
 * ことがある)。見出し行は呼び出し側 (i18n) が渡す。
 */
export function buildMitigationDraftTsv({
  rows,
  headers,
}: {
  rows: readonly BossDamageRow[];
  /** 見出し 5 列 (時刻 / 技名 / 対象人数 / 合計 / 最大)。 */
  headers: readonly [string, string, string, string, string];
}): string {
  const lines = [headers.join("\t")];
  for (const r of rows) {
    lines.push(
      [
        formatTimelineClock(r.t),
        (r.ability ?? "").replace(/[\t\r\n]+/g, " "),
        String(r.targets),
        String(Math.round(r.total)),
        String(Math.round(r.max)),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
