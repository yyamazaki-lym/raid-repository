/**
 * Hand-curated release notes. Shown in the settings dialog when the
 * user clicks the "更新履歴" button.
 *
 * Entries are user-facing (paste-into-a-newsletter level), not
 * commit-level.
 *
 * **File split** (TODO #67, 2026-05-02): only the latest release lives
 * in this module so the initial client bundle stays small. Older
 * entries are kept in `./changelog-archive.ts` (`RELEASES_ARCHIVE`)
 * and loaded lazily via `dynamic import("@/lib/changelog-archive")`
 * when the user clicks "過去の更新履歴を見る" in the settings dialog.
 * When a release graduates from this module, prepend it to the top
 * of `RELEASES_ARCHIVE`.
 *
 * **Graduation restored** (2026-09-06): the rule above had lapsed since
 * 2026-05 and this module had grown to 32 entries / ~420 KB, which every
 * page downloaded on load (see `settings-dialog-lazy.tsx`). All entries
 * except the head were moved verbatim into `RELEASES_ARCHIVE` (combined
 * list verified byte-identical). `scripts/check-changelog.mjs` now runs in
 * CI and fails when `RELEASES.length !== 1`, so a new entry must graduate
 * the previous head in the same commit (step 4 in `changelog-meta.ts`).
 *
 * **Body split** (2026-09-06): the per-part `body` text (developer-facing
 * background / implementation / verification notes) was never rendered by
 * the UI, which shows `title` only, yet made up >90% of the archive
 * (~630 KB). Bodies now live in `docs/release-notes/v<version>-<date>.md`,
 * one file per entry, one `## <title>` section per part (see
 * `docs/release-notes/README.md`). `scripts/check-changelog.mjs` verifies
 * that every entry with `parts` has its md file and that the `##`
 * headings match the part titles in order.
 *
 * **Meta split** (2026-07-22): the latest entry's `version` / `date` live
 * in `./changelog-meta.ts` (`LATEST_RELEASE_META`) and are spread into
 * `RELEASES[0]`, so `site-header.tsx` can show the header badge without
 * pulling this ~300 KB module into every page's server bundle. When
 * adding a new entry, follow the 3-step procedure documented in
 * `changelog-meta.ts`. When a release graduates to the archive it must
 * be literal (frozen) — never move an entry that still spreads the meta.
 *
 * Versioning scheme (from 2026-04-28, while staying on v1.9):
 *   `MAJOR.MINOR` + `(YYYY-MM-DD)` date suffix — patch dropped.
 *     - Small fixes / tweaks: keep MAJOR.MINOR, add a NEW entry with the
 *       new date. Multiple entries can share the same `version` field.
 *     - Notable feature additions / reworks: bump MINOR (e.g. 1.9 → 1.10).
 *     - Breaking / sweeping changes: bump MAJOR (e.g. 1.x → 2.0).
 *
 *   Pre-scheme entries (1.9.38 and earlier) used `MAJOR.MINOR.PATCH` and
 *   bumped patch per commit, which inflated 1.9 to 38 patches. Those
 *   entries are kept as-is for history (now in `changelog-archive.ts`).
 *
 * Order: newest first (the UI renders top-to-bottom as-is).
 */

import { LATEST_RELEASE_META } from "./changelog-meta";

export type ReleaseEntry = {
  version: string;
  /** ISO date `YYYY-MM-DD` of the bump. */
  date: string;
  /**
   * Short bullet points for the release. Markdown not supported.
   * 旧スキーム (1.9.38 以前) で使用、新スキームでも軽微な変更で使う。
   * `parts` と排他: 同時指定された場合 UI は `parts` を優先表示。
   */
  notes?: string[];
  /**
   * 1 日内に多数のコミットがある日 (新スキーム運用後の典型) で、
   * notes を「コミットごとの part」に分割して表示するためのフィールド。
   * UI はリリース単位で折りたたみ、開くと各 part の title を箇条書きで
   * 出す (2026-05-02 以降、本文は画面に出さない)。
   */
  parts?: ReleasePart[];
};

export type ReleasePart = {
  /**
   * 画面に出る 1 行サマリー (絵文字 + 短い見出し)。
   * 本文 (狙い / 実装 / 検証) は `docs/release-notes/v<version>-<date>.md`
   * の同名 `##` 見出しの下に書く (2026-09-06 に body フィールドを廃止)。
   */
  title: string;
};

export const RELEASES: ReleaseEntry[] = [
  {
    // 最新エントリーの version / date は changelog-meta.ts が single source
    // of truth (site-header がヘッダーバッジ用に参照)。新エントリー追加時の
    // 手順 (5 点セット: freeze / 追加 / meta 更新 / graduate / md) は
    // changelog-meta.ts の docstring を参照。
    ...LATEST_RELEASE_META,
    parts: [
      {
        title: "🐛 練習ログ: 拡張をまたいだ絶 (Ultimates (Legacy)) のレポートが取り込めなかったのを修正 — pull の encounter 名で振り分け",
      },
      {
        title: "⏱ 練習ログ: フェーズ滞在時間を「表示中の pull」ではなく登録ログ全件で集計",
      },
      {
        title: "🔁 練習ログ: 同期結果に「残り N レポート」を表示 / フェーズ滞在時間の母数 (情報のある pull 数) を明示",
      },
      {
        title: "🚦 同期: 旧レポートの取り直しを private 再試行より先に処理 / 取得経路 (v2 ・ 代替) の内訳を表示",
      },
      {
        title: "🌐 表示言語 第 3 段 (1/3): 設定ダイアログの全セクションを日英化",
      },
      {
        title: "🌐 表示言語 第 3 段 (2/3): 練習ログ / サブタブ / カテゴリ一覧を日英化",
      },
      {
        title: "🌐 表示言語 第 3 段 (3/3): 軽減表 / ロット / 攻略 / 動画 / マクロ / ウェイマーク / コンテンツ編集を日英化",
      },
      {
        title: "🏳️ 言語切替をヘッダーへ (国旗アイコン) / 残っていた日本語 (メンテナンス結果・ページ見出し・エラー画面) を日英化",
      },
      {
        title: "🧩 同期: v1 経路 (unlisted) のレポートでもフェーズ遷移を読む / 旧レポートをもう 1 回だけ取り直す",
      },
      {
        title: "🩺 練習ログ: URL 取り込みは貼ったコンテンツのログとして取り込む / レポート診断と「このコンテンツに割り当て」を追加",
      },
      {
        title: "🎯 練習ログ: Legacy 絶の pull を encounter ID とボス名で振り分け (fight 名が「Omega」等のボス名だった)",
      },
      {
        title: "🖼 動画登録: Google フォトのリンクに対応 (専用アイコン / 動画として分類)",
      },
      {
        title: "🩺 練習ログ: レポート診断に到達度の保存状況 (クリア数 / 残 HP%・フェーズの未取得数 / 生値 / 日付) を追加",
      },
      {
        title: "🧹 練習ログ: 1 レポートに複数コンテンツが混ざると全 pull が片方に入っていたのを修正 (zone で振り分け / 再分類ボタン)",
      },
      {
        title: "🐞 練習ログ: 明細が 1000 件で頭打ちになり、古いセッションが丸ごと出てこなかったのを修正",
      },
      {
        title: "🚩 練習ログ: 右端の旗の意味を hover で表示 / フェーズ滞在時間の下に「各フェーズへの初到達まで」を追加",
      },
      {
        title: "🎬 練習ログ: 1 つのレポートに複数の動画を紐づけられるように (前半/後半・視点違い) — オフセットは動画ごとに個別",
      },
      {
        title: "🗑 練習ログ: 「ログ削除」をオフセットの真横から行の右端へ (押し間違い防止)",
      },
      {
        title: "📈 練習ログ: 明細の上限を 1200 → 20000 pull に引き上げ (長期の固定でも古いセッションが消えない)",
      },
      {
        title: "✅ CI: scripts/check-*.mjs を全部実行するように (これまで更新履歴の検査だけだった)",
      },
      {
        title: "🧱 練習ログ画面を 9 つの部品に分割 (2,546 → 1,320 行、表示は components/portal/logs へ)",
      },
      {
        title: "👀 攻略情報: リンクごとに「既読」を付けられるように (未読人数を表示 / 誰が未読かは管理者のみ)",
      },
      {
        title: "🏷 攻略情報: リンクにフェーズ / ギミックのタグを付けて絞り込めるように (タイトルから候補を提案)",
      },
      {
        title: "🎚 コンテンツに「難易度」と「進行モデル (層 / フェーズ)」を設定できるように (8.0 の新難易度に備える)",
      },
      {
        title: "📆 週制限の消化チェックを 2 週ウィンドウに対応 (8.0 のトームストーン遡り取得)",
      },
      {
        title: "🌐 メンバー一覧にデータセンター表記を追加 (クロスプレイ前提)",
      },
      {
        title: "⏱ 練習ログ: 日ごとに「拘束 / 実戦闘 / 戦闘外 / 平均プル長」のセッションサマリーを表示",
      },
      {
        title: "🏅 練習ログ: チーム実績バッジ (初討伐 / ノーデス討伐 / 最速討伐 / 討伐回数)",
      },
      {
        title: "🔧 公式メンテ日程を登録できるように / 活動予定と重なると次回開催カードに警告",
      },
      {
        title: "📣 出欠催促の頻度を選べるように (期限に 1 回 / 期限 + 当日 / 毎日 1 回)",
      },
      {
        title: "🔗 リンク判定辞書に 3 サイト追加 + 「募集」バッジを新設",
      },
      {
        title: "📚 ドキュメント 2 本: ログ担当の手引き / Discord の推奨構成と設定手順",
      },
      {
        title: "📊 練習ログ: 進行トレンド (到達度の推移グラフ + クリアまでのペースの目安)",
      },
      {
        title: "🔔 練習ログ: 新レポート / ベスト更新 / 初討伐を Discord に通知 (すべて既定 OFF)",
      },
      {
        title: "📝 募集文に変数を差し込めるように (コンテンツ / 日時は自動 / フェーズ・武器・DC はコピー時に入力)",
      },
      {
        title: "🛡 BiS に部位別の「取得済」チェックを追加 (装備 n/11 のバッジ)",
      },
      {
        title: "🔠 文字サイズの下限を 11px に (10px 以下の 392 箇所を引き上げ / 本文は 12px)",
      },
      {
        title: "🌏 残っていた日本語 116 件を 6 分類して固定 / 入力エラー文を日英化 (訳し忘れは CI で検出)",
      },
      {
        title: "🎯 動画オフセットを「動画を見ながら」決められるように (秒数を数えなくてよい / ±1 秒の微調整)",
      },
      {
        title: "🧾 マクロ / ウェイマーク / 募集文をコードブロック表示に (12px 等幅 / マクロは 15 行の上限を表示)",
      },
      {
        title: "🚦 日付メモに重要度 (要対応 / 注意 / 参考) を付けて並び替え・絞り込み",
      },
      {
        title: "👥 予定表の各行に出欠の内訳チップを追加 (何人 OK / 未回答何人)",
      },
    ],
  },
];
