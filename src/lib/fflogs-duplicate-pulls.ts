/**
 * 別のログと同じ pull (2026-10-07、C-3。ユーザーの選択「集計だけ 1 本に」)。
 *
 * 同じ夜を 2 人がそれぞれ FFLogs に上げると、同じ pull が 2 本のレポートに
 * 1 本ずつ入る。pull 数・クリア数・戦闘時間・ワイプ原因などの集計で二重に
 * 数えないよう、片方を「数えない」側にする。振り返り (日の行の pull 一覧) では
 * 両方の行を出し、数えない側に「別のログと同じ pull (数えない)」と添える
 * (どちらのログの動画・FFLogs にも飛べるように)。
 *
 * ## 同じ pull とみなす条件
 *
 * - レポートが違う (同じレポートの中で pull が重なることは無い)
 * - encounter が同じ (encounter が分からない pull は比べない)
 * - 開始と終了の差がどちらも `DUPLICATE_PULL_TOLERANCE_MS` (10 秒) 以内
 *
 * ⚠ 時刻はレポートを上げた人の PC の時計なので、時計が 10 秒以上ずれている
 * PC のログは同じ pull と分からず、二重に数える (これまで通り)。連続する
 * 2 つの pull は、リセットとカウントダウンを挟むので開始と終了が両方 10 秒
 * 以内に並ぶことは無い。
 *
 * ## どちらを数えるか
 *
 * pull の多いレポート (その夜を長く録ったログ) を数える側にする。同数なら
 * レポートコードの昇順。pull ごとではなくレポートの順位で決めるので、同じ夜の
 * 数える pull は同じレポートにそろう (日の行で、数える側と数えない側が pull
 * ごとに入れ替わらない)。
 *
 * ## 数えないもの・数えるもの
 *
 * - ログ合計 (`totalLogMs`) は区間の和集合なので、重なった 2 本のレポートを
 *   もともと 1 回だけ数える。こちらは全 pull のまま渡す
 * - 動画のオフセットの基準 (レポートごとの pull #1) は、数えない側のレポートの
 *   動画にも要るので全 pull のまま
 *
 * `@/` を import しない純モジュール (scripts/check-fflogs-duplicate-pulls.mjs)。
 */

/** 同じ pull とみなす開始・終了の差の上限。 */
export const DUPLICATE_PULL_TOLERANCE_MS = 10_000;

/** 判定に要る最小の pull 情報 (`FightRow` の部分集合)。 */
export type DuplicateCheckFight = {
  reportCode: string;
  fightId: number;
  encounterId: number | null;
  startMs: number;
  endMs: number;
};

/** pull の識別子 (`fflogs_fights` の複合主キー)。 */
export function pullKey(f: Pick<DuplicateCheckFight, "reportCode" | "fightId">): string {
  return `${f.reportCode}:${f.fightId}`;
}

/**
 * 別のログと同じ pull → 数える側の pull の `pullKey`。同じ pull が無ければ空。
 *
 * 数える側の pull 1 本に対して、数えない側はレポート 1 本につき 1 本まで
 * (3 人が上げれば 2 本が同じ 1 本を指す)。
 */
export function duplicatePulls(
  fights: ReadonlyArray<DuplicateCheckFight>,
): Map<string, string> {
  const out = new Map<string, string>();
  const countByReport = new Map<string, number>();
  for (const f of fights) {
    countByReport.set(f.reportCode, (countByReport.get(f.reportCode) ?? 0) + 1);
  }
  // レポートが 1 本なら比べる相手がいない。
  if (countByReport.size < 2) return out;

  const tol = DUPLICATE_PULL_TOLERANCE_MS;
  // 順位の高いレポート (pull が多い → コード昇順) の pull から見ていく。先に
  // 残った pull が「数える側」になる。
  const order = fights
    .filter(
      (f) => f.encounterId !== null && Number.isFinite(f.startMs) && Number.isFinite(f.endMs),
    )
    .sort(
      (a, b) =>
        countByReport.get(b.reportCode)! - countByReport.get(a.reportCode)! ||
        (a.reportCode < b.reportCode ? -1 : a.reportCode > b.reportCode ? 1 : 0) ||
        a.startMs - b.startMs,
    );
  // 数える側の pull を encounter と開始時刻の桶 (幅 = 許容差) で引けるようにする。
  // 開始の差が許容差以内なら桶は隣までしか離れない。
  const kept = new Map<string, DuplicateCheckFight[]>();
  const bucketKey = (encounterId: number, bucket: number) => `${encounterId}:${bucket}`;
  // 「数える側の pull | 数えない側のレポート」— 同じレポートの 2 本を 1 本に重ねない。
  const claimed = new Set<string>();
  for (const f of order) {
    const encounterId = f.encounterId!;
    const bucket = Math.floor(f.startMs / tol);
    let match: DuplicateCheckFight | null = null;
    let matchGap = Infinity;
    for (let d = -1; d <= 1; d++) {
      for (const k of kept.get(bucketKey(encounterId, bucket + d)) ?? []) {
        if (k.reportCode === f.reportCode) continue;
        const ds = Math.abs(k.startMs - f.startMs);
        const de = Math.abs(k.endMs - f.endMs);
        if (ds > tol || de > tol) continue;
        if (claimed.has(`${pullKey(k)}|${f.reportCode}`)) continue;
        // 候補が複数あるときは最も近い pull に重ねる。
        if (ds + de < matchGap) {
          match = k;
          matchGap = ds + de;
        }
      }
    }
    if (match) {
      out.set(pullKey(f), pullKey(match));
      claimed.add(`${pullKey(match)}|${f.reportCode}`);
      continue;
    }
    const key = bucketKey(encounterId, bucket);
    const list = kept.get(key);
    if (list) list.push(f);
    else kept.set(key, [f]);
  }
  return out;
}

/** 集計に数える pull (別のログと同じ pull を除く。並びは渡したまま)。 */
export function countedPulls<T extends DuplicateCheckFight>(
  fights: ReadonlyArray<T>,
  duplicateOf: ReadonlyMap<string, string> = duplicatePulls(fights),
): T[] {
  if (duplicateOf.size === 0) return [...fights];
  return fights.filter((f) => !duplicateOf.has(pullKey(f)));
}
