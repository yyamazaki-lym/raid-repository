# release-notes: 更新履歴の本文

設定ダイアログの「更新履歴」に出る**見出し** (`title`) は `src/lib/changelog.ts` (最新 1 件) と `src/lib/changelog-archive.ts` (それ以前) にあります。このディレクトリには、その見出しごとの**本文** (狙い / 実装 / 検証といった開発者向けの記録) を置きます。本文は画面には出ません。

2026-09-06 に TS の `body` フィールドから移しました。TS に本文を置いていた頃は archive が 630 KB になり、「過去の更新履歴を見る」を押すたびに全文をダウンロードしていました。分離後は title だけ (約 37 KB) を配信します。

## ファイルの決まり

- ファイル名は `v<version>-<date>.md`。例: `v2.14-2026-09-06.md`。同じ `version` で日付が違うエントリは別ファイルです。
- 1 行目は `# v<version> (<date>)`。
- 各 part は `## <title>` で始めます。**`<title>` は TS の `title` と同一文字列** (先頭の絵文字も含む)。順序も TS と同じにします。
- `##` の下に本文を Markdown で書きます。本文の中で `## ` で始まる行は使えません (見出しの区切りに使うため)。`###` 以下は自由です。
- `parts` を持たず `notes` だけの古いエントリ (1.9.35〜1.9.38) には md はありません。

## 新しいリリースを書く手順

`src/lib/changelog-meta.ts` の 5 点セットに従います。

1. `changelog.ts` の現先頭エントリの `...LATEST_RELEASE_META` を version / date のリテラルに書き戻す (freeze)
2. 新エントリを先頭に追加し、`...LATEST_RELEASE_META` + `parts: [{ title }]` を書く
3. `changelog-meta.ts` の version / date を更新する
4. 1. で freeze したエントリを `changelog-archive.ts` の `RELEASES_ARCHIVE` 先頭へそのまま移す
5. `docs/release-notes/v<version>-<date>.md` を作り、`## <title>` ごとに本文を書く

同じ日付に part を足す場合は、TS の `parts` に title を追加し、その md の末尾に `## <title>` と本文を追記します。

## 検査

`node scripts/check-changelog.mjs` (CI の lint ジョブでも実行) が次を確認します。

- `changelog.ts` が最新 1 件だけを持つ
- 先頭エントリが `LATEST_RELEASE_META` と一致する
- `version|date` が重複しない、日付が新しい → 古いの順
- parts を持つ全エントリに md があり、`##` 見出しが title と順序込みで一致する
- 対応するエントリの無い md が残っていない

本文の内容そのものは検査しません。見出しがずれた時だけ CI が落ちます。

## 本文の書き方 (目安)

利用者向けの見出しとは別に、本文は「後から経緯を追う人」のために書きます。

- **狙い / 経緯**: どの報告・要望への対応か。何が問題だったか。
- **変更内容**: 触ったファイルと、何をどう変えたか。触らなかった範囲も書くと後で助かります。
- **検証**: 何で確認したか (`tsc` / `eslint` / `next build` / ブラウザ確認の手順と結果)。
- **動作影響 / トレードオフ**: 利用者の見え方が変わる点、承知の上で採用した欠点。
