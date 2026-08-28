/**
 * 練習ログの集計 (TODO #94 / A-1)。純関数のみ。
 *
 * 集計するのは **PT としての到達度** だけ — pull 数 / クリア数 /
 * 到達フェーズ / ボス残 HP%。個人の火力は集計対象に入れない
 * (調査ノート §1-F: 公式が DPS メーターを実装しない方針で、晒し行為は
 * ハラスメント。固定内の空気を壊す実害の方が大きい)。
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
  startMs: number;
  endMs: number;
  reportStartMs: number | null;
};

export type DaySummary = {
  /** JST 暦日 `YYYY-MM-DD`。 */
  date: string;
  pulls: number;
  kills: number;
  /** その日の最良 (最小) 残 HP%。取得できない場合は null。 */
  bestPercentage: number | null;
  /** その日の最深到達フェーズ。 */
  bestPhase: number | null;
  /** 戦闘時間の合計 (秒)。休憩は含まない = 「実戦闘時間」。 */
  fightSeconds: number;
  fights: FightRow[];
};

export type ProgressSummary = {
  totalPulls: number;
  totalKills: number;
  bestPercentage: number | null;
  bestPhase: number | null;
  /** 初クリアの pull (時系列で最初の kill)。 */
  firstKill: FightRow | null;
  days: DaySummary[];
};

/** fight の属する日 (session_date があればそれ、無ければ JST 暦日)。 */
export function fightDate(f: FightRow): string {
  return f.sessionDate ?? jstYmdString(new Date(f.startMs));
}

export function summarize(fights: FightRow[]): ProgressSummary {
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

  const days: DaySummary[] = [];
  for (const [date, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
    days.push({
      date,
      pulls: sorted.length,
      kills: sorted.filter((f) => f.kill).length,
      bestPercentage: minOrNull(
        sorted.map((f) => (f.kill ? 0 : f.fightPercentage)),
      ),
      bestPhase: maxOrNull(sorted.map((f) => f.lastPhase)),
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
  return {
    totalPulls: fights.length,
    totalKills: fights.filter((f) => f.kill).length,
    bestPercentage: minOrNull(
      fights.map((f) => (f.kill ? 0 : f.fightPercentage)),
    ),
    bestPhase: maxOrNull(fights.map((f) => f.lastPhase)),
    firstKill: chronological.find((f) => f.kill) ?? null,
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
  isRecord: boolean;
  hasKill: boolean;
};

export function progressTimeline(days: DaySummary[]): ProgressPoint[] {
  // 古い順に走査して記録更新を判定する。
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let best: number | null = null;
  let bestPhase: number | null = null;
  const out: ProgressPoint[] = [];
  for (const d of asc) {
    const improvedPct =
      d.bestPercentage !== null && (best === null || d.bestPercentage < best);
    const improvedPhase =
      d.bestPhase !== null && (bestPhase === null || d.bestPhase > bestPhase);
    if (improvedPct) best = d.bestPercentage;
    if (improvedPhase) bestPhase = d.bestPhase;
    out.push({
      date: d.date,
      pulls: d.pulls,
      bestPercentage: d.bestPercentage,
      bestPhase: d.bestPhase,
      isRecord: improvedPct || improvedPhase,
      hasKill: d.kills > 0,
    });
  }
  return out;
}

/** 残 HP% の表示 (`12.3%`)。null は "—"。 */
export function formatPercentage(p: number | null): string {
  if (p === null) return "—";
  if (p <= 0) return "0%";
  return `${p.toFixed(1)}%`;
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
