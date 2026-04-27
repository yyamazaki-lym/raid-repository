/**
 * Hand-curated release notes. Shown in the settings dialog when the
 * user clicks the "更新履歴" button.
 *
 * Entries are user-facing (paste-into-a-newsletter level), not
 * commit-level. Add a new top-level item whenever package.json
 * version is bumped, ideally in the same commit.
 *
 * Order: newest first (the UI renders top-to-bottom as-is).
 */

export type ReleaseEntry = {
  version: string;
  /** ISO date `YYYY-MM-DD` of the bump. */
  date: string;
  /** Short bullet points for the release. Markdown not supported. */
  notes: string[];
};

export const RELEASES: ReleaseEntry[] = [
  {
    version: "1.3.2",
    date: "2026-04-27",
    notes: [
      "スケジュール表の各出欠セルを直接クリックで character-sheets 編集ページへ（新タブ）",
      "ホバー時に拡大表示でクリック可能なことを明示",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-04-27",
    notes: [
      "出席状況の即時保存ボタンを過去予定 → 設定ダイアログに移動（結果に閉じるボタン付き）",
      "次回開催日カードの「確定」バッジをタイトル横に移動（右端より目立つ）",
      "次回開催日カードの「募集」ボタンにホバーで本文プレビュー表示",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-04-27",
    notes: [
      "マクロ・募集文テンプレ: クリックで折り畳み式表示（タイトルだけで一覧性アップ）",
      "マクロ追加・編集をポップアップダイアログ化",
      "募集文テンプレを各カテゴリーのマクロページからも追加・編集・削除可能に",
      "過去の予定カードに「保存」ボタン追加（現在の出席状況を即時スナップショット）",
      "設定: DB保存件数の確認ボタンを Discord 履歴ボタンの隣に移動 + 閉じるボタン",
      "設定: 更新履歴の閲覧ボタン追加",
      "ヘッダーバージョンが package.json から自動同期",
      "スケジュール上の募集文ボタンをアイコンのみに統一（他ボタンと整合）",
      "スケジュールの Legend → Legends 複数形に",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-04-27",
    notes: [
      "ヘッダーのバージョン表示を package.json から自動取得",
      "設定ダイアログに「更新履歴」ボタン + 履歴の閲覧",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-04-27",
    notes: [
      "各カテゴリーに「マクロ」サブタブを追加（コピー対応・並べ替え可）",
      "マクロページに、カテゴリーに紐づく募集文テンプレートを read-only 表示",
      "募集文テンプレに category_id（紐づけ）+ サブラベル（1層 / 2層 等）",
      "募集文テンプレを並べ替え可能に（先頭が次回開催日カードのコピー対象）",
      "次回開催日カードに最上段テンプレのワンタップコピーボタン",
      "本文に全角→半角変換ボタン + 募集文テンプレ作成サイトの外部リンク",
      "ドロップダウン最上段に ★ Top のハイライト",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-04-27",
    notes: [
      "出席状況スナップショット機構（毎日 21:50 JST 自動 + 手動ボタン）",
      "schedule_past_sessions に attendances + user_names 列追加",
      "Discord 通知チャンネルから過去日程を取り込み（設定ダイアログ）",
      "過去日程詳細テーブルに動画 / FFLogs リンク（36h ウィンドウ照合）",
      "簡易過去日程に動画 / Logs アイコン",
      "祝日名のホバー表示（holidays-jp.github.io から自動更新）",
      "次回開催日が当日の時に強調表示",
      "削除即時反映（REPLICA IDENTITY FULL）",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-04-27",
    notes: [
      "v0.1 ALPHA → v1.0.0 BETA に正式版移行",
      "セマンティック・バージョニング採用 (PATCH / MINOR / MAJOR)",
      "公開 README 拡充（他固定向けセットアップガイド）",
      "YouTube Data API + Innertube MWEB 対応で限定公開動画も時間取得",
      "カテゴリーごとの累計練習時間 + クリアまでの時間表示",
      "初クリア日時の自動検出 + 手動編集",
      "カテゴリーカード / スイッチャーにサブページショートカット",
      "スケジュール過去日程: 簡易 / 詳細の2モード",
    ],
  },
];
