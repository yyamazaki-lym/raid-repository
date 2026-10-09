# フォントの出どころ

`src/app/layout.tsx` が `next/font/local` で読むフォント。2026-10-09 に、ビルドのたびに Google Fonts へ取りに行く `next/font/google` から切り替えた (本番ビルドが Google Fonts の応答で 1 回落ちたため)。

どれも Google Fonts が配っている latin サブセットの可変フォント (woff2) を、そのまま置いている。2026-10-09 に Google Fonts の CSS (`fonts.googleapis.com/css2`、Chrome の User-Agent) が返した URL から取得した。

| ファイル | 取得元 | フォントの版 | 大きさ | sha256 |
|---|---|---|---|---|
| `geist-latin-wght.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFU.woff2` | 1.800 (wght 100–900) | 29,400 bytes | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `jetbrains-mono-latin-wght.woff2` | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2` | 2.211 (wght 100–800) | 40,404 bytes | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |
| `orbitron-latin-wght.woff2` | `https://fonts.gstatic.com/s/orbitron/v35/yMJRMIlzdpvBhQQL_Qq7dy0.woff2` | 2.001 (wght 400–900) | 11,800 bytes | `c25a9f9da5d9f3db1bf2a01474722dc9b377675b7bbab6d0dfda6902794fd1ed` |

- `next/font/google` がビルドで取っていたファイル (Chrome/104 の User-Agent) とは、字形・送り幅・寸法・可変軸がすべて同じで、違いは Windows 向けのヒンティング設定 (`prep` テーブル) の有無だけ
- latin 以外のサブセット (latin-ext・cyrillic・greek・vietnamese) は置いていない。その範囲の文字はフォールバック (`globals.css` の `* Fallback`、Arial) で描く
- 版を上げるときは、Google Fonts の CSS の latin ブロックから URL を取り直し、この表と `layout.tsx` の unicode-range・太さの範囲を合わせる

## ライセンス

3 つとも SIL Open Font License 1.1。本文は各 `OFL-*.txt` (google/fonts リポジトリの `ofl/<name>/OFL.txt` から取得)。
