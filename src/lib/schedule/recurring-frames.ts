/**
 * 定期枠 (W-15、2026-09-08)。純関数のみ。
 *
 * 調査ノート第 4 回 7-B W-15「定期枠テンプレ + 例外 (毎週 X 曜 21:00 を
 * 期間 + 曜日で一括生成、「今週スキップ」「今回だけ 22:00」)」。
 *
 * ## いま何が起きているか
 *
 * native モードは 2026-05-12 (TODO #81) から **当月の全日付**を候補日として
 * auto-insert している。「毎週の候補日入力が消える」という W-15 の狙いは
 * これで一応満たされているが、代わりに**活動しない曜日まで全部並ぶ**。
 * 週 3 日の固定なら 1 か月 30 行のうち 21 行が無関係で、出欠表が縦に伸びる
 * ぶんだけ「次にどこを埋めればいいか」が読みにくい。
 *
 * そこで「うちは火・木・土」を設定できるようにして、**その曜日だけ**
 * placeholder を作る。未設定なら従来どおり全日 (既存デプロイの挙動を
 * 変えない)。
 *
 * ## 時刻は持たない
 *
 * 枠が持つのは**曜日だけ**で、時刻は既存の
 * `app_settings.native_schedule_default_{start,end}_time` を使う。
 *
 * 理由: placeholder の `raw_date` は `YYYY/MM/DD(曜) HH:MM~HH:MM` と時刻を
 * 焼き込む形で、default 時刻を変えたときの遡及更新 (`13d` 節の
 * `update_native_placeholder_raid_times`) が「`start_time`/`end_time` が
 * どちらも NULL の行」= 時刻を持たない placeholder だけを対象にしている。
 * 枠ごとに時刻を持たせると placeholder に NOT NULL の時刻を入れることになり、
 * (a) default 変更に追従しなくなり (b) 画面上は日個別の override
 * (=「今回だけ」) と見分けが付かなくなる。
 *
 * 曜日ごとに時刻を変えたい場合は、下の `expandRecurringDates` を使う
 * **一括生成**で時刻を明示して作る (= 手動の候補日と同じ扱いになる)。
 *
 * ## 例外操作
 *
 * 「今週スキップ」= その行を CANCELLED にする (既存の status トグル)。
 * 「今回だけ 22:00」= その行に日個別の時刻 override を入れる (既存の
 * `session-time-edit-popover`)。どちらも既にある操作なので、W-15 で足すのは
 * **それが例外だと画面で分かること** — `frameDeviation()` が判定する。
 *
 * 検証: `node scripts/check-recurring-frames.mjs`
 */

/** `app_settings` のキー (定期枠の曜日 CSV)。 */
export const NATIVE_RECURRING_DOWS_KEY = "native_schedule_recurring_dows";

/** 曜日 index (0 = 日 .. 6 = 土)。JS の `Date#getDay()` と同じ。 */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DOW_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const DOW_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 曜日ラベル (`raw_date` の `(火)` と同じ 1 文字 / en は 3 文字)。 */
export function dowLabel(dow: number, locale: "ja" | "en" = "ja"): string {
  const i = ((dow % 7) + 7) % 7;
  return locale === "en" ? DOW_LABELS_EN[i]! : DOW_LABELS_JA[i]!;
}

/**
 * 保存値 (CSV) → 曜日の配列。昇順・重複なし。
 *
 * 空 / 未設定 / 全部が不正なら空配列 = **定期枠なし**で、呼び出し側は
 * 従来どおり全日を対象にする。「0 件の枠」と「未設定」を区別しないのは、
 * 曜日を全部外した状態を「候補日を 1 つも作らない」と解釈すると、設定を
 * いじった瞬間に予定表が空になって戻せなくなるため。
 */
export function parseRecurringDows(raw: string | null | undefined): Dow[] {
  if (!raw) return [];
  const out = new Set<number>();
  for (const part of raw.split(/[,\s]+/)) {
    const t = part.trim();
    if (!/^[0-6]$/.test(t)) continue;
    out.add(Number(t));
  }
  return [...out].sort((a, b) => a - b) as Dow[];
}

/** 曜日の配列 → 保存値 (CSV)。 */
export function serializeRecurringDows(dows: ReadonlyArray<number>): string {
  return parseRecurringDows(dows.join(",")).join(",");
}

/** その曜日が定期枠か。枠が空なら **常に true** (= 全日が対象)。 */
export function isRecurringDow(
  dows: ReadonlyArray<number>,
  dow: number,
): boolean {
  if (dows.length === 0) return true;
  return dows.includes(((dow % 7) + 7) % 7);
}

/** 定期枠の説明文 (「毎週 火・木・土」)。枠が空なら null。 */
export function describeRecurringDows(
  dows: ReadonlyArray<number>,
  locale: "ja" | "en" = "ja",
): string | null {
  const parsed = parseRecurringDows(dows.join(","));
  if (parsed.length === 0) return null;
  return parsed.map((d) => dowLabel(d, locale)).join(locale === "en" ? ", " : "・");
}

/**
 * 曜日ラベル (`raw_date` の `(火)`) → 曜日 index。未知の文字は null。
 *
 * 予定表の行から曜日を出すときは **この関数を使う** — `parsed_date` から
 * `Date#getDay()` を取ると閲覧者のタイムゾーンで曜日が動きうる (JST 21:00
 * 開始のセッションを UTC で見ると前日になる)。`raw_date` に焼き込まれた
 * 曜日は生成時に JST で決まっているので、そちらが正。
 */
export function dowIndexFromLabel(label: string | null | undefined): Dow | null {
  const t = (label ?? "").trim();
  const i = DOW_LABELS_JA.indexOf(t as (typeof DOW_LABELS_JA)[number]);
  if (i >= 0) return i as Dow;
  const j = DOW_LABELS_EN.indexOf(t as (typeof DOW_LABELS_EN)[number]);
  return j >= 0 ? (j as Dow) : null;
}

/** 一括生成の 1 件 (JST の暦日)。 */
export type RecurringDate = { y: number; m: number; d: number; dow: Dow };

/** 一括生成で 1 度に作れる上限 (誤入力で数百行入るのを防ぐ)。 */
export const RECURRING_MAX_DATES = 120;

/**
 * 期間 (両端含む) × 曜日 → 日付の配列 (昇順)。
 *
 * `from` / `to` は `<input type="date">` の値 (`YYYY-MM-DD`) を想定。
 * 曜日の判定は**カレンダー日付そのもの**で行う (閲覧者の TZ に依存しない
 * よう `Date.UTC` で組み立てる — ローカル TZ の `new Date(y, m, d)` は
 * 日付が変わらないので曜日も同じだが、UTC で統一しておくと
 * サーバー側から呼んでも同じ結果になる)。
 *
 * 不正な期間 (逆順 / 形式違い) は空配列。件数は `RECURRING_MAX_DATES` で
 * 打ち切る (呼び出し側が「多すぎます」を出せるよう `truncated` を返す)。
 */
export function expandRecurringDates(
  from: string,
  to: string,
  dows: ReadonlyArray<number>,
): { dates: RecurringDate[]; truncated: boolean } {
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (!start || !end) return { dates: [], truncated: false };
  const startMs = Date.UTC(start.y, start.m - 1, start.d);
  const endMs = Date.UTC(end.y, end.m - 1, end.d);
  if (endMs < startMs) return { dates: [], truncated: false };
  const want = parseRecurringDows(dows.join(","));
  if (want.length === 0) return { dates: [], truncated: false };

  const dates: RecurringDate[] = [];
  let truncated = false;
  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    const dt = new Date(ms);
    const dow = dt.getUTCDay() as Dow;
    if (!want.includes(dow)) continue;
    if (dates.length >= RECURRING_MAX_DATES) {
      truncated = true;
      break;
    }
    dates.push({
      y: dt.getUTCFullYear(),
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      dow,
    });
  }
  return { dates, truncated };
}

function parseYmd(raw: string | null | undefined): {
  y: number;
  m: number;
  d: number;
} | null {
  const t = (raw ?? "").trim();
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // 2 月 30 日のような存在しない日付を弾く (Date が翌月へ繰り上げるため)。
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** 定期枠に対する「例外」の種類 (W-15)。 */
export type FrameDeviation =
  /** 定期枠どおり (既定時刻・開催予定)。 */
  | "none"
  /** 定期枠の曜日だが時刻を変えている (「今回だけ 22:00」)。 */
  | "time"
  /** 定期枠の曜日ではない臨時の枠 (「今週だけ日曜も」)。 */
  | "extra";

/**
 * その日が定期枠から外れているか (W-15)。
 *
 * 「今週スキップ」は `status = CANCELLED` で、その行は一覧から消えるので
 * ここでは扱わない (取り消した日の一覧は設定画面の
 * `native-cancelled-sessions-section` にある)。
 *
 * `hasTimeOverride` は「その行が日個別の時刻を持っているか」
 * (`start_time` / `end_time` が NOT NULL)。placeholder と一括生成の既定は
 * NULL なので、NOT NULL は人が明示的に変えた印になる。
 */
export function frameDeviation(opts: {
  dows: ReadonlyArray<number>;
  dow: number;
  hasTimeOverride: boolean;
}): FrameDeviation {
  const parsed = parseRecurringDows(opts.dows.join(","));
  // 枠が未設定なら「定期枠から外れている」という概念自体が無い。
  if (parsed.length === 0) return "none";
  if (!parsed.includes((((opts.dow % 7) + 7) % 7) as Dow)) return "extra";
  return opts.hasTimeOverride ? "time" : "none";
}
