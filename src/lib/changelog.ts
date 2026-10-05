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
        title:
          "🏅 練習ログ: 零式のチーム実績 (初討伐 / ノーデス / 最速 / 討伐回数) を最終層の討伐で数えるように修正。下の層を初めて倒した日が「初討伐」に出ていた",
      },
      {
        title:
          "📣 スケジュール: 自前作成式で複数のスケジュールがあるとき、開催確定の通知・出欠の催促・出席サマリーを全スケジュール分にした (通知と催促にはスケジュール名が入る。催促を 2 つの日で交互に送り直すことがあったのも止めた)",
      },
      {
        title:
          "📥 設定: 書き出したデータの取り込み (復元) を追加。同じ ID の行は上書き・無い行は追加・ファイルに無い行は消さない。書き込む前に表ごとの「追加 / 上書き」の件数を確認できる",
      },
      {
        title:
          "🎬 練習ログ: YouTube の動画ごとに「チャプター」ボタンを追加。押すと pull ごとの区切り (例: 2:13 #1 1層 残42.0%) がコピーされ、動画の説明欄に貼るとチャプターになる",
      },
      {
        title:
          "📅 練習ログ: 通知に「週のまとめ」を追加 (既定 OFF)。火曜の朝に、前の週の練習量・最高到達・初突破・討伐をコンテンツごとに Discord へ投稿する。設定画面で送らずにプレビューできる",
      },
    ],
  },
];
