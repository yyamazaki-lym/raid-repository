/**
 * 練習ログの集計 (TODO #94 / A-1)。純関数のみ。
 *
 * 集計するのは **PT としての到達度** だけ — pull 数 / クリア数 /
 * 到達フェーズ / ボス残 HP% / PT 合計 DPS / 死亡数。個人の火力は集計対象に
 * 入れない (調査ノート §1-F: 公式が DPS メーターを実装しない方針で、晒し
 * 行為はハラスメント。固定内の空気を壊す実害の方が大きい)。PT 合計 DPS は
 * 「PT として削れているか」の指標であり個人を序列化しないので扱う。
 */

import { jstYmdString } from "./jst-date";

/**
 * FFLogs の残 HP% を「0-100 のパーセント」に正規化する。
 *
 * v1 系の `boss_percentage` は 100 倍値 (3421 = 34.21%) で返っていた歴史が
 * あり、v2 の `fightPercentage` も環境によって 100 倍値が観測される。
 * パーセントが 100 を超えることは定義上あり得ないので、100 超なら 100 倍値
 * とみなして戻す。取り違えても「表示が 100 倍ズレる」だけで済まないため
 * (順位付けが逆転する) 、読み出し側の 1 箇所でまとめて吸収する。
 */
export function normalizePercentage(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return raw > 100 ? raw / 100 : raw;
}

export type FightRow = {
  reportCode: string;
  fightId: number;
  sessionDate: string | null;
  name: string | null;
  kill: boolean;
  /**
   * 終了時点のボス残 HP (%)。小さいほど深く到達している。kill なら 0。
   * 読み出し時に `normalizePercentage` を通した 0-100 の値。
   */
  fightPercentage: number | null;
  lastPhase: number | null;
  /** FFLogs の encounter ID。零式ティアでは層ごとに異なる。 */
  encounterId: number | null;
  /**
   * FFLogs の難易度値 (2026-08-30)。コンテンツ種別で値が変わり公開された
   * 対応表が無いため、portal 側は意味づけせず **観測値として表示するだけ**。
   * 取り込みフィルタの下限もこの実測値を見て admin が決める。
   */
  difficulty: number | null;
  /**
   * PT 合計 DPS (2026-09-03)。FFLogs の Summary table の damageDone を
   * **PT 全員分合計** して戦闘時間で割った値。個人の内訳は持たない。
   * 同期時に取得できなかった pull は null (UI は非表示)。
   */
  partyDps: number | null;
  /** その pull での PT の死亡数。未取得なら null。 */
  deaths: number | null;
  startMs: number;
  endMs: number;
  reportStartMs: number | null;
};

/**
 * カテゴリ内の encounter ID → 層番号 (1 始まり) の対応。
 *
 * 零式ティアは 1 ティア = 複数 encounter (M5S〜M8S 等) で、FFLogs の
 * encounter ID は層順の連番になっている。カテゴリに現れた distinct な
 * encounter ID を昇順に並べて 1..N 層と割り当てる。encounter が 1 種類
 * しか無い (絶・討滅) 場合は層の概念が無いので null を返す。
 */
export type FloorMap = {
  /**
   * encounterId → 層 index (1 始まり)。ティアのクラスタに属するもののみ。
   * 最終層が前半/後半に分かれるティアでは前半・後半が別 index になる
   * (進捗バーのセグメントとしてはそれぞれ 1 区間)。表示する層名は
   * `labelByIndex` / `displayFloorByIndex` を参照する。
   */
  byEncounter: Map<number, number>;
  /** 進捗バーのセグメント数 (前半/後半分割時は表示層数 + 1)。 */
  floorCount: number;
  /** 最終 encounter (分割時は後半)。「クリア」の判定対象。 */
  finalEncounterId: number;
  /** 層 index → 表示ラベル (例: "3層" / "4層前半" / "4層後半")。 */
  labelByIndex: Map<number, string>;
  /** 層 index → 表示上の層番号 (前半/後半とも 4)。範囲チップ用。 */
  displayFloorByIndex: Map<number, number>;
  /** クリア判定対象の層の表示名 (例: "4層")。クリア回数タイル用。 */
  finalFloorLabel: string;
} | null;

/** 層 index の表示ラベル。floors が無い/未知の index は "◯層" にフォールバック。 */
export function floorLabel(floors: FloorMap, index: number): string {
  return floors?.labelByIndex.get(index) ?? `${index}層`;
}

/**
 * 実データのレポートには同日の別コンテンツ (エキスパートダンジョン・
 * 討滅など) の戦闘が混ざる (2026-08-28 実機: これで ID の広がりが閾値を
 * 超え、層表示が丸ごと無効化されていた)。そこで「pull 数が最も多い
 * 幅 8 以内の連続 encounter クラスタ」をティアとみなし、クラスタ外の
 * 戦闘は層判定 (と練習ログの集計) から除外する。
 */
export function buildFloorMap(
  fights: FightRow[],
  /**
   * コンテンツ種別から分かる期待層数 (零式 = 4)。クラスタの encounter 数が
   * 期待 + 1 のときは「最終層が前半/後半に分かれるティア」とみなし、
   * 末尾 2 つを「◯層前半 / ◯層後半」として同じ表示層番号に割り当てる
   * (2026-08-28 実機: M8S 型のティアが「5層」扱いになっていた)。
   * null なら分割検出をしない。
   */
  expectedFloorCount: number | null = null,
): FloorMap {
  const counts = new Map<number, number>();
  for (const f of fights) {
    if (f.encounterId === null || !Number.isFinite(f.encounterId)) continue;
    counts.set(f.encounterId, (counts.get(f.encounterId) ?? 0) + 1);
  }
  const ids = [...counts.keys()].sort((a, b) => a - b);
  if (ids.length <= 1) return null;

  // 幅 8 のウィンドウで pull 数最大のクラスタを選ぶ。
  let best: number[] = [];
  let bestWeight = -1;
  for (let i = 0; i < ids.length; i++) {
    const start = ids[i]!;
    const cluster = ids.filter((id) => id >= start && id <= start + 7);
    const weight = cluster.reduce((acc, id) => acc + (counts.get(id) ?? 0), 0);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = cluster;
    }
  }
  // クラスタ内の encounter が 1 種類なら層の概念なし (絶・討滅 + 混入ゴミ)。
  if (best.length <= 1) return null;

  const min = best[0]!;
  const max = best[best.length - 1]!;
  // FFLogs のティア encounter は連番なので、層 index は「クラスタ最小 ID
  // からのオフセット」で出す (出現順だと未挑戦の層を飛ばして番号がずれる)。
  const floorCount = max - min + 1;

  // 最終層の前半/後半分割の検出: 期待層数 (零式 = 4) より encounter が
  // ちょうど 1 つ多ければ、末尾 2 つ = 最終層の前半/後半 (FFLogs は前半に
  // 若い ID を振る)。表示層番号は両方とも期待層数 (例: 4) に畳む。
  const split =
    expectedFloorCount !== null && floorCount === expectedFloorCount + 1;
  const labelByIndex = new Map<number, string>();
  const displayFloorByIndex = new Map<number, number>();
  for (let idx = 1; idx <= floorCount; idx++) {
    if (split && idx >= floorCount - 1) {
      const half = idx === floorCount - 1 ? "前半" : "後半";
      labelByIndex.set(idx, `${expectedFloorCount}層${half}`);
      displayFloorByIndex.set(idx, expectedFloorCount);
    } else {
      labelByIndex.set(idx, `${idx}層`);
      displayFloorByIndex.set(idx, idx);
    }
  }

  return {
    byEncounter: new Map(best.map((id) => [id, id - min + 1])),
    floorCount,
    finalEncounterId: max,
    labelByIndex,
    displayFloorByIndex,
    finalFloorLabel: split ? `${expectedFloorCount}層` : `${floorCount}層`,
  };
}

/**
 * 層クラスタが決まっているとき、クラスタ外 (別コンテンツ) の戦闘を
 * 練習ログの集計・表示から除外する。
 */
export function filterToFloorCluster(
  fights: FightRow[],
  floors: FloorMap,
): FightRow[] {
  if (!floors) return fights;
  return fights.filter(
    (f) => f.encounterId !== null && floors.byEncounter.has(f.encounterId),
  );
}

/**
 * 「クリア」の判定 (2026-08-28 実機フィードバック)。
 * 零式ティアでは消化で全層の kill が付き「討伐」バッジが情報にならない。
 * 複数層のカテゴリでは **最終層の kill のみ** をクリアとして扱う。
 * 絶・討滅 (encounter 1 種) は従来どおり kill = クリア。
 */
export function isClearFight(f: FightRow, floors: FloorMap): boolean {
  if (!f.kill) return false;
  if (!floors) return true;
  return f.encounterId === floors.finalEncounterId;
}

export type DaySummary = {
  /** JST 暦日 `YYYY-MM-DD`。 */
  date: string;
  pulls: number;
  /** kill の総数 (層問わず)。 */
  kills: number;
  /** 最終層クリア (絶なら kill) の数。 */
  clears: number;
  /** その日の最良 (最小) 残 HP%。取得できない場合は null。 */
  bestPercentage: number | null;
  /** その日の最深到達フェーズ。 */
  bestPhase: number | null;
  /** その日に挑んだ最高層 (層の概念が無いカテゴリでは null)。 */
  bestFloor: number | null;
  /** 戦闘時間の合計 (秒)。休憩は含まない = 「実戦闘時間」。 */
  fightSeconds: number;
  fights: FightRow[];
};

export type ProgressSummary = {
  totalPulls: number;
  /** 最終層クリア (絶なら kill) の数。 */
  totalClears: number;
  bestPercentage: number | null;
  bestPhase: number | null;
  /** 初クリアの pull (時系列で最初の最終層 kill)。 */
  firstKill: FightRow | null;
  /** クリア pull の最短戦闘時間 (秒)。クリアが無ければ null。 */
  fastestClearSeconds: number | null;
  days: DaySummary[];
};

/** fight の属する日 (session_date があればそれ、無ければ JST 暦日)。 */
export function fightDate(f: FightRow): string {
  return f.sessionDate ?? jstYmdString(new Date(f.startMs));
}

export function summarize(
  fights: FightRow[],
  floors: FloorMap = buildFloorMap(fights),
  /**
   * フェーズ管理コンテンツ (絶) か (2026-09-03)。true のとき残 HP% を
   * **最深フェーズ内** に限定して集計する。FFLogs の `fightPercentage` は
   * 到達フェーズのボス残 HP なので (WCL がこの値を
   * `lastPhaseForPercentageDisplay` と対で返すのがその根拠)、フェーズを
   * 跨いで最小値を採ると「P1 で 0.5% まで削った」が「P7 で 30%」に
   * 勝ってしまう。層モデルで最深層に絞っているのと同じ理由。
   */
  phaseModel = false,
): ProgressSummary {
  const byDay = new Map<string, FightRow[]>();
  for (const f of fights) {
    const d = fightDate(f);
    let list = byDay.get(d);
    if (!list) {
      list = [];
      byDay.set(d, list);
    }
    list.push(f);
  }

  const floorOf = (f: FightRow): number | null =>
    floors && f.encounterId !== null
      ? (floors.byEncounter.get(f.encounterId) ?? null)
      : null;
  // 残% のスコープとなる「区間」= 零式なら層、絶ならフェーズ。
  const segmentOf = (f: FightRow): number | null =>
    floors ? floorOf(f) : phaseModel ? f.lastPhase : null;

  // 「最深区間でのベスト残%」。層モデルがあるとき、下層の kill (消化) を
  // 0% として混ぜると消化日が常に「残0%」になり数字が意味を失う
  // (2026-08-28 実機報告)。最高到達層の戦闘だけで残% を出す。
  // フェーズ管理 (絶) も同様に最深フェーズ内で見る (2026-09-03)。
  const bestPercentageOf = (list: FightRow[]): number | null => {
    let scope = list;
    if (floors || phaseModel) {
      const idxs = list
        .map(segmentOf)
        .filter((v): v is number => v !== null);
      if (idxs.length > 0) {
        const top = Math.max(...idxs);
        scope = list.filter((f) => segmentOf(f) === top);
      }
    }
    return minOrNull(scope.map((f) => (f.kill ? 0 : f.fightPercentage)));
  };

  const days: DaySummary[] = [];
  for (const [date, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
    days.push({
      date,
      pulls: sorted.length,
      kills: sorted.filter((f) => f.kill).length,
      clears: sorted.filter((f) => isClearFight(f, floors)).length,
      bestPercentage: bestPercentageOf(sorted),
      bestPhase: maxOrNull(sorted.map((f) => f.lastPhase)),
      bestFloor: maxOrNull(sorted.map(floorOf)),
      fightSeconds: Math.round(
        sorted.reduce((acc, f) => acc + Math.max(0, f.endMs - f.startMs), 0) /
          1000,
      ),
      fights: sorted,
    });
  }
  // 新しい日が上。
  days.sort((a, b) => b.date.localeCompare(a.date));

  const chronological = [...fights].sort((a, b) => a.startMs - b.startMs);
  const clears = fights.filter((f) => isClearFight(f, floors));
  return {
    totalPulls: fights.length,
    totalClears: clears.length,
    bestPercentage: bestPercentageOf(fights),
    bestPhase: maxOrNull(fights.map((f) => f.lastPhase)),
    firstKill: chronological.find((f) => isClearFight(f, floors)) ?? null,
    fastestClearSeconds:
      clears.length > 0
        ? Math.round(
            Math.min(...clears.map((f) => Math.max(0, f.endMs - f.startMs))) /
              1000,
          )
        : null,
    days,
  };
}

/**
 * 「その日までで最良だった残 HP%」の推移。日ごとの棒グラフ用。
 * 初到達した日 (前日までの最良を更新した日) には `isRecord` が立つ。
 */
export type ProgressPoint = {
  date: string;
  pulls: number;
  bestPercentage: number | null;
  bestPhase: number | null;
  /** その日に挑んだ最高層 (層の概念が無いカテゴリでは null)。 */
  bestFloor: number | null;
  /**
   * バー用の到達度 (0-100)。層 (零式) / フェーズ (絶) の概念があるカテゴリ
   * では全体に対する進捗 = (突破済み区間数 + 現在区間の削り) / 区間数。
   * 無ければ 100 − 残 HP%。クリア日は 100。
   */
  progress: number;
  isRecord: boolean;
  /** その日が「初めてクリアした日」か (フラグの説明文で区別する)。 */
  isFirstClear: boolean;
  /** 最終層クリア (絶なら kill) があった日。 */
  hasClear: boolean;
};

export function progressTimeline(
  days: DaySummary[],
  floors: FloorMap = null,
  /**
   * フェーズ管理コンテンツ (絶) の区間数 (`observedPhaseCount`)。
   * 2026-09-03 実機要望「絶の方も P 毎に線を引いて見やすくできるか
   * (零式でいう層毎のようなもの)」。層と同じ「区間」として扱い、バーを
   * P1..PN に等分する。null なら従来どおり区間分割なし。
   */
  phaseCount: number | null = null,
): ProgressPoint[] {
  // 古い順に走査して記録更新を判定する。
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  // 零式の層と絶のフェーズを同じ「区間」として扱う (以降 segment)。
  const segmentCount = floors ? floors.floorCount : phaseCount;
  const segmentOf = (d: DaySummary): number | null =>
    floors ? d.bestFloor : phaseCount !== null ? d.bestPhase : null;
  let best: number | null = null; // その区間内の残% (区間が無い場合は全体)
  let bestSegmentSeen: number | null = null;
  let bestPhase: number | null = null;
  let seenClear = false;
  const out: ProgressPoint[] = [];
  for (const d of asc) {
    const segment = segmentOf(d);
    const improvedSegment =
      segment !== null &&
      (bestSegmentSeen === null || segment > bestSegmentSeen);
    // 区間が上がったら残% の記録はリセット (新しい層 / フェーズの削りが始まる)。
    if (improvedSegment) {
      bestSegmentSeen = segment;
      best = null;
    }
    const sameSegment = segment === bestSegmentSeen;
    const improvedPct =
      d.bestPercentage !== null &&
      (segmentCount === null || sameSegment) &&
      (best === null || d.bestPercentage < best);
    const improvedPhase =
      d.bestPhase !== null && (bestPhase === null || d.bestPhase > bestPhase);
    if (improvedPct) best = d.bestPercentage;
    if (improvedPhase) bestPhase = d.bestPhase;

    const hasClear = d.clears > 0;
    let progress: number;
    if (hasClear) {
      progress = 100;
    } else if (segmentCount !== null) {
      const inSegment =
        d.bestPercentage !== null
          ? Math.max(0, Math.min(1, 1 - d.bestPercentage / 100))
          : 0;
      // 区間が分かっているコンテンツで、その日だけ区間が取れない
      // (FFLogs が lastPhase を返していない) 場合は **最も浅い区間** に
      // 置く。バー全体に対する 100 − 残% として描くと、P1 で死んだ日が
      // 「ほぼ討伐」に見えてしまうため (過大より過小に倒す)。
      const seg = segment ?? 1;
      progress = Math.max(
        0,
        Math.min(100, ((seg - 1 + inSegment) / segmentCount) * 100),
      );
    } else if (d.bestPercentage !== null) {
      progress = Math.max(0, Math.min(100, 100 - d.bestPercentage));
    } else {
      progress = 0;
    }

    // 2026-08-30 実機報告「討伐済みなのにフラグが出ていないことがある」。
    //
    // 原因: 最終層が前半/後半に分かれるティアでは、**4層前半を討伐した日**
    // も (その日の最深層スコープで) 残 0% になる。すると `best` が先に 0 に
    // なり、後日の本当の初クリアで `improvedPct` が成立せず、到達層も既に
    // 更新済みなら `improvedFloor` も false → 初討伐にフラグが立たなかった。
    //
    // 「初めてクリアした日」は定義上いちばん大きな記録更新なので、残% の
    // 比較とは独立に記録として扱う。2 回目以降の討伐は記録ではない。
    const isFirstClear = hasClear && !seenClear;
    if (hasClear) seenClear = true;

    out.push({
      date: d.date,
      pulls: d.pulls,
      bestPercentage: d.bestPercentage,
      bestPhase: d.bestPhase,
      bestFloor: d.bestFloor,
      progress,
      isRecord: improvedPct || improvedPhase || improvedSegment || isFirstClear,
      isFirstClear,
      hasClear,
    });
  }
  return out;
}

/**
 * 総 pull の内訳 (2026-09-03 実機要望「総 Pull に各層やフェイズの内訳を
 * UI が崩れない程度に入れてほしい」)。
 *
 * - 層モデル (零式): 層 index ごとの pull 数 (消化の kill も その層の pull)。
 * - フェーズ管理 (絶): wipe を到達フェーズ (P1〜) ごとに数え、討伐は
 *   別バケットにする (討伐は「最終フェーズの wipe」ではないので)。
 * - どちらも無い (討滅など) → 内訳は出さない (空配列)。
 * 表示側は 1 バケットしか無いときも出さない (総数と同じ数字を並べるだけ)。
 */
export type PullBreakdownItem = {
  /** 表示ラベル (例: "3層" / "4層後半" / "P3" / "討伐")。 */
  label: string;
  count: number;
  kind: "floor" | "phase" | "clear" | "unknown";
  /** 層モデルのときの表示層番号 (色分け用)。層以外は null。 */
  displayFloor: number | null;
  /** フェーズモデルのときのフェーズ番号 (色分け用)。それ以外は null。 */
  phase: number | null;
  /** 最終層の前半/後半 (色分け用)。 */
  half: "first" | "second" | null;
};

export function pullBreakdown(
  fights: FightRow[],
  floors: FloorMap,
  showPhase: boolean,
): PullBreakdownItem[] {
  if (floors) {
    const counts = new Map<number, number>();
    for (const f of fights) {
      if (f.encounterId === null) continue;
      const idx = floors.byEncounter.get(f.encounterId);
      if (idx === undefined) continue;
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, count]) => {
        const label = floorLabel(floors, idx);
        return {
          label,
          count,
          kind: "floor" as const,
          displayFloor: floors.displayFloorByIndex.get(idx) ?? idx,
          phase: null,
          half: floorHalfOf(label),
        };
      });
  }
  if (!showPhase) return [];
  const byPhase = new Map<number, number>();
  let clears = 0;
  let unknown = 0;
  for (const f of fights) {
    if (f.kill) {
      clears += 1;
    } else if (f.lastPhase !== null && Number.isFinite(f.lastPhase)) {
      byPhase.set(f.lastPhase, (byPhase.get(f.lastPhase) ?? 0) + 1);
    } else {
      unknown += 1;
    }
  }
  const out: PullBreakdownItem[] = [...byPhase.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, count]) => ({
      label: `P${phase}`,
      count,
      kind: "phase" as const,
      displayFloor: null,
      phase,
      half: null,
    }));
  if (clears > 0) {
    out.push({
      label: "討伐",
      count: clears,
      kind: "clear",
      displayFloor: null,
      phase: null,
      half: null,
    });
  }
  if (unknown > 0) {
    out.push({
      label: "不明",
      count: unknown,
      kind: "unknown",
      displayFloor: null,
      phase: null,
      half: null,
    });
  }
  return out;
}

/**
 * PT 合計 DPS の表示 (`84.2k` / `9,800`)。零式・絶の PT DPS は数万の桁なので
 * 1 桁小数の k 表記に畳み、行の幅を固定する。null は "—"。
 */
export function formatPartyDps(dps: number | null): string {
  if (dps === null || !Number.isFinite(dps)) return "—";
  if (dps >= 10_000) return `${(dps / 1000).toFixed(1)}k`;
  return Math.round(dps).toLocaleString("en-US");
}

/** 残 HP% の表示 (`12.3%`)。null は "—"。 */
export function formatPercentage(p: number | null): string {
  if (p === null) return "—";
  if (p <= 0) return "0%";
  // 1% 未満を 1 桁丸めすると「0.0%」になり討伐 (0%) と区別できないため
  // 2 桁で出す (惜しい wipe ほど小数が意味を持つ)。
  if (p < 1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(1)}%`;
}

/**
 * 残 HP% を「討伐までの熱量」で色分けする Tailwind テキストクラス
 * (2026-08-30 実機報告「灰色だらけで見にくい」への対応)。
 * ゲーム内の低 HP ほど赤く見える感覚に合わせ、残りが少ないほど暖色:
 * 討伐(0) = emerald / <2% = rose / ≤10% = orange / ≤30% = amber /
 * ≤60% = sky / それ以上 = 従来の muted。
 */
export function percentageToneClass(p: number | null): string {
  if (p === null) return "text-muted-foreground";
  if (p <= 0) return "text-emerald-300";
  if (p < 2) return "text-rose-300";
  if (p <= 10) return "text-orange-300";
  if (p <= 30) return "text-amber-300";
  if (p <= 60) return "text-sky-300";
  return "text-muted-foreground";
}

/**
 * 表示層番号 (1..4) ごとのチップ配色。null / 範囲 (複合、例「1-4層」) は
 * cyan。4層前半/後半はどちらも表示層 4 なので同じ rose 系になる。
 * クリア表示は別途 emerald を使うため、ここは「どの層か」の識別色に徹する。
 */
export function floorToneClass(
  displayFloor: number | null,
  /**
   * 最終層が前半/後半に分かれるティア用 (2026-08-30 実機要望
   * 「4層前半と後半の色も分けてほしい」)。`labelByIndex` のラベルに
   * 「前半」「後半」が含まれるかで渡す。
   */
  half?: "first" | "second" | null,
): string {
  switch (displayFloor) {
    case 1:
      return "border-sky-400/45 bg-sky-400/10 text-sky-200";
    case 2:
      return "border-teal-400/45 bg-teal-400/10 text-teal-200";
    case 3:
      return "border-violet-400/45 bg-violet-400/10 text-violet-200";
    case 4:
      // 前半 = rose、後半 = fuchsia。同じ「4層」でも到達点として意味が
      // 違うので、ひと目で区別できるよう色相を分ける。
      return half === "second"
        ? "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-200"
        : "border-rose-400/45 bg-rose-400/10 text-rose-200";
    default:
      return "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]";
  }
}

/**
 * フェーズ管理コンテンツ (絶) の区間数 = 観測できた最深フェーズ (2026-09-03)。
 *
 * 零式の層数を「実データに現れた encounter の連番の幅」から出しているのと
 * 同じ考え方で、フェーズ数も **観測値** から決める (コンテンツごとの正しい
 * 総フェーズ数を portal は知らないし、持つと FF14 側の知識を抱えることに
 * なる)。したがって新しいフェーズに初到達した日にバーの分母が増え、
 * 過去の日のバーは相対的に短くなる — 層モデルと同じ挙動。
 *
 * 1 フェーズしか観測できていないうちは区間分割しない (null)。
 */
export function observedPhaseCount(fights: FightRow[]): number | null {
  const max = maxOrNull(fights.map((f) => f.lastPhase));
  return max !== null && max >= 2 ? max : null;
}

/**
 * フェーズ (P1〜) のチップ配色 (2026-09-03)。
 *
 * 層と違って数がコンテンツ次第 (絶は 5〜7) なので、`floorToneClass` の並び
 * (sky → teal → violet → rose/fuchsia) を踏襲しつつ「深いほど暖色」に
 * 伸ばした 7 段のランプにする。emerald はクリア表示の専用色なので使わない。
 * 範囲 (複数フェーズに挑んだ日) と 8 以降は cyan。
 */
export function phaseToneClass(phase: number | null): string {
  switch (phase) {
    case 1:
      return "border-sky-400/45 bg-sky-400/10 text-sky-200";
    case 2:
      return "border-teal-400/45 bg-teal-400/10 text-teal-200";
    case 3:
      return "border-indigo-400/45 bg-indigo-400/10 text-indigo-200";
    case 4:
      return "border-violet-400/45 bg-violet-400/10 text-violet-200";
    case 5:
      return "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-200";
    case 6:
      return "border-rose-400/45 bg-rose-400/10 text-rose-200";
    case 7:
      return "border-amber-400/45 bg-amber-400/10 text-amber-200";
    default:
      return "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]";
  }
}

/** 層ラベルから前半/後半を判定する (ラベルは buildFloorMap が組み立てる)。 */
export function floorHalfOf(label: string): "first" | "second" | null {
  if (label.includes("前半")) return "first";
  if (label.includes("後半")) return "second";
  return null;
}

/** 戦闘時間 (秒) を `3:21` 形式に。 */
export function formatFightDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function minOrNull(values: Array<number | null>): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (out === null || v < out) out = v;
  }
  return out;
}

function maxOrNull(values: Array<number | null>): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (out === null || v > out) out = v;
  }
  return out;
}
