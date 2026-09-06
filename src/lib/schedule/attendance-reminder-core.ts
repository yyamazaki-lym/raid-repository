import { discordTimestamp } from "./attendance-times";
/**
 * 出欠催促の純粋ロジック (2026-08-30)。
 *
 * `server/attendance-reminder.ts` から DB / fetch に触れない部分だけを
 * 切り出した plain TS モジュール。メンションは取り消せない副作用なので、
 * 「誰が未入力か」「誰にメンションが飛ぶか」の判定は単体で検証できる形に
 * しておく (scripts/check-attendance-reminder.mjs が本モジュールを叩く)。
 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 未回答を表す記号。character-sheets は全角ハイフン「－」(U+FF0D) を
 * 未回答として出力する。半角/長音/ダッシュの取り違えも同じ扱いにする。
 */
const UNANSWERED_SYMBOLS = new Set(["－", "-", "ー", "―", ""]);

/** 記号が「未回答」か。null / undefined / 空白のみも未回答。 */
export function isUnanswered(symbol: string | undefined | null): boolean {
  if (symbol == null) return true;
  return UNANSWERED_SYMBOLS.has(symbol.trim());
}

/** JST 暦日キー "YYYY-M-D"。UTC ms を受け取る。 */
export function jstDayKey(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** JST の hour (0-23)。 */
export function getJstHour(now: Date = new Date()): number {
  return new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
}

/** 表示名の比較キー (全角英数を半角化 + 空白除去 + 小文字化)。 */
export function normalizeName(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}

/**
 * Discord mention のトリガーを無害化 (native-schedule-discord と同方針)。
 * 本文に混ざる表示名・日付ラベルはユーザー入力由来なので、`allowed_mentions`
 * の単一防御に頼らずここでも構文を崩す。
 */
export function neutralizeMentions(s: string): string {
  const zwsp = String.fromCharCode(0x200b);
  return s
    .replace(/@(everyone|here)/g, "@" + zwsp + "$1")
    .replace(/<(@[!&]?|#)/g, "<" + zwsp + "$1");
}

export const DISCORD_ID_RE = /^\d{17,20}$/;

/** 設定値の整数パース (範囲外・不正は既定値)。 */
export function parseIntSetting(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** JSON オブジェクト設定の安全な読み出し (壊れていたら空)。 */
export function parseJsonRecord(raw: string | null): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" && val.trim()) out[k.trim()] = val.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** JSON 文字列配列設定の安全な読み出し。 */
export function parseJsonStringArray(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export type ReminderTarget = {
  name: string;
  discordUserId: string | null;
};

export type CollectedMember = {
  name: string;
  answered: boolean;
  /** ソース由来の Discord ID (native のみ)。対応表があればそちらが優先。 */
  discordUserId: string | null;
};

export type ReminderAudience = {
  targets: ReminderTarget[];
  excluded: string[];
  answered: number;
  total: number;
};

/**
 * メンバー一覧 + 対応表 + 除外リストから「誰に催促するか」を決める。
 *
 * - 除外された人は targets にも集計 (total/answered) にも出さない
 * - 対応表の ID が優先、無ければソース由来 ID、どちらも無ければ null
 *   (= メンションされず名前だけ本文に出る)
 * - 名前の突き合わせは normalizeName (表記ゆれ吸収)
 */
export function selectReminderAudience(input: {
  members: CollectedMember[];
  memberMap: Record<string, string>;
  excluded: string[];
}): ReminderAudience {
  const excludedSet = new Set(input.excluded.map(normalizeName));
  const mapByNormalized = new Map<string, string>();
  for (const [name, id] of Object.entries(input.memberMap)) {
    if (DISCORD_ID_RE.test(id)) mapByNormalized.set(normalizeName(name), id);
  }

  const targets: ReminderTarget[] = [];
  const excluded: string[] = [];
  let answered = 0;
  let total = 0;
  for (const m of input.members) {
    if (excludedSet.has(normalizeName(m.name))) {
      excluded.push(m.name);
      continue;
    }
    total += 1;
    if (m.answered) {
      answered += 1;
      continue;
    }
    targets.push({
      name: m.name,
      discordUserId: mapByNormalized.get(normalizeName(m.name)) ?? m.discordUserId,
    });
  }
  return { targets, excluded, answered, total };
}

/** テンプレートの placeholder 置換。未知の placeholder は素通し。 */
export function renderReminderTemplate(
  template: string,
  values: {
    targets: ReminderTarget[];
    rawDate: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    answered: number;
    total: number;
    siteUrl: string;
    /** 開始時刻の UNIX 秒 (W-14)。null なら Discord 時刻の placeholder は空。 */
    startUnix?: number | null;
  },
): string {
  const mentions = values.targets
    .map((t) =>
      t.discordUserId ? `<@${t.discordUserId}>` : neutralizeMentions(t.name),
    )
    .join(" ");
  const names = values.targets.map((t) => neutralizeMentions(t.name)).join(", ");
  const replacements: Record<string, string> = {
    "{mentions}": mentions,
    "{names}": names,
    "{date}": neutralizeMentions(values.rawDate),
    "{day}": neutralizeMentions(values.dayOfWeek),
    "{time_start}": values.startTime,
    "{time_end}": values.endTime,
    "{count}": String(values.targets.length),
    "{answered}": String(values.answered),
    "{total}": String(values.total),
    "{site_url}": values.siteUrl,
    "{discord_time}": discordTimestamp(values.startUnix ?? null, "F"),
    "{discord_relative}": discordTimestamp(values.startUnix ?? null, "R"),
  };
  return template.replace(
    /\{(mentions|names|date|day|time_start|time_end|count|answered|total|site_url|discord_time|discord_relative)\}/g,
    (m) => replacements[m] ?? m,
  );
}
