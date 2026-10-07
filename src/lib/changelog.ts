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
          "📥 データの取り込み: Google フォトのアルバムに紐づく攻略画像が、アルバムの無い状態から取り込むと失敗していたのを直した (アルバムを先に入れる)",
      },
      {
        title:
          "📥 データの取り込み: 日付メモが 10 件ある日付を含むファイルを取り込み直すと、上限に引っかかって失敗していたのを直した (上書きになるメモは数えない)",
      },
      {
        title:
          "🔧 攻略情報: 題名が長い (空白の無いスプレッドシートの URL など) カードで、右端の「⋮」(編集・削除) がカードの外へ押し出されて押せなかったのを直した",
      },
      {
        title:
          "📣 週のまとめ: 1 行目の「実戦闘 (戦闘外 N%)」を「ログ合計 (うち戦闘)」に。あわせて、1 本のログに複数日の練習が入っているときに練習ログの「ログ合計」が夜をまたいで数えていたのを直した",
      },
      {
        title:
          "🎞 動画: 同じ練習を別の視点で撮った動画 (題名の DAY / PART の番号と日付が同じ) を、挑戦時間・クリアまでの累計時間で二重に数えていたのを直した (長い方の 1 本だけ数える)",
      },
      {
        title:
          "⏱ 練習ログ: ログ合計と日ごとの「拘束」で、pull の間の休憩を 1 回 60 分まで数えるようにした (休憩 3 時間の前後でログ合計が約 3 時間跳ねていた・複数日分を 1 本で上げたログで拘束に夜の分まで入っていた)",
      },
      {
        title:
          "👥 練習ログ: 同じ夜を 2 人が FFLogs に上げたとき、同じ pull を pull 数・クリア数・ワイプ原因・週のまとめなどで二重に数えないようにした (日の振り返りには両方の行を出し、片方に「別のログと同じ pull (数えない)」と添える)",
      },
      {
        title:
          "👥 コンテンツ一覧・出席サマリー: 同じ夜を 2 人が上げたログの同じ pull を、スパークラインの pull 数と出席サマリーの「一部のみ (N/M pull)」でも二重に数えないようにした",
      },
      {
        title:
          "🔒 セキュリティ: データベースの規則でも、Discord サーバーのメンバーと確認できた人だけが読み書きできるようにした (書き込みは確認から 72 時間以内。サーバーを抜けた人・ロールを外された人の権限は、次にサイトを開いたときかログインし直したときに閉じる)",
      },
      {
        title:
          "🔒 依存の更新: Next.js を 16.3.8・undici を 8.10.2 に上げた (公開されている脆弱性の修正版。画面の変化は無い)",
      },
      {
        title:
          "🔒 セキュリティ: ミス注釈は実在する pull にだけ付けられ、1 人 1 日 200 件まで。日付メモは 1 人 300 件・合計 20 万字まで (日付の付け替えでも 1 日付 10 件を守る)。Discord のロール一覧の取得を admin に限った",
      },
      {
        title:
          "🔒 セキュリティ: ログイン・アクセス拒否・FFLogs 連携の画面に、リンクの URL に入れた文がそのまま出ていたのを止めた (サイトが付ける理由だけを出す)。開催確定の通知の出欠記号の Markdown と、ミス注釈の「Discord 用」の文のメンションを無害にした",
      },
    ],
  },
];
