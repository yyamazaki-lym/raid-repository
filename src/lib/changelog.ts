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
   * 各 part は折りたたみ可能 (`<details>`) で、title だけ常時表示し、
   * 詳細 body はクリックで開閉する。
   */
  parts?: ReleasePart[];
};

export type ReleasePart = {
  /** 折りたたみ時に常時表示される 1 行サマリー (絵文字 + 短い見出し) */
  title: string;
  /** 展開時に表示される本文 (1〜数文程度の詳細) */
  body: string;
};

export const RELEASES: ReleaseEntry[] = [
  {
    // 最新エントリーの version / date は changelog-meta.ts が single source
    // of truth (site-header がヘッダーバッジ用に参照)。新エントリー追加時の
    // 3 点セット手順は changelog-meta.ts の docstring を参照。
    ...LATEST_RELEASE_META,
    parts: [
      {
        title: "⚡ 初回表示を軽く: 設定ダイアログと更新履歴を「開いた時」に読む",
        body:
          "「動作に問題を起こさず、高速化・軽量化できるか」への対応です。\n\nこれまで、どのページを開いても**設定ダイアログ本体と更新履歴の全文** (合わせて約 470 KB、圧縮後でも約 150 KB) を毎回ダウンロードしていました。ヘッダー右上の歯車ボタンを表示するために、押されるかどうかに関係なく中身まで先に取りに行っていたためです。更新履歴の本文は文章量が増え続けていて、この大半を占めていました。\n\n**歯車ボタンは見た目だけを先に出し、押した時 (またはマウスを載せた時) に中身を取り寄せる**ようにしました。ボタンはサーバー側の描画に含まれるので、以前あった「ボタンが一瞬遅れて現れる」も無くなります。更新履歴の本文は、ダイアログの中で「更新履歴」を押した時に初めて読み込みます。\n\n見た目・操作・表示内容は変わりません。FFLogs 連携から戻ってきた時に設定が自動で開く挙動もそのままです。初めて押した時だけ、回線状況によっては開くまでにわずかな待ちが出ることがあります。",
      },
      {
        title: "🔔 FFLogs 連携から戻った時の通知が出ないことがあったのを修正",
        body:
          "FFLogs の認証を終えてポータルに戻った直後、「認証に成功しました」「FFLogs OAuth: …」の通知が**表示されないことがありました**。設定ダイアログは開くのに、結果だけが分からない状態です。\n\n通知の表示部品は初回表示を軽くするために少し遅れて読み込まれるのですが、その到着より先に通知を出そうとすると**そのまま捨てられていた**のが原因です (以前からの不具合で、条件次第で 3 回に 0〜1 回しか出ていませんでした)。\n\n表示部品の準備ができてから通知を出すようにしました。ダイアログが自動で開くことと、URL から認証用の文字列が消えることは変わりません。",
      },
      {
        title: "🗂 更新履歴: 過去分をアーカイブに移し、開いた時の読み込みを軽く",
        body:
          "設定の「更新履歴」を押した時に読み込む本文が、2.1 (5 月) 以降の全リリース分 (約 370 KB) になっていました。本来は**最新 1 件だけ**を先に読み、それより前は「過去の更新履歴を見る」を押した時に読む設計です。\n\n最新 1 件を除く 31 件をそのままアーカイブ側へ移しました (内容・並び順は 1 文字も変えていません)。「更新履歴」を押した直後は最新 1 件だけが出て、過去分はボタンを押した時にまとめて読み込みます。\n\nあわせて、この運用が再び崩れないよう CI で検査するようにしました (本体が 2 件以上になっていたら失敗します)。",
      },
    ],
  },
];
