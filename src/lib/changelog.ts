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
        title: "☠ 練習ログ: 各 pull に「ワイプ原因」— 最初に落ちたジョブと致命の技",
      },
      {
        title: "⏱ 練習ログ: 絶のフェーズ滞在時間 (pull ごとのバーと合計)",
      },
      {
        title: "⏰ 出欠: 遅刻・早退の予定時刻を入れられるように (確定通知にも反映)",
      },
      {
        title: "🕒 Discord 通知に相対時刻 (N 時間後) / 次回開催カードに開始までのカウントダウン",
      },
      {
        title: "🎨 「良い / 注意 / 悪い」の色を 5 段階のスケールに統一 (残 HP%・死亡数・出欠・消化チェック)",
      },
      {
        title: "🪪 ロゴを追加 — ファビコン / ホーム画面アイコン / ログイン画面を新デザインに",
      },
      {
        title: "🈶 練習ログ: ワイプ原因の技名を日本語で表示 (既存の pull も次の同期から順に置き換わる)",
      },
      {
        title: "🧭 ヘッダー左上のアイコンをロゴマークに / ログイン画面の説明文の改行を調整",
      },
    ],
  },
];
