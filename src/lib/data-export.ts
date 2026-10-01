/**
 * データの書き出し (バックアップ) の対象 (2026-10-01 監査 F-3、純モジュール)。
 *
 * これまで書き出す経路は W-10 の TSV コピーとミス注釈のクリップボード
 * だけで、「全データ初期化」(DangerZone) は消す前に書き出す手段が無かった。
 * Private / Unlisted の FFLogs レポートは再取得できず、出欠の実績や
 * ミス注釈も作り直せない。そこで admin が JSON をダウンロードできるように
 * する (`/api/admin/export?part=<id>`)。
 *
 * ## 種類に分ける理由
 *
 * 練習ログの明細 (`fflogs_fights`) は数万行・数十 MB になり得る。1 本に
 * まとめると 1 回の応答が大きくなりすぎるので、種類ごとに分けて 1 回ずつ
 * ダウンロードする (明細は単独の種類)。どの種類も route がページ単位で
 * 読みながら流す (全件をメモリに載せない)。
 *
 * ## 書き出さないもの
 *
 * - `secrets` 表 (暗号化した token / cookie)
 * - `app_settings` のうち、名前が token / secret / cookie / password /
 *   oauth を含むキー (`isSensitiveSettingKey`)
 *
 * `@/` を import しない純モジュール (scripts/check-data-export.mjs が、
 * schema の全テーブルがどれかの種類か除外に入っていることを確かめる)。
 */

export const EXPORT_FORMAT = "raid-repository-export";
export const EXPORT_VERSION = 1;
/** 1 回の読み取りの行数 (PostgREST の既定上限と同じ)。 */
export const EXPORT_PAGE_SIZE = 1000;

export type ExportTable = {
  table: string;
  /** ページ送りの並び (主キー。無い表は一意に近い列の組)。 */
  order: string[];
};

export type ExportPart = {
  id: "schedule" | "logs" | "fights" | "loot" | "content" | "settings";
  tables: ExportTable[];
};

export const EXPORT_PARTS: readonly ExportPart[] = [
  {
    // 予定・出欠・メンバー・日付メモ・過去の日程・募集文
    id: "schedule",
    tables: [
      { table: "native_schedules", order: ["id"] },
      { table: "native_schedule_sessions", order: ["id"] },
      { table: "native_schedule_members", order: ["discord_user_id"] },
      { table: "native_schedule_member_jobs", order: ["id"] },
      { table: "native_schedule_attendances", order: ["session_id", "discord_user_id"] },
      { table: "native_schedule_session_logs", order: ["id"] },
      { table: "schedule_session_memos", order: ["id"] },
      { table: "schedule_past_sessions", order: ["raw_date"] },
      { table: "schedule_past_session_logs", order: ["id"] },
      { table: "recruitment_templates", order: ["id"] },
    ],
  },
  {
    // 練習ログの明細以外 (レポートの台帳・動画・注釈・出席の実績)
    id: "logs",
    tables: [
      { table: "fflogs_report_syncs", order: ["report_code"] },
      { table: "fflogs_report_videos", order: ["id"] },
      { table: "fflogs_report_blocklist", order: ["report_code"] },
      { table: "fflogs_pull_notes", order: ["id"] },
      { table: "fflogs_attendance_actuals", order: ["report_code", "discord_user_id"] },
      { table: "fflogs_attendance_unresolved", order: ["character_name"] },
      { table: "fflogs_notify_state", order: ["category_id"] },
    ],
  },
  {
    // 練習ログの明細 (大きいので単独)
    id: "fights",
    tables: [{ table: "fflogs_fights", order: ["id"] }],
  },
  {
    id: "loot",
    tables: [
      { table: "loot_items", order: ["id"] },
      { table: "loot_entries", order: ["id"] },
      { table: "loot_weekly_checks", order: ["id"] },
      { table: "category_bis_links", order: ["id"] },
      { table: "category_bis_slots", order: ["bis_link_id", "slot"] },
    ],
  },
  {
    // コンテンツ・リンク・軽減表・攻略・マクロ・既読など
    id: "content",
    tables: [
      { table: "categories", order: ["id"] },
      { table: "category_links", order: ["id"] },
      { table: "category_gphoto_albums", order: ["id"] },
      { table: "category_discord_blocklist", order: ["id"] },
      { table: "category_link_reads", order: ["link_id", "discord_user_id"] },
      { table: "category_onboarding_steps", order: ["category_id", "discord_user_id", "step"] },
      { table: "mitigation_phases", order: ["id"] },
      { table: "mitigation_entries", order: ["id"] },
      { table: "strategy_docs", order: ["id"] },
      { table: "category_macros", order: ["id"] },
      { table: "category_waymarks", order: ["id"] },
      { table: "tags", order: ["id"] },
    ],
  },
  {
    // 設定値 (秘密を含むキーは除く)
    id: "settings",
    tables: [{ table: "app_settings", order: ["key"] }],
  },
];

/** 書き出さない表と理由。 */
export const EXPORT_EXCLUDED_TABLES: Record<string, string> = {
  // 暗号化した token / cookie (書き出すと鍵と一緒に漏れる)
  secrets: "encrypted tokens / cookies",
};

export function findExportPart(id: string | null | undefined): ExportPart | null {
  return EXPORT_PARTS.find((p) => p.id === id) ?? null;
}

/** `app_settings` のうち書き出さないキー (秘密になり得る名前)。 */
export function isSensitiveSettingKey(key: string): boolean {
  return /token|secret|cookie|password|oauth/i.test(key);
}

/** ダウンロードのファイル名 (`raid-repository-<種類>-<YYYY-MM-DD>.json`)。 */
export function exportFileName(part: ExportPart["id"], ymd: string): string {
  return `raid-repository-${part}-${ymd}.json`;
}
