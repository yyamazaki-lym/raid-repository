/**
 * 公式メンテナンス / パッチ日程の登録と衝突判定 (W-30、2026-09-07)。
 *
 * 「今夜メンテだった」を防ぐのが目的 (調査ノート第 4 回 W-30)。公式に
 * 機械可読な API は無いので **手入力**する。Lodestone のトピック監視まで
 * 自動化すると scrape 依存になり、告知ページの構造変更で黙って壊れる —
 * 年に数回の入力で足りるものに、その保守コストは見合わない。
 *
 * 値は `app_settings` の 1 キーに JSON 配列で持つ (専用テーブルを作るほどの
 * 量ではない。多くても年 20〜30 件)。
 *
 * 検証: `node scripts/check-maintenance-schedule.mjs`
 */

/** `app_settings` のキー。値は `MaintenanceWindow[]` の JSON。 */
export const MAINTENANCE_WINDOWS_KEY = "maintenance_windows";

/** 登録できる件数の上限 (設定 1 行に収める前提の安全弁)。 */
export const MAINTENANCE_MAX_WINDOWS = 40;

export type MaintenanceWindow = {
  /** 開始 (JST の `YYYY-MM-DDTHH:mm`)。 */
  start: string;
  /** 終了 (JST の `YYYY-MM-DDTHH:mm`)。開始と同じか後。 */
  end: string;
  /** 表示ラベル (「7.56 パッチメンテ」など)。空なら UI が既定文を出す。 */
  label?: string;
};

/** `YYYY-MM-DDTHH:mm` (JST、秒なし)。 */
const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isMaintenanceDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = LOCAL_DT_RE.exec(v);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59) return false;
  // 実在しない日 (2/30 等) を弾く。UTC で組んで日付が繰り上がったら不正。
  const probe = new Date(Date.UTC(Number(y), month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * JST のローカル日時文字列を UTC ミリ秒にする。
 * FF14 のメンテ告知は JST 基準で、DST も無いので固定オフセットで足りる。
 */
export function maintenanceMs(local: string): number | null {
  const m = LOCAL_DT_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) -
    9 * 60 * 60 * 1000
  );
}

/**
 * 設定値 (JSON 文字列) を正規化して読む。
 *
 * 不正な要素は**黙って捨てる** — メンテ日程は「出れば助かる」情報で、
 * 1 件の入力ミスで画面が壊れる方が困る。開始 > 終了の行も捨てる。
 * 並びは開始時刻の昇順に揃える (UI が並べ替えなくていいように)。
 */
export function parseMaintenanceWindows(
  raw: string | null | undefined,
): MaintenanceWindow[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MaintenanceWindow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!isMaintenanceDateTime(o.start) || !isMaintenanceDateTime(o.end)) continue;
    const startMs = maintenanceMs(o.start);
    const endMs = maintenanceMs(o.end);
    if (startMs === null || endMs === null || endMs < startMs) continue;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 60) : "";
    out.push({ start: o.start, end: o.end, ...(label ? { label } : {}) });
    if (out.length >= MAINTENANCE_MAX_WINDOWS) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 活動予定 (開始 / 終了の UTC ミリ秒) がメンテ枠と重なるか。
 *
 * 重なりの判定は**半開区間** `[start, end)` — メンテ終了ちょうどに始まる
 * 活動は衝突ではない (むしろ「明けたら集合」の運用がある)。
 */
export function overlappingMaintenance(
  windows: ReadonlyArray<MaintenanceWindow>,
  sessionStartMs: number,
  sessionEndMs: number,
): MaintenanceWindow[] {
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) {
    return [];
  }
  const from = Math.min(sessionStartMs, sessionEndMs);
  const to = Math.max(sessionStartMs, sessionEndMs);
  return windows.filter((w) => {
    const ws = maintenanceMs(w.start);
    const we = maintenanceMs(w.end);
    if (ws === null || we === null) return false;
    return ws < to && from < we;
  });
}

/** 表示用の期間ラベル (`9/8(火) 12:00 〜 22:00` / 日跨ぎは日付を両方)。 */
export function formatMaintenanceRange(
  w: MaintenanceWindow,
  locale: "ja" | "en" = "ja",
): string {
  const s = LOCAL_DT_RE.exec(w.start);
  const e = LOCAL_DT_RE.exec(w.end);
  if (!s || !e) return `${w.start} - ${w.end}`;
  const sameDay = w.start.slice(0, 10) === w.end.slice(0, 10);
  const dow = weekday(w.start, locale);
  const head =
    locale === "en"
      ? `${Number(s[2])}/${Number(s[3])} (${dow})`
      : `${Number(s[2])}/${Number(s[3])}(${dow})`;
  const tail = sameDay
    ? `${e[4]}:${e[5]}`
    : locale === "en"
      ? `${Number(e[2])}/${Number(e[3])} ${e[4]}:${e[5]}`
      : `${Number(e[2])}/${Number(e[3])} ${e[4]}:${e[5]}`;
  return locale === "en"
    ? `${head} ${s[4]}:${s[5]} - ${tail}`
    : `${head} ${s[4]}:${s[5]} 〜 ${tail}`;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekday(local: string, locale: "ja" | "en"): string {
  const m = LOCAL_DT_RE.exec(local);
  if (!m) return "";
  const idx = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
  return (locale === "en" ? WEEKDAY_EN : WEEKDAY_JA)[idx] ?? "";
}
