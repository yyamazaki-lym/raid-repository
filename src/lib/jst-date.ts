/**
 * 閲覧者のブラウザ TZ に依存せず「JST(Asia/Tokyo) の暦日・時刻」を取り出す
 * 共通ヘルパー。
 *
 * このアプリの日付はすべて JST 基準 (raid の開催日 = 日本の暦日)。動画タイトル
 * から抽出される日付 (`title-date.ts`) も JST 暦日なので、`first_clear_at`
 * のような UTC 保存の instant から「クリア日の動画」を引く際は、閲覧者の壁時計
 * ではなく **JST の暦日** に正規化しないと非 JST 環境で 1 日ずれる。
 *
 * 既存の同義パターン: サーバ側の +9h オフセット演算 (`schedule/jst-cutoff.ts`)、
 * deploy バッジの `Intl(Asia/Tokyo)` (`deploy-color-badge.tsx`)。本ファイルは
 * その「ISO/Date → JST 暦日」変換を 1 箇所に集約したもの。JST は DST が無いので
 * `Intl(Asia/Tokyo)` は固定 +9h と常に一致する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 1 つの formatter を使い回す (生成コスト回避)。各関数は必要な part のみ読む。
const JST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

export type JstYmd = { y: number; m: number; d: number };

function partsOf(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of JST_PARTS.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** JST の暦日 (年 / 月 1-12 / 日) を返す。日付キー照合に使う。 */
export function jstYmd(date: Date): JstYmd {
  const p = partsOf(date);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** JST の暦日を `YYYY-MM-DD` 文字列で返す。 */
export function jstYmdString(date: Date): string {
  const { y, m, d } = jstYmd(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** JST の `YYYY-MM-DD HH:mm` を返す (最終同期時刻などの表示用)。 */
export function jstDateTimeString(date: Date): string {
  const p = partsOf(date);
  // hour12:false の 24h 表記で稀に "24" が出る環境向けに 0 時へ正規化。
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}`;
}

const WD_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** JST の曜日 index (0=日 .. 6=土)。 */
export function jstWeekday(date: Date): number {
  return WD_INDEX[partsOf(date).weekday ?? "Sun"] ?? 0;
}

/**
 * JST の `y-m-d 00:00`(深夜) を表す UTC ISO 文字列を返す。
 * `<input type="date">` の値 (`YYYY-MM-DD`) を保存用 ISO に変換する際、
 * 閲覧者の TZ に依存せず常に JST 暦日基準で round-trip させるために使う。
 */
export function jstMidnightIso(y: number, m: number, d: number): string {
  return new Date(
    Date.UTC(y, m - 1, d, 0, 0, 0, 0) - JST_OFFSET_MS,
  ).toISOString();
}
