# 完了済み TODO アーカイブ

> 各項目の詳細・経緯は `src/lib/changelog.ts` の該当バージョン項目に記載。ここでは番号と版だけ。

## 2.1 (2026-05-08)

- **(TODO #2 完結)**: #2 (PR #63 / #64 / #66) — 自前スケジュール 5 phase + 残候補 A/B/C 完結。FFLogs 部分は TODO #73 に分離。詳細は `src/lib/changelog.ts` の `2.1 (2026-05-08)` entry

## 2.1 (2026-04-30)

- **part11**: #44 仕上げ (rowIndex=0 sentinel の hash を `#stickyhead` に変更)
- **part10**: #44 微調整 (sentinel 経由で hash 抜き URL → page scroll=0)
- **part9**: #44 補正 (確定セル `/list` ジャンプの 1 行ズレ補正 `Math.max(0, rowIndex - 1)`)
- **part8**: #44 完了 (iframe per-date jump を `#row_N` hash anchor 方式に置換)
- **part7**: #53 真の完了 (iframe URL に `#comment` hash 付与)
- **part6**: #53 part 2 (initialMode を mid → top)
- **part3**: #53 part 1 (scroll 復元 fix)
- **part2**: #47 / #49 / #52
- **(初版)**: #46 / #50 / #11 phase 1-10 / #48 phase 3

## 2.1 (2026-04-29)

#21 #22 #24 #25 #26 #27 #28 #29 #30 #31 #32 #33 #34 #35 #36 #37 #39 #40 #41 #42 #43 #44 #45

## 2.0 (2026-04-28)

#19 (ロール単位ページ閲覧制御 = OAuth + 役職判定)

## 1.9 (2026-04-28)

#3 #4 #5 #6 #9 #10 #12 #13 #14 #15 #16 #17 #18

## 除外済み (再対応不要)

- top の「断絶」 Ultimate clear 表記 (異例ケース)
- Vercel デプロイ確認 (1 回きり)
- ヘビー級クリア取得 (取得済み)
- チップ縦中央揃え (1.9.38 で symmetric `py-1` に固定)
- 診断ツール (YouTube 取得テスト UI) — 2.1 で撤去 (`YOUTUBE_API_KEY` で限定公開動画も取れるため)
