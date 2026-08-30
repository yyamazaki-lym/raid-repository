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
 * 新リリースエントリー追加時の手順 (3 点セット):
 *   1. `changelog.ts` の現先頭エントリーの `...LATEST_RELEASE_META` を
 *      現行の version / date のリテラルに書き戻す (freeze)
 *   2. 新エントリーを先頭に追加し、version / date の代わりに
 *      `...LATEST_RELEASE_META` を書く
 *   3. 本ファイルの値を新しい version / date に更新する
 *   (エントリーの archive への graduate 手順は `changelog.ts` ヘッダー参照)
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
  version: "2.11",
  date: "2026-08-30",
};
