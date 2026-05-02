---
name: handoff-update
description: 完了した TODO の情報（番号・概要・差分・コミット履歴）から `.claude/HANDOFF.md` への統合追記文を生成する。part 単位の細切れ追記はしない（part 細分は commit log に任せる）。ユーザーが明示的に呼び出した時のみ実行する
disable-model-invocation: true
---

# handoff-update

`/handoff-update` で呼び出されたら、現在のセッションで完了した TODO を `.claude/HANDOFF.md` に統合追記するための文面を作成する。

## 前提ルール（メモリ参照）

- HANDOFF 追記は **TODO 完了時のみ統合追記**。part 単位の進捗は追記しない
- 文面は **日本語**
- HANDOFF.md は事前確認なしで編集してよい
- TODO ごとに 1 セッション運用なので、追記は通常 1 件分

## 手順

1. ユーザーに「どの TODO 番号を完了として追記するか」を 1 行で確認（複数あれば列挙）
2. 以下を収集:
   - `git log origin/main..HEAD --oneline` で当該セッションのコミット
   - `git diff origin/main..HEAD --stat` で変更ファイル概要
   - 既存 `.claude/HANDOFF.md` を読んで追記位置とフォーマットを揃える
3. 以下のテンプレで追記文を生成:

```markdown
## TODO #<番号>: <タイトル> ✅ 完了 (YYYY-MM-DD)

### 変更概要
- <1〜3 行で目的と結果>

### 主な変更ファイル
- `path/to/file.ts` — <一言>

### 関連コミット
- <hash> <message>

### 次セッションへの申し送り
- <あれば。なければ「特になし」>
```

4. 追記文をユーザーに提示し、確認後に `.claude/HANDOFF.md` の末尾（または既存フォーマットに合う位置）へ追記
5. 追記後、未完了 TODO 一覧の自動転記は **しない**（メモリルール: HANDOFF 読込時に TODO 自動表示しない）

## やらないこと

- part 単位の追記（commit log で十分）
- 完了していない TODO の事前追記
- HANDOFF.md 全体のリライト（追記のみ）
