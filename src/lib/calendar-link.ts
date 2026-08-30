/**
 * 予定をカレンダーアプリに登録するためのリンク生成 (2026-08-30、Tier2-9)。
 *
 * 調査 第3回 D-3 で見た TimeTree 運用 (固定の予定をカレンダー共有する)
 * の代替として、portal 側は **1 クリックで Google カレンダーの追加画面に
 * 飛ぶテンプレート URL** を出す。portal に予定があるのは変わらないので、
 * ここでやるのは「スマホのカレンダーにも置きたい人向けの導線」だけ。
 *
 * 外部依存なしの純関数。iCal (.ics) 配信はサーバー実装が要るうえ、
 * 認証付き portal の予定を外部 URL で撒くことになるため採らない。
 */

/** 終了時刻が翌日にまたがるか (例: 22:00 開始 → 0:00 終了)。 */
function endsNextDay(startTime: string, endTime: string): boolean {
  const [sh, sm] = startTime.split(":").map((s) => Number.parseInt(s, 10));
  const [eh, em] = endTime.split(":").map((s) => Number.parseInt(s, 10));
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return false;
  return eh! < sh! || (eh! === sh! && em! <= sm!);
}

/**
 * 開始時刻 (Date) と "HH:MM" 表記の開始/終了から、終了時刻の絶対値を出す。
 * `date` は開始時刻そのものなので、終了は「開始 + (終了 - 開始)」で求める
 * (翌日跨ぎなら +24h)。パースできないときは既定の 2 時間後。
 */
export function resolveSessionEndMs(
  startMs: number,
  startTime: string,
  endTime: string,
): number {
  const [sh, sm] = startTime.split(":").map((s) => Number.parseInt(s, 10));
  const [eh, em] = endTime.split(":").map((s) => Number.parseInt(s, 10));
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) {
    return startMs + 2 * 60 * 60 * 1000;
  }
  const deltaMin = (eh! - sh!) * 60 + (em! - sm!);
  const extra = endsNextDay(startTime, endTime) ? 24 * 60 : 0;
  return startMs + (deltaMin + extra) * 60 * 1000;
}

/** UTC の basic format ("20260903T130000Z")。Google カレンダーの dates 用。 */
export function toCalendarStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Google カレンダーの「予定を追加」画面へ飛ぶ URL。
 * ログイン済みのブラウザならそのまま保存画面が開く。
 */
export function buildGoogleCalendarUrl(input: {
  title: string;
  startMs: number;
  startTime: string;
  endTime: string;
  /** 予定の詳細に入れる URL (portal へのリンク等)。 */
  details?: string;
}): string {
  const endMs = resolveSessionEndMs(input.startMs, input.startTime, input.endTime);
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", input.title);
  u.searchParams.set(
    "dates",
    `${toCalendarStamp(input.startMs)}/${toCalendarStamp(endMs)}`,
  );
  if (input.details) u.searchParams.set("details", input.details);
  return u.toString();
}
