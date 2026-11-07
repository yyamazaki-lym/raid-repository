/**
 * 練習ログの手動の記録と「ログが欠けている日」(2026-11-08)。純関数のみ。
 *
 * ACT が使えなかった日は FFLogs にログを上げられず、練習ログの集計 (総 pull・
 * 層ごとの pull・練習日数・ログ合計・到達度・討伐数) からその日がまるごと抜ける。
 * その日の分を **日単位の要約** で手動で足す (ユーザーの選択「日の要約」)。
 *
 * ## 何を持つか (1 日 1 行、`practice_log_manual_days`)
 *
 * - 区間 (零式の層 / 絶のフェーズ) ごとの pull 数・討伐数・最良の残 HP%
 * - 練習時間 (分)。ログ合計に足す
 * - メモ (なぜ手動か)
 *
 * ⚠ **pull 1 本ずつの偽の行は作らない。** pull の時刻・戦闘時間・死亡数・ワイプ
 * 原因は分からないので、それらを使う集計 (戦闘時間・最速討伐・ノーデス・ワイプ
 * 原因・フェーズ滞在時間・プル箱) には入らない。日単位で決まるもの (数・到達・
 * 討伐・日数・ログ合計) だけに足す。偽の行を `fflogs_fights` に入れる案は、同期・
 * 重複の判定・動画・注釈が全部 FFLogs のレポートを前提にしているので選ばなかった。
 *
 * ## 区間のキー
 *
 * 零式は層を **FFLogs の encounter ID** で持つ (層の番号は、練習ログが出てきた
 * encounter の最小から数えるので、あとで下の層のログが入るとずれる)。絶は
 * フェーズの番号。どちらも分からなければ null (「不明」として数だけ入る)。
 *
 * `@/` を import しない (`scripts/check-practice-log-manual.mjs` が単体で
 * コンパイルする)。
 */

/** 区間 1 つぶんの手動の記録。 */
export type ManualSegment = {
  /** 零式 (層モデル): その層の FFLogs encounter ID。層が分からなければ null。 */
  encounterId: number | null;
  /** 絶 (フェーズモデル): 到達したフェーズ。分からなければ null。 */
  phase: number | null;
  /** その区間の pull 数 (討伐を含む)。 */
  pulls: number;
  /** 討伐数 (零式はその層の討伐、絶は討伐)。`pulls` 以下。 */
  kills: number;
  /** 最良の残 HP% (0-100)。討伐があれば 0 とみなす。分からなければ null。 */
  bestPercentage: number | null;
};

/** 1 日ぶんの手動の記録。 */
export type ManualDay = {
  id: string;
  /** 練習日 (`YYYY-MM-DD`)。 */
  date: string;
  segments: ManualSegment[];
  /** 練習時間 (分)。ログ合計に足す。分からなければ null。 */
  logMinutes: number | null;
  note: string | null;
};

/** 1 日に持てる区間の数 (零式は 5 層ぶん、絶は 7 フェーズ + 不明で足りる)。 */
export const MANUAL_MAX_SEGMENTS = 12;
/** 1 区間の pull 数の上限 (1 晩で数百は超えない。打ち間違いを止める)。 */
export const MANUAL_MAX_PULLS = 500;
/** 練習時間の上限 (分)。1 日 = 1440 分。 */
export const MANUAL_MAX_MINUTES = 1440;
/** メモの上限 (文字)。日付メモ・ミス注釈と同じ 200。 */
export const MANUAL_NOTE_MAX = 200;
/** フェーズ番号の上限 (絶は 7 前後。打ち間違いを止める)。 */
export const MANUAL_MAX_PHASE = 20;

/** 区間の pull 数の合計。 */
export function manualDayPulls(day: Pick<ManualDay, "segments">): number {
  return day.segments.reduce((acc, s) => acc + s.pulls, 0);
}

/** 区間の討伐数の合計 (零式なら下の層の討伐も含む)。 */
export function manualDayKills(day: Pick<ManualDay, "segments">): number {
  return day.segments.reduce((acc, s) => acc + s.kills, 0);
}

/** 練習時間 (ms)。分からなければ 0。 */
export function manualDayLogMs(day: Pick<ManualDay, "logMinutes">): number {
  return day.logMinutes !== null && day.logMinutes > 0 ? day.logMinutes * 60_000 : 0;
}

/** 区間の残 HP% (討伐があれば 0)。 */
export function manualSegmentPercentage(s: ManualSegment): number | null {
  return s.kills > 0 ? 0 : s.bestPercentage;
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * DB の jsonb (`[{ "encounter": 101, "phase": null, "pulls": 12, "kills": 2,
 * "best": 23.4 }]`) を読む。形の壊れた要素は捨てる (表示側を壊さない。書き込みは
 * `validateManualDayInput` を通る)。
 */
export function parseManualSegments(raw: unknown): ManualSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const pulls = intOrNull(r.pulls);
    const kills = intOrNull(r.kills) ?? 0;
    if (pulls === null || pulls <= 0 || kills < 0 || kills > pulls) continue;
    const best = numOrNull(r.best);
    out.push({
      encounterId: intOrNull(r.encounter),
      phase: intOrNull(r.phase),
      pulls,
      kills,
      bestPercentage: best !== null && best >= 0 && best <= 100 ? best : null,
    });
  }
  return out;
}

/** DB に書く jsonb の形 (`parseManualSegments` の逆)。 */
export function toStoredSegments(segments: ReadonlyArray<ManualSegment>): Array<{
  encounter: number | null;
  phase: number | null;
  pulls: number;
  kills: number;
  best: number | null;
}> {
  return segments.map((s) => ({
    encounter: s.encounterId,
    phase: s.phase,
    pulls: s.pulls,
    kills: s.kills,
    best: s.bestPercentage,
  }));
}

/** 入力の誤り。表示の文言は呼び出し側 (Action / 画面) が持つ。 */
export type ManualDayInputError =
  | "date"
  | "future"
  | "segments"
  | "pulls"
  | "kills"
  | "percentage"
  | "segmentKey"
  | "duplicateSegment"
  | "minutes"
  | "note";

export type ManualDayInput = {
  date: unknown;
  segments: unknown;
  logMinutes: unknown;
  note: unknown;
};

export type ManualDayValue = {
  date: string;
  segments: ManualSegment[];
  logMinutes: number | null;
  note: string | null;
};

/** `YYYY-MM-DD` で、暦に実在する日か。 */
export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 区間を見分けるキー (同じ区間の 2 行を止める)。 */
function segmentKey(s: Pick<ManualSegment, "encounterId" | "phase">): string {
  return `${s.encounterId ?? "-"}:${s.phase ?? "-"}`;
}

/**
 * 画面 / Server Action からの入力を検める (client の値なので型から疑う)。
 * `today` は JST の今日 (`YYYY-MM-DD`)。未来の日は記録できない (練習していない)。
 */
export function validateManualDayInput(
  input: ManualDayInput,
  today: string,
): { ok: true; value: ManualDayValue } | { ok: false; error: ManualDayInputError } {
  if (!isYmd(input.date)) return { ok: false, error: "date" };
  if (input.date > today) return { ok: false, error: "future" };
  if (!Array.isArray(input.segments)) return { ok: false, error: "segments" };
  if (input.segments.length === 0 || input.segments.length > MANUAL_MAX_SEGMENTS) {
    return { ok: false, error: "segments" };
  }
  const segments: ManualSegment[] = [];
  const keys = new Set<string>();
  for (const raw of input.segments) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "segments" };
    const r = raw as Record<string, unknown>;
    const pulls = r.pulls;
    const kills = r.kills ?? 0;
    if (typeof pulls !== "number" || !Number.isInteger(pulls) || pulls < 1 || pulls > MANUAL_MAX_PULLS) {
      return { ok: false, error: "pulls" };
    }
    if (typeof kills !== "number" || !Number.isInteger(kills) || kills < 0 || kills > pulls) {
      return { ok: false, error: "kills" };
    }
    const best = r.bestPercentage ?? null;
    if (best !== null && (typeof best !== "number" || !Number.isFinite(best) || best < 0 || best > 100)) {
      return { ok: false, error: "percentage" };
    }
    const encounterId = r.encounterId ?? null;
    const phase = r.phase ?? null;
    if (
      encounterId !== null &&
      (typeof encounterId !== "number" || !Number.isInteger(encounterId) || encounterId <= 0)
    ) {
      return { ok: false, error: "segmentKey" };
    }
    if (
      phase !== null &&
      (typeof phase !== "number" || !Number.isInteger(phase) || phase < 1 || phase > MANUAL_MAX_PHASE)
    ) {
      return { ok: false, error: "segmentKey" };
    }
    // 層とフェーズの両方を持つ区間は作らない (コンテンツはどちらかのモデル)。
    if (encounterId !== null && phase !== null) return { ok: false, error: "segmentKey" };
    const seg: ManualSegment = {
      encounterId: encounterId as number | null,
      phase: phase as number | null,
      pulls,
      kills,
      // 小数第 2 位まで (FFLogs の残 HP% と同じ桁)。
      bestPercentage: best === null ? null : Math.round((best as number) * 100) / 100,
    };
    const key = segmentKey(seg);
    if (keys.has(key)) return { ok: false, error: "duplicateSegment" };
    keys.add(key);
    segments.push(seg);
  }
  let logMinutes: number | null = null;
  if (input.logMinutes !== null && input.logMinutes !== undefined && input.logMinutes !== "") {
    const v = input.logMinutes;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MANUAL_MAX_MINUTES) {
      return { ok: false, error: "minutes" };
    }
    logMinutes = v > 0 ? v : null;
  }
  let note: string | null = null;
  if (input.note !== null && input.note !== undefined) {
    if (typeof input.note !== "string") return { ok: false, error: "note" };
    const t = input.note.trim();
    // 制御文字 (改行を含む) は入れない (DB の CHECK と同じ)。
     
    if (t.length > MANUAL_NOTE_MAX || /[\u0000-\u001f\u007f]/.test(t)) {
      return { ok: false, error: "note" };
    }
    note = t.length > 0 ? t : null;
  }
  return { ok: true, value: { date: input.date, segments, logMinutes, note } };
}

// ---------------------------------------------------------------------------
// ログが欠けている日 (ユーザーの選択「開催日でどこにもログ無し」)
// ---------------------------------------------------------------------------

/** スケジュールの開催日 (確定・中止でない・有志練習でない)。 */
export type HeldScheduleDay = {
  /** JST 暦日 (`YYYY-MM-DD`)。 */
  date: string;
  /** 表示用 (`2026/09/09(水) 21:00~23:00`)。 */
  label: string;
};

/** 練習した日 (ログか手動の記録がある日)。カテゴリの無いログは null。 */
export type PracticeDayRef = {
  categoryId: string | null;
  date: string;
};

export type MissingDaysResult = {
  /** 判定した範囲 (このコンテンツの最初の練習日から)。練習が 1 日も無ければ null。 */
  from: string | null;
  to: string | null;
  /** 欠けている日 (新しい順)。同じ日の開催は 1 つにまとめる。 */
  days: HeldScheduleDay[];
};

/**
 * ログが欠けている日 = 開催日のうち、**どのコンテンツにも**ログも手動の記録も
 * 無い日。
 *
 * - スケジュールはコンテンツに紐づいていない。「このコンテンツに無い日」で
 *   出すと、別のコンテンツを回した日まで欠けて見えるので、どこにも無い日だけ
 * - 範囲はこのコンテンツの最初の練習日から。終わりは、このコンテンツより後に
 *   別のコンテンツを練習していれば このコンテンツの最後の練習日、そうでなければ
 *   `today` の前日まで。ティアを移ったあとの空き日が、古いコンテンツの画面に
 *   出続けないようにする (並行して回しているときは最後に練習した方に出る)
 * - 今日は出さない (夜の練習の前で、ログは翌朝の同期で入る)
 * - カテゴリの無いログ (どのコンテンツにも割り当てられていないレポート) がある
 *   日も「ログがある」とみなす (欠けているのは分類で、ログではない)
 */
export function missingPracticeDays(input: {
  categoryId: string;
  heldDays: ReadonlyArray<HeldScheduleDay>;
  practiceDays: ReadonlyArray<PracticeDayRef>;
  /** JST の今日 (`YYYY-MM-DD`)。 */
  today: string;
}): MissingDaysResult {
  const mine = input.practiceDays
    .filter((p) => p.categoryId === input.categoryId && isYmd(p.date))
    .map((p) => p.date)
    .sort();
  if (mine.length === 0) return { from: null, to: null, days: [] };
  const first = mine[0]!;
  const last = mine[mine.length - 1]!;
  const othersAfter = input.practiceDays.some(
    (p) => p.categoryId !== null && p.categoryId !== input.categoryId && p.date > last,
  );
  const to = othersAfter ? last : input.today;
  const covered = new Set(input.practiceDays.map((p) => p.date));
  const byDate = new Map<string, HeldScheduleDay>();
  for (const d of input.heldDays) {
    if (!isYmd(d.date)) continue;
    if (d.date < first || d.date > to || d.date >= input.today) continue;
    if (covered.has(d.date)) continue;
    const cur = byDate.get(d.date);
    // 同じ日に 2 つのスケジュールが開催していれば 1 行にまとめる。
    byDate.set(d.date, cur ? { date: d.date, label: `${cur.label} / ${d.label}` } : d);
  }
  return {
    from: first,
    to,
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
