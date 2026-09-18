/**
 * 同期式 (character-sheets / デイコード) スケジュールの **登録リスト**。
 *
 * 2026-09-18 実機要望「複数スケジュールを切り替えられるようにしたい /
 * 登録されたスケジュール名を表示したい」。
 *
 * ## 保存形式
 *
 * - `app_settings.schedule_urls` … 登録リスト (この型の配列の JSON 文字列)
 * - `app_settings.schedule_url`  … **現在選択中の URL** (従来キーのまま)
 *
 * 選択中を従来キーに置き続けるのが要。`getScheduleSourceUrl()` /
 * cron 4 本 / snapshot / Discord 通知は全て `schedule_url` を読むので、
 * 切り替えは「このキーの値を差し替えるだけ」で全経路に効く。リストは
 * 設定 UI だけが読む付加情報で、描画パスの一括 SELECT
 * (`fetchPortalSettings`) には載せない。
 *
 * ## 純モジュールである理由
 *
 * server action ("use server") からも "use client" の設定 UI からも
 * import するため、副作用と server-only import を持たない plain TS に
 * 置く (`settings-keys.ts` と同じ理由)。
 */

/** 登録できる上限。app_settings の 1 行に JSON を収めるので控えめに。 */
export const MAX_REGISTERED_SCHEDULES = 20;

/** スケジュール名の最大長 (取得時 / 手入力時とも server action で切り詰め)。 */
export const MAX_SCHEDULE_NAME_LENGTH = 80;

export type RegisteredSchedule = {
  /** リスト内で一意な id。並べ替えや削除の対象指定に使う。 */
  id: string;
  /** `https://character-sheets.appspot.com/schedule/list?key=…` */
  url: string;
  /**
   * 表示名。登録時に元ページの `<h1 id="title">` から取得する
   * (`extractScheduleName`)。取得できなかった場合と、まだ取得していない
   * 場合は null で、UI は URL の key を代わりに出す。
   */
  name: string | null;
};

/** `crypto.randomUUID()` は Node 20+ / モダンブラウザの両方にある。 */
export function newScheduleId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // 非 secure context の古い環境向けフォールバック (衝突しても実害は
    // 「削除/選択の対象がずれる」程度なので乱数で十分)。
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * `app_settings.schedule_urls` の生値をリストに戻す。
 *
 * 壊れた JSON / 想定外の型は **黙って空リスト扱い**にする。設定画面が
 * 例外で落ちるより、空から登録し直せる方が回復が早い (壊れた値は次の
 * 保存で上書きされる)。
 */
export function parseRegisteredSchedules(
  raw: string | null | undefined,
): RegisteredSchedule[] {
  if (!raw) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];
  const out: RegisteredSchedule[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of decoded) {
    if (!entry || typeof entry !== "object") continue;
    const { id, url, name } = entry as Record<string, unknown>;
    if (!isHttpUrl(url)) continue;
    const cleanUrl = url.trim();
    if (seenUrls.has(cleanUrl)) continue;
    const cleanId =
      typeof id === "string" && id.trim() && !seenIds.has(id.trim())
        ? id.trim()
        : newScheduleId();
    const cleanName =
      typeof name === "string" && name.trim()
        ? name.trim().slice(0, MAX_SCHEDULE_NAME_LENGTH)
        : null;
    seenUrls.add(cleanUrl);
    seenIds.add(cleanId);
    out.push({ id: cleanId, url: cleanUrl, name: cleanName });
    if (out.length >= MAX_REGISTERED_SCHEDULES) break;
  }
  return out;
}

export function serializeRegisteredSchedules(
  list: readonly RegisteredSchedule[],
): string {
  return JSON.stringify(
    list.map((s) => ({ id: s.id, url: s.url, name: s.name })),
  );
}

/**
 * 現在選択中の URL がリストに無ければ先頭に補う (**表示専用の移行措置**)。
 *
 * この機能より前に登録された固定は `schedule_url` だけを持ち
 * `schedule_urls` が無い。設定を開いた時点で DB を書き足すのではなく、
 * 読み出し側で補完しておき、admin が何か保存した時に初めて永続化する
 * (開いただけで共有設定が書き換わらないようにするため)。
 */
export function withActiveSchedule(
  list: readonly RegisteredSchedule[],
  activeUrl: string | null | undefined,
): RegisteredSchedule[] {
  if (!isHttpUrl(activeUrl)) return [...list];
  const active = activeUrl.trim();
  if (list.some((s) => s.url === active)) return [...list];
  return [{ id: newScheduleId(), url: active, name: null }, ...list];
}

/** 選択中 URL に対応する登録エントリ。無ければ null。 */
export function findActiveSchedule(
  list: readonly RegisteredSchedule[],
  activeUrl: string | null | undefined,
): RegisteredSchedule | null {
  if (!activeUrl) return null;
  const active = activeUrl.trim();
  return list.find((s) => s.url === active) ?? null;
}

/**
 * 名前が無いときの代替表示。`?key=abcd1234` の key を短縮して出す
 * (URL 全体は長く、行が崩れるため)。key が取れない URL はホスト名。
 */
export function scheduleFallbackLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const key = parsed.searchParams.get("key");
    if (key) return `key: ${key.length > 12 ? `${key.slice(0, 12)}…` : key}`;
    return parsed.host;
  } catch {
    return url.slice(0, 24);
  }
}
