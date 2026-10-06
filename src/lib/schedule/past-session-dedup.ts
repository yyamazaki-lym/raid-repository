/**
 * 同じ日の同じ開催が、時刻違いの rawDate で 2 行になったものをまとめる
 * (2026-10-05、本番の実機報告「日程に紐づく動画・Logs が重複する」)。
 *
 * ## 何が起きていたか
 *
 * 同期式の過去の日程は `schedule_past_sessions` に rawDate (日付 + 時刻の文字列)
 * を主キーにして溜まる。書き込みは 2 経路:
 *   - スナップショット (毎日 21:50): デイコードの開催確定の行を**未来の日も含めて**保存
 *   - Discord 取り込み (毎日 01:00): 「本日 YYYY/MM/DD(曜) HH:MM~HH:MM」の通知
 * 開催時刻を後から変える (22:00 → 21:30) と、古い時刻の行が残ったまま新しい時刻の
 * 行が増え、日付が過ぎると両方が「過去の開催」として並んでいた (本番の 10/02・10/04)。
 * 動画は日付で紐づくので 2 つのチップの両方に付き、Logs・メモは片方の rawDate にだけ
 * 付く。
 *
 * ## まとめ方
 *
 * - **同じ JST 暦日で、時間帯が重なる行**を同じ開催とみなす。重ならない行
 *   (昼と夜の 2 回開催) はまとめない
 * - デイコードに今ある行が最優先 (その rawDate を残す)。無ければ、出欠の
 *   スナップショットを持つ行 → 新しく作られた行 → 出どころ (手動 > スナップ
 *   ショット > Discord) の順で 1 つを残す。時刻を直した後に作られた行が新しい
 * - まとめた rawDate → 残した rawDate の対応 (`aliasOf`) を返し、Logs・メモの
 *   付け先を残した行に寄せられるようにする (`foldAliasedKeys`)
 *
 * データは消さない (表示と、表示から読む処理だけをそろえる)。
 *
 * `@/` を import しない純モジュール (`scripts/check-past-session-dedup.mjs`)。
 */
import { jstYmdString } from "../jst-date";

/** まとめる判定に使う 1 行。 */
export type SameDayCandidate = {
  rawDate: string;
  /** 開始時刻 (epoch ms)。日付の判定に使う。 */
  startMs: number;
  /** `21:30` */
  startTime: string;
  /** `0:00` (開始より前なら翌日とみなす) */
  endTime: string;
};

/** 保存済みの過去の行 (`schedule_past_sessions`)。 */
export type StoredCandidate = SameDayCandidate & {
  /** 出欠のスナップショットを持つか。 */
  hasAttendances: boolean;
  /** 行を作った時刻 (ISO)。無ければ null。 */
  createdAt: string | null;
  /** `manual` / `snapshot` / `discord`。 */
  source: string | null;
};

const DAY_MINUTES = 24 * 60;

function clockMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 時間帯 (分)。終わりが始まり以下なら翌日 (`21:30~0:00` → 1290〜1440)。
 * 時刻が読めなければ null (まとめの対象にしない)。
 */
export function sessionMinutes(
  startTime: string,
  endTime: string,
): { start: number; end: number } | null {
  const s = clockMinutes(startTime);
  const e = clockMinutes(endTime);
  if (s === null || e === null) return null;
  return { start: s, end: e <= s ? e + DAY_MINUTES : e };
}

/** 2 つの時間帯が重なるか (端が触れるだけは重ならない)。 */
export function timeRangesOverlap(a: SameDayCandidate, b: SameDayCandidate): boolean {
  const ra = sessionMinutes(a.startTime, a.endTime);
  const rb = sessionMinutes(b.startTime, b.endTime);
  if (!ra || !rb) return false;
  return ra.start < rb.end && rb.start < ra.end;
}

function dayKey(c: SameDayCandidate): string {
  return jstYmdString(new Date(c.startMs));
}

/** 同じ開催とみなすか (同じ JST 暦日 + 時間帯が重なる)。 */
export function isSameSession(a: SameDayCandidate, b: SameDayCandidate): boolean {
  return dayKey(a) === dayKey(b) && timeRangesOverlap(a, b);
}

const SOURCE_RANK: Record<string, number> = { manual: 3, snapshot: 2, discord: 1 };

/** 残す行の順位 (前ほど優先)。 */
function compareStoredPreference(a: StoredCandidate, b: StoredCandidate): number {
  if (a.hasAttendances !== b.hasAttendances) return a.hasAttendances ? -1 : 1;
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (Number.isFinite(ta) || Number.isFinite(tb)) {
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    if (ta !== tb) return tb - ta;
  }
  const sa = SOURCE_RANK[a.source ?? ""] ?? 0;
  const sb = SOURCE_RANK[b.source ?? ""] ?? 0;
  if (sa !== sb) return sb - sa;
  return a.rawDate.localeCompare(b.rawDate);
}

export type PastSessionMergePlan = {
  /** 保存済みの行のうち、デイコードの行に重ならず表示に足す行 (開催 1 つにつき 1 行)。 */
  additions: StoredCandidate[];
  /** デイコードの行のうち、同じ開催の保存済みの行がある (= 実開催の証拠がある) もの。 */
  verifiedSheetRawDates: Set<string>;
  /** まとめた rawDate → 残した rawDate。 */
  aliasOf: Record<string, string>;
};

/**
 * デイコードの行 (`sheet`) と保存済みの過去の行 (`stored`) を、同じ開催ごとに
 * 1 つにまとめる計画を立てる。
 *
 * `excluded` (2026-10-06): 過去ログから除外した行 (`excluded_at` あり)。
 * **除外した行と同じ開催の行も**表示に出さない (実開催の証拠にも数えない)。
 * 除外は rawDate 1 行にしか印を付けないので、時刻違いで重複していたもう一方の
 * 行 (本番の 10/02: 21:30 を除外 → 22:00 が代わりに出た) が残っていた。
 */
export function planPastSessionMerge(input: {
  sheet: ReadonlyArray<SameDayCandidate>;
  stored: ReadonlyArray<StoredCandidate>;
  excluded?: ReadonlyArray<SameDayCandidate>;
}): PastSessionMergePlan {
  const verifiedSheetRawDates = new Set<string>();
  const aliasOf: Record<string, string> = {};
  const rest: StoredCandidate[] = [];
  const excluded = input.excluded ?? [];
  const isExcluded = (c: SameDayCandidate) =>
    excluded.some((e) => e.rawDate === c.rawDate || isSameSession(e, c));
  // 0. 除外した開催の行は、保存済みの行も、それを証拠にするデイコードの行も外す。
  const stored = input.stored.filter((r) => !isExcluded(r));
  const sheet = input.sheet.filter((s) => !isExcluded(s));

  // 1. デイコードの行に重なる保存済みの行は、デイコードの行にまとめる。
  for (const r of stored) {
    const matches = sheet.filter((s) => s.rawDate === r.rawDate || isSameSession(s, r));
    if (matches.length === 0) {
      rest.push(r);
      continue;
    }
    // 同じ rawDate があればそれ、無ければ開始時刻が近い行。
    const target =
      matches.find((s) => s.rawDate === r.rawDate) ??
      [...matches].sort((a, b) => Math.abs(a.startMs - r.startMs) - Math.abs(b.startMs - r.startMs))[0]!;
    verifiedSheetRawDates.add(target.rawDate);
    if (r.rawDate !== target.rawDate) aliasOf[r.rawDate] = target.rawDate;
  }

  // 2. 残りは保存済みの行どうしで、同じ開催を 1 つにまとめる。
  const byDay = new Map<string, StoredCandidate[]>();
  for (const r of rest) byDay.set(dayKey(r), [...(byDay.get(dayKey(r)) ?? []), r]);
  const additions: StoredCandidate[] = [];
  for (const rows of byDay.values()) {
    const clusters: StoredCandidate[][] = [];
    for (const r of rows) {
      const hit = clusters.find((c) => c.some((x) => timeRangesOverlap(x, r)));
      if (hit) hit.push(r);
      else clusters.push([r]);
    }
    for (const c of clusters) {
      const [keep, ...others] = [...c].sort(compareStoredPreference);
      additions.push(keep!);
      for (const o of others) aliasOf[o.rawDate] = keep!.rawDate;
    }
  }
  return { additions, verifiedSheetRawDates, aliasOf };
}

/**
 * rawDate を鍵にした対応表 (Logs・メモ) を、まとめた先の rawDate に寄せる。
 * 同じ先に寄せた配列は連結する (`dedupeBy` があれば同じ鍵の要素は 1 つにする)。
 */
export function foldAliasedKeys<T>(
  map: Readonly<Record<string, ReadonlyArray<T>>>,
  aliasOf: Readonly<Record<string, string>>,
  dedupeBy?: (item: T) => string,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [key, items] of Object.entries(map)) {
    const target = aliasOf[key] ?? key;
    const list = (out[target] ??= []);
    for (const item of items) {
      if (dedupeBy && list.some((x) => dedupeBy(x) === dedupeBy(item))) continue;
      list.push(item);
    }
  }
  return out;
}
