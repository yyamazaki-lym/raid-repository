/**
 * 最新リリースのメタ情報 (version / date) だけを持つ極小モジュール。
 *
 * 分離の経緯 (2026-07-22): `site-header.tsx` (全ポータルページで描画される
 * Server Component) がヘッダーバッジのために `RELEASES[0]` を import して
 * いた結果、~306 KB の changelog 本文が全 8 ポータルページのサーバー
 * バンドル (eager chunk) に混入し、Node 関数 cold start のモジュール評価を
 * 重くしていた。ヘッダーに必要なのは version / date の 2 フィールドだけ
 * なのでここへ切り出し、site-header は本モジュールのみを import する。
 * changelog 本文は従来どおり settings dialog の lazy chunk でのみ load。
 *
 * 一貫性の担保: `changelog.ts` の `RELEASES[0]` は本オブジェクトを spread
 * して組み立てるため、ヘッダー表示と更新履歴の最新エントリーが食い違う
 * ことは構造上ない (spread を旧エントリーに残したまま新エントリーを
 * literal で書くと、更新履歴に同一 version/date が 2 行並び React の
 * duplicate-key warning が出るので気付ける)。
 *
 * 新リリースエントリー追加時の手順 (5 点セット):
 *   1. `changelog.ts` の現先頭エントリーの `...LATEST_RELEASE_META` を
 *      現行の version / date のリテラルに書き戻す (freeze)
 *   2. 新エントリーを先頭に追加し、version / date の代わりに
 *      `...LATEST_RELEASE_META` を書く
 *   3. 本ファイルの値を新しい version / date に更新する
 *   4. 1. で freeze した旧先頭エントリーを `changelog-archive.ts` の
 *      `RELEASES_ARCHIVE` 先頭へそのまま移す (graduate)。`changelog.ts`
 *      は常に最新 1 件だけを持つ
 *   5. 本文 (狙い / 実装 / 検証) を `docs/release-notes/v<version>-<date>.md`
 *      に書く。`# v<version> (<date>)` の下に、part ごとの `## <title>`
 *      (TS の title と同一文字列) + 本文。既存の日付に part を足す時は
 *      その md に `##` を追記する
 *   `node scripts/check-changelog.mjs` (CI でも実行) が 1.〜5. の崩れ
 *   (本体 2 件以上 / meta 不一致 / md 欠落 / 見出しと title の不一致) で
 *   失敗する。経緯は `changelog.ts` ヘッダー、書き方は
 *   `docs/release-notes/README.md` を参照。
 *
 * 型注釈は意図的にローカル完結 (`Pick<ReleaseEntry, ...>` にすると
 * changelog.ts への import が要り意味的な循環を作る)。フィールドを打ち
 * 間違えても changelog.ts 側の spread で `ReleaseEntry` の必須フィールド
 * 欠落として tsc が検出する。
 *
 * `package.json#version` は旧スキーム最終値 (1.9.38) の歴史的マーカーの
 * まま据え置き (旧 site-header.tsx コメントから移設)。本 const が必ず
 * 存在するため、ヘッダーの fallback としてはもう参照しない。
 */
export const LATEST_RELEASE_META: { version: string; date: string } = {
  version: "2.16",
  date: "2026-09-07",
};
