/**
 * Archived release notes — entries older than the latest release.
 *
 * Loaded lazily by `settings-dialog` when the user clicks
 * "過去の更新履歴を見る". Kept in a separate module so the initial
 * client bundle only carries `RELEASES` (the most recent entry) from
 * `changelog.ts`. The archive file is fetched on demand via dynamic
 * import.
 *
 * Order: newest first, identical to `RELEASES` ordering. New archive
 * entries are prepended at the top whenever a release graduates from
 * `changelog.ts`.
 *
 * 2026-09-06: 31 entries (2.14 / 2026-09-04 back to 2.1 / 2026-05-02)
 * were moved here verbatim after the graduation rule had lapsed.
 * `scripts/check-changelog.mjs` (CI) verifies ordering, uniqueness of
 * `version|date`, and that `changelog.ts` keeps exactly one entry.
 *
 * 2026-09-06 (later the same day): the per-part `body` text was moved to
 * `docs/release-notes/v<version>-<date>.md` (one `##` section per part).
 * This module now carries titles only (~630 KB -> ~37 KB source).
 */

import type { ReleaseEntry } from "./changelog";

export const RELEASES_ARCHIVE: ReleaseEntry[] = [
  {
    version: "2.14",
    date: "2026-09-04",
    parts: [
      {
        title: "↕ 最適装備 (BiS) を並び替えられるように",
      },
      {
        title: "📱 スマホ表示の崩れを修正 (確定バッジ / ルール)",
      },
      {
        title: "✍ 空状態の説明を読みやすく整えた",
      },
      {
        title: "🔽 設定: 出欠の催促を折り畳めるように",
      },
      {
        title: "\u26a1 \u5916\u90e8\u30b5\u30fc\u30d3\u30b9\u306e\u8aad\u307f\u8fbc\u307f\u5f85\u3061\u3092\u77ed\u7e2e",
      },
      {
        title: "\u3042 \u65e5\u672c\u8a9e\u306e\u6539\u884c\u4f4d\u7f6e\u3092\u6587\u7bc0\u5358\u4f4d\u306b",
      },
    ],
  },
  {
    version: "2.14",
    date: "2026-09-03",
    parts: [
      {
        title: "🖼 コンテンツ: 背景画像の「カードに映す位置」を指定できるように",
      },
      {
        title: "🎯 練習ログ: 絶をフェーズ単位のバーにし、見出しも列を揃えた",
      },
      {
        title: "📐 練習ログ: pull 一覧の列を揃え、時刻と戦闘時間を色分け",
      },
      {
        title: "📊 練習ログ: 総 pull に層 / フェーズの内訳を表示",
      },
      {
        title: "⚔ 練習ログ: 各 pull に PT 合計 DPS と死亡数を表示",
      },
    ],
  },
  {
    version: "2.13",
    date: "2026-08-31",
    parts: [
      {
        title: "\ud83e\ude79 \u8efd\u6e1b\u8868: \u2713FALSE \u3068\u3044\u3046\u30c1\u30c3\u30d7\u304c\u51fa\u308b\u306e\u3092\u4fee\u6b63",
      },
      {
        title: "\u26a0 \u8efd\u6e1b\u8868: \u5225\u306e\u5c64\u306e\u540d\u524d\u304c\u5165\u308b\u4e0d\u5177\u5408\u3092\u4fee\u6b63 + \u767b\u9332\u306e\u524a\u9664",
      },
      {
        title: "\ud83d\udc1b \u8efd\u6e1b\u8868: \u4e00\u90e8\u306e\u5217\u3060\u3051\u540d\u524d\u304c\u53d6\u308c\u306a\u3044\u4e0d\u5177\u5408\u3092\u4fee\u6b63",
      },
      {
        title: "\ud83d\udd0d \u8efd\u6e1b\u8868: \u540d\u524d\u3092 xlsx \u304b\u3089\u8aad\u307f\u53d6\u308a\u3001\u5c64\u306e\u7279\u5b9a\u3092\u5f37\u5316",
      },
      {
        title: "\u2705 \u8efd\u6e1b\u8868: \u30a2\u30d3\u30ea\u30c6\u30a3\u540d\u3092\u81ea\u52d5\u3067\u8868\u793a (\u624b\u5165\u529b\u4e0d\u8981\u306b)",
      },
      {
        title: "\ud83c\udfaf \u8efd\u6e1b\u8868: \u5c64\u306b\u5bfe\u5fdc\u3059\u308b\u30b7\u30fc\u30c8\u3092\u672c\u6587\u306e\u4e00\u81f4\u3067\u78ba\u5b9a",
      },
      {
        title: "\ud83d\udd27 \u8efd\u6e1b\u8868: \u30a2\u30a4\u30b3\u30f3\u304c\u96a3\u306e\u30b7\u30fc\u30c8\u306e\u3082\u306e\u306b\u306a\u308b\u4e0d\u5177\u5408\u3092\u4fee\u6b63",
      },
      {
        title: "\ud83d\udee0 \u8efd\u6e1b\u8868: \u30a2\u30a4\u30b3\u30f3\u304c\u5225\u30b7\u30fc\u30c8\u306e\u3082\u306e\u306b\u306a\u308b\u4e0d\u5177\u5408\u3092\u4fee\u6b63",
      },
      {
        title: "\ud83d\uddbc \u8efd\u6e1b\u8868: \u30a2\u30a4\u30b3\u30f3\u53d6\u5f97\u3092 xlsx \u7d4c\u8def\u306b\u5909\u66f4 + \u5931\u6557\u6642\u306e\u8a73\u7d30\u8868\u793a",
      },
      {
        title: "\ud83d\uddbc \u8efd\u6e1b\u8868: \u30a2\u30a4\u30b3\u30f3\u753b\u50cf\u304b\u3089\u30a2\u30d3\u30ea\u30c6\u30a3\u540d\u3092\u81ea\u52d5\u5224\u5b9a",
      },
    ],
  },
  {
    version: "2.12",
    date: "2026-08-30",
    parts: [
      {
        title: "\ud83c\udff7 \u8efd\u6e1b\u8868: \u30a2\u30d3\u30ea\u30c6\u30a3\u540d\u306e\u8a2d\u5b9a\u3092\u4f5c\u308a\u76f4\u3057",
      },
      {
        title: "\u2714 \u8efd\u6e1b\u8868: \u5165\u308c\u308b\u30a2\u30d3\u30ea\u30c6\u30a3\u3092\u7a2e\u5225\u306e\u6a2a\u306b\u8868\u793a + \u82f1\u8a9e\u8868\u8a18\u306e\u65e5\u672c\u8a9e\u5316",
      },
      {
        title: "\ud83d\udd27 \u8efd\u6e1b\u8868: \u6570\u5024\u30e9\u30d9\u30eb\u3092\u30b7\u30fc\u30c8\u306e\u5217\u540d\u306b + \u5217\u306e\u8a2d\u5b9a/\u8a3a\u65ad\u3092\u8ffd\u52a0",
      },
      {
        title: "\ud83d\uddd1 \u7df4\u7fd2\u30ed\u30b0: \u8aa4\u3063\u3066\u53d6\u308a\u8fbc\u3093\u3060\u30ec\u30dd\u30fc\u30c8\u3092\u524a\u9664\u3067\u304d\u308b\u3088\u3046\u306b",
      },
      {
        title: "\ud83d\udee1 \u8efd\u6e1b\u8868: \u30c1\u30a7\u30c3\u30af\u306e\u5165\u3063\u305f\u30a2\u30d3\u30ea\u30c6\u30a3\u3092\u629c\u304d\u51fa\u3057\u3066\u8868\u793a",
      },
      {
        title: "\ud83c\udfa8 \u7df4\u7fd2\u30ed\u30b0: \u53f3\u5074\u306e\u5c64\u8868\u8a18\u3082\u8272\u5206\u3051",
      },
      {
        title: "\ud83d\udea9 \u8a0e\u4f10\u3057\u305f\u306e\u306b\u30d5\u30e9\u30b0\u304c\u4ed8\u304b\u306a\u3044\u4e0d\u5177\u5408\u3092\u4fee\u6b63",
      },
      {
        title: "\ud83d\uddd3 \u7df4\u7fd2\u30ed\u30b0: \u65e5\u4ed8\u30af\u30ea\u30c3\u30af\u3067\u632f\u308a\u8fd4\u308a\u3078\u30b8\u30e3\u30f3\u30d7 / 4\u5c64\u524d\u534a\u30fb\u5f8c\u534a\u306e\u8272\u5206\u3051",
      },
      {
        title: "\ud83d\udcd0 \u8efd\u6e1b\u8868: \u5c64\u30bf\u30d6\u306e\u767b\u9332 + \u62c5\u5f53\u3092\u30c1\u30c3\u30d7\u8868\u793a",
      },
      {
        title: "\ud83e\udde9 BiS \u30d7\u30ec\u30d3\u30e5\u30fc\u306e\u63fa\u308c\u3092\u4fee\u6b63 + \u52d5\u753b\u30aa\u30d5\u30bb\u30c3\u30c8\u306e\u81ea\u52d5\u767b\u9332",
      },
      {
        title: "\ud83d\uddfa \u30a6\u30a7\u30a4\u30de\u30fc\u30af\u306e\u914d\u7f6e\u30d7\u30ec\u30d3\u30e5\u30fc",
      },
      {
        title: "\ud83e\udde5 BiS \u306e\u4e2d\u8eab\u3092\u30dd\u30fc\u30bf\u30eb\u5074\u3067\u78ba\u8a8d",
      },
      {
        title: "\ud83e\uddf0 \u30dd\u30c3\u30d7\u30a2\u30c3\u30d7\u306e\u958b\u9589\u6319\u52d5\u3092\u7d71\u4e00 + \u8aad\u307f\u306b\u304f\u3044\u6587\u5b57\u306e\u5e95\u4e0a\u3052",
      },
      {
        title: "\ud83d\udd0e \u7df4\u7fd2\u30ed\u30b0\u306e\u5c64\u30d5\u30a3\u30eb\u30bf + \u4e88\u5b9a\u8868\u304b\u3089 Logs \u6574\u7406\u3078\u76f4\u884c",
      },
      {
        title: "\ud83e\udde5 BiS \u3092\u305d\u306e\u5834\u3067\u958b\u3051\u308b \u2014 XivGear \u57cb\u3081\u8fbc\u307f\u30d7\u30ec\u30d3\u30e5\u30fc",
      },
      {
        title: "\u2705 \u30a6\u30a7\u30a4\u30de\u30fc\u30af\u306e\u5f62\u5f0f\u30c1\u30a7\u30c3\u30af",
      },
      {
        title: "\ud83d\uddd3 \u4e88\u5b9a\u3092 Google \u30ab\u30ec\u30f3\u30c0\u30fc\u3078 + \u5168\u54e1\u5165\u529b\u3067\u81ea\u52d5\u78ba\u5b9a (\u4efb\u610f)",
      },
      {
        title: "\u23f0 \u51fa\u6b20\u306e\u50ac\u4fc3 \u2014 \u672a\u5165\u529b\u306e\u4eba\u3060\u3051\u306b\u81ea\u52d5\u30e1\u30f3\u30b7\u30e7\u30f3",
      },
      {
        title: "\ud83d\uddfa \u30b9\u30c8\u30e9\u30c6\u30b8\u30fc\u30dc\u30fc\u30c9\u306e\u5171\u6709\u30b3\u30fc\u30c9\u3092\u4fdd\u7ba1\u3067\u304d\u308b\u3088\u3046\u306b",
      },
      {
        title: "\ud83d\udd0d \u7df4\u7fd2\u30ed\u30b0\u304b\u3089\u6b7b\u4ea1 / \u88ab\u30c0\u30e1\u3078\u76f4\u884c + \u653b\u7565\u30ea\u30f3\u30af\u306b\u7a2e\u5225\u30d0\u30c3\u30b8",
      },
      {
        title: "\u{1F3A8} 練習ログの配色改善 — 層の識別色と残%の熱量色",
      },
      {
        title: "\u{1F6E1} 軽減表カードを簡素化 — ダメージ→軽減率→最終 + 層タブ",
      },
      {
        title: "\u{1F4CB} ルールが再クリックで閉じない不具合を修正 + BiS を攻略情報へ",
      },
    ],
  },
  {
    version: "2.11",
    date: "2026-08-30",
    parts: [
      {
        title: "\u{1F6E1} \u540c\u65e5 Logs \u306e\u4e8c\u91cd\u53d6\u308a\u8fbc\u307f\u3092\u9632\u6b62",
      },
      {
        title: "\u{1F9F9} \u300c\u91cd\u8907 Logs \u3092\u6574\u7406\u300d\u30dc\u30bf\u30f3\u3092\u8ffd\u52a0",
      },
    ],
  },
  {
    version: "2.10",
    date: "2026-08-28",
    parts: [
      {
        title: "\u{1F0CF} 軽減表カードを\u300c時間軸 + 攻撃 + 担当\u300dに再構成",
      },
      {
        title: "\u{1F9EE} 残% の精度改善 + 区切り線 + 軽減表カードの整理",
      },
      {
        title: "\u{1FA9C} 4層前半/後半に対応 \u2014 5層扱いの誤りを修正",
      },
      {
        title: "\u{1FA9C} 層表示の実データ対応 + 動画ジャンプの基準を pull #1 に",
      },
      {
        title: "\u{1FA9C} 練習ログの層対応 \u2014 クリア判定と到達度をティア基準に",
      },
      {
        title: "\u{1F4CB} レポート URL の貼り付け取り込み \u2014 unlisted の\u300c発見\u300dを人間側で補う",
      },
      {
        title: "\u{1F513} unlisted レポートを API で取得 \u2014 xivanalysis と同じ経路",
      },
      {
        title: "\u{1F6A7} FFLogs の bot 対策強化への対応 \u2014 scrape 403 の緩和と案内の現実化",
      },
      {
        title: "\u{1F6E0} private 取得の経路修正 (Edge 経由) + PC でもカード表示",
      },
      {
        title: "\u{1F510} 非公開 (private) レポートへの対応 \u2014 絶などのログが取り込めない問題",
      },
      {
        title: "\u{1F527} 実機フィードバック反映 \u2014 練習ログの精度と読みやすさ",
      },
      {
        title: "\u{1F4C8} 練習ログタブ \u2014 pull ごとの記録と振り返り",
      },
      {
        title: "\u{1F4F1} 軽減表 / ロット表がスマホで読めるように",
      },
      {
        title: "\u{1F4CD} ウェイマーク (markercode) をマクロと同じ場所で配れるように",
      },
      {
        title: "\u{1F3B2} 今週の消化チェックと最適装備 (BiS) リンク",
      },
      {
        title: "\u{1F52C} 動画カードから XIVAnalysis へ",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-08-24",
    parts: [
      {
        title: "🗑 実施しなかった日を過去ログから消せるように",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-08-05",
    parts: [
      {
        title: "🔎 日付の右の空白を詰め + 「確定」を見つけやすく",
      },
      {
        title: "📅 参加人数が増えても日付が見えるように + 表示文言の全体見直し",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-07-23",
    parts: [
      {
        title: "🔧 「起動中」表示が通常アクセスでも一瞬出てしまう件を調整",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-07-22",
    parts: [
      {
        title:
          "⚡ 久しぶりに開いたときの白画面を「起動中」表示に + 初回表示の高速化",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-07-12",
    parts: [
      {
        title:
          "🔗 日付から登録した FFLogs ログが同じ日の動画にも表示されるように",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-07-01",
    parts: [
      {
        title:
          "🛡 手入力した FFLogs ログが日次バッチで消えてしまう不具合を修正",
      },
      {
        title:
          "♿ アクセシビリティ改善 — フォームエラーの読み上げ・トグルの選択状態・入力欄の名前・確認モーダルのフォーカス管理",
      },
      {
        title: "🗓 時刻データの取り違え防止 — 不正時刻・片側欠けの拒否",
      },
      {
        title:
          "🔒 セキュリティ多層防御の底上げ (内部) — CSRF / 取得サイズ上限 / 描画サニタイズ / 入力長 / OAuth / 権限明示",
      },
      {
        title: "⚡ 動画一覧の再描画を軽量化 (内部)",
      },
      {
        title:
          "🧭 設定 — 「全 logs URL クリア」を Danger Zone（全データ初期化の隣）へ移動",
      },
      {
        title: "🧭 設定 — Danger Zone を折りたたみ式に",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-06-15",
    parts: [
      {
        title: "🗓 スケジュールの「自前作成式」を正式メニューに格上げ (準備中表記を解除)",
      },
      {
        title: "🚫 Discord 自動取り込みで特定の動画を「今後取り込まない」除外機能",
      },
      {
        title: "🟢 ヘッダーの「ONLINE」表示が実際のオンライン人数を示すように",
      },
      {
        title: "🧹 内部コード整理 — リアルタイム自動更新フックの共通化",
      },
      {
        title: "🎨 内部整理 — コンテンツカードのメトリクスバッジ色をテーマトークンに集約",
      },
      {
        title: "⚡ ログイン画面の初期読み込みを軽量化",
      },
      {
        title: "🧹 内部コード整理 — メンテナンスメニューのファイル分割",
      },
      {
        title: "🧹 内部コード整理 — 予定表 (スケジュール) の大きなファイルを分割",
      },
      {
        title: "🧹 内部コード整理 — 日付メモ popover のファイル分割",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-06-14",
    parts: [
      {
        title:
          "🛠 日付まわりの細かな不具合修正 — クリア日ジャンプのタイムゾーン依存 + 動画日付の誤判定",
      },
      {
        title:
          "🧹 内部コード整理 — React 19 / Next.js 16 の現行 API への追従 + 未使用コード削除",
      },
      {
        title:
          "🔧 ドラッグ並び替えの「一瞬だけ古い順に戻るちらつき」を解消 + 内部共通化",
      },
      {
        title:
          "📝 日付メモを管理者以外のメンバーも編集できるように",
      },
      {
        title:
          "💬 削除などの確認ダイアログをサイト統一デザインに",
      },
      {
        title:
          "🔤 日本語ラベルのフォントを統一 — レトロ等幅+広い字間は英字専用に",
      },
      {
        title:
          "🎨 ステータス色を内部トークン化 + カテゴリ名を強調",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-06-13",
    parts: [
      {
        title:
          "🔒 セキュリティ強化 2 件 — ログイン後リダイレクトの検証強化 + 管理者専用 DB 操作の権限チェック多重化",
      },
      {
        title:
          "🔒 一部の編集操作が権限なしでも「成功」と表示される問題を修正",
      },
      {
        title:
          "🧹 上部ヘッダー / タブの固定表示位置の内部リファクタ（見た目は変更なし）",
      },
      {
        title:
          "♿ 「視差効果を減らす」設定に対応 — 背景アニメ・点滅を停止",
      },
      {
        title:
          "🛠 自動取り込み・自動通知の二重化を防止（内部の堅牢性向上）",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-06-12",
    parts: [
      {
        title:
          "🎨 UI 全体のデザイン整合性を一括調整 — 余白 / サイズ / 書式の揺れ 13 箇所",
      },
      {
        title:
          "🎨 上部タブ (スケジュール / コンテンツ) の内側余白の偏りを修正",
      },
      {
        title:
          "⚙️ FFLogs 日次自動連動 (cron) の ON/OFF トグルを設定ダイアログに追加",
      },
      {
        title:
          "🐛 非表示に設定したタブのアイコンがコンテンツカードに出ていた問題を修正",
      },
      {
        title:
          "🐛 ページ下部でメモのポップアップが見切れて読めない問題を修正",
      },
      {
        title:
          "🐛 出欠「未回答に戻す」の RLS silent fail 修正 + symbol 制約の DB 層追加 (RLS 監査残課題)",
      },
      {
        title:
          "🔒 placeholder 時刻更新 RPC の anon 実行可能状態を修正 (明示 REVOKE 追加)",
      },
      {
        title:
          "🔍 2.9 リリース後の総点検 — 精査で見つけた潜在課題 4 件を修正",
      },
    ],
  },
  {
    version: "2.9",
    date: "2026-06-11",
    parts: [
      {
        title:
          "🔥 warmup ping cron 追加 — アイドル後の cold start 3.4 秒を常時 warm 化で解消",
      },
      {
        title:
          "🛰️ FFLogs scrape を Edge route 中継に変更 — Node 化で恒常 403 になった HTML scrape を修復",
      },
      {
        title:
          "⚡ デプロイ後/アイドル後の初回表示が遅い問題の対策 — TOP を Node runtime 化 + 直列クエリ並列化",
      },
      {
        title:
          "🌀 ロード中スピナー拡充 — TOP へのタブ遷移に即時 \"Now Loading\" + ナビに pending インジケーター",
      },
    ],
  },
  {
    version: "2.8",
    date: "2026-06-11",
    parts: [
      {
        title:
          "📊 FFLogs — unfiltered 再実測の結果確定 (自分名義 0 件) を受けて診断コードを撤去",
      },
      {
        title:
          "🔍 FFLogs — Private/Unlisted 取得の再実測 (unfiltered reports) + Cookie 診断表示の実態化",
      },
      {
        title:
          "🔒 セキュリティ監査対応 — 依存更新 / 認可ガード / SSRF 多層防御 / cron 認証強化",
      },
      {
        title: "🧹 ESLint error 一掃 + CI (lint / 型チェック) ゲート新設",
      },
      {
        title: "🐛 category-list の rules-of-hooks 実バグ修正 (merge 後の精査で発見)",
      },
      {
        title:
          "🐛 FFLogs 日次自動連携が cron 経路で silent に書き込めていなかった問題を修正",
      },
      {
        title:
          "🛡️ 追加監査 — Discord 通知本文への非 admin テキスト注入を防止",
      },
      {
        title:
          "📝 ロール制限カテゴリの位置づけを明文化 (機密境界ではない)",
      },
    ],
  },
  {
    version: "2.7",
    date: "2026-06-11",
    parts: [
      {
        title:
          "🕛 PR — 過去簡易チップの past 判定を詳細テーブルと同じ「JST 今日 0:00」に統一",
      },
    ],
  },
  {
    version: "2.7",
    date: "2026-06-10",
    parts: [
      {
        title:
          "🚪 PR — TODO #91 follow-up: demo ゲスト時の設定ダイアログ footer に「Sign in」導線を表示",
      },
      {
        title:
          "🔓 PR — TODO #91 クローズ: デモサイトで owner だけ編集可能に (実セッション優先 + ゲスト fallback)",
      },
    ],
  },
  {
    version: "2.6",
    date: "2026-06-10",
    parts: [
      {
        title: "🧭 PR — TODO #90: SubTabs の active tab がモバイル初期表示で画面外に出るケースを解消",
      },
      {
        title: "📱 PR — TODO #7: モバイル幅 (375px) レイアウト監査 + 攻略タブ header の折返し spill 修正",
      },
      {
        title: "🪄 PR — TODO #51 P3 (観点 8+9): アコーディオン行の hover 補完 + transition duration 規約の明文化 (#51 最終 phase)",
      },
      {
        title: "📝 PR — TODO #51 P2-6+7: URL 入力の onBlur 即時バリデーション + empty state の共通 component 化",
      },
      {
        title: "💀 PR — TODO #51 P2-5: /category 配下に CSS-only loading skeleton 追加",
      },
      {
        title: "⏳ PR — TODO #51 P2-4: 保存 button の pending spinner 統一 (dialog 系 5 箇所)",
      },
      {
        title: "✨ PR — TODO #51 P1: マイクロインタラクション polish 第 1 弾 (toast 設定明示化 / press feedback 統一 / focus ring 補修)",
      },
      {
        title: "🕘 PR — TODO #85 クローズ: native placeholder の default 時刻遡及更新 (Default Raid Time 変更時に未来日付 placeholder を新値で自動更新)",
      },
      {
        title: "🔗 PR — TODO #73 follow-up: native スケジュールに FFLogs URL manual link 追加 / 削除 UI",
      },
      {
        title: "🏷 PR — TODO #81 follow-up: placeholder 行に「auto」chip + native session に note 編集 UI",
      },
      {
        title: "🕒 PR — TODO #81 follow-up: 候補日追加 dialog の時刻初期値を app_settings default に追従",
      },
      {
        title: "⏱ PR — TODO #73 follow-up: FFLogs 連携の日次 cron 自動化 (`/api/cron/fflogs-sync`、JST 04:00 daily)",
      },
    ],
  },
  {
    version: "2.5",
    date: "2026-06-10",
    parts: [
      {
        title: "🔗 PR — TODO #73 クローズ: FFLogs 連携 native 拡張 (status='DECISION' な native session に auto-link)",
      },
    ],
  },
  {
    version: "2.4",
    date: "2026-06-10",
    parts: [
      {
        title: "🔧 PR — pg_cron 再登録を idempotent 化 (TODO #2 24h 観察 follow-up、jobid 安定化)",
      },
    ],
  },
  {
    version: "2.4",
    date: "2026-06-09",
    parts: [
      {
        title: "🩹 PR — TODO #82 follow-up: Vercel Marketplace「Upstash for Redis」が注入する KV_* env prefix に対応",
      },
      {
        title: "🛡️ PR — TODO #84: CSP `script-src 'unsafe-inline'` を nonce 化 (proxy.ts でリクエスト毎に注入)",
      },
      {
        title: "🛡️ PR — TODO #82: rate-limit を Upstash Redis 分散実装に置換 (Vercel Marketplace 連携が前提)",
      },
      {
        title: "🧹 PR — TODO #83: sort_order 計算 RPC 化を recruitment_templates / category_macros に横展開",
      },
    ],
  },
  {
    version: "2.3",
    date: "2026-06-09",
    parts: [
      {
        title: "🛡️ PR — Discord 画像 migrate の SSRF 強化 + cron error body 整理 + first_clear 系 action に admin gate + sort_order 計算を Postgres RPC 化",
      },
      {
        title: "📝 PR — fflogs OAuth error の URL echo をスリム化 + 全 cron スケジュール表を cron-auth.ts に集約 (Low 2 件)",
      },
      {
        title: "🔧 PR — cron 認証ヘルパ抽出 + 全 cron route の maxDuration を 60s → 300s に統一",
      },
      {
        title: "🔒 PR — セキュリティ Critical 5 件まとめ修正 (fflogs route admin gate / OAuth state を cookie 化 / page-title SSRF + rate limit / app_settings 平文 fallback 撤去 / DISCORD_ADMIN_ROLE_IDS fail-closed 化)",
      },
    ],
  },
  {
    version: "2.2",
    date: "2026-06-05",
    parts: [
      {
        title: "🔧 PR #134 — Discord URL 取り込み cron を 23:00 JST → 01:00 JST に変更",
      },
      {
        title: "🐛 PR #133 — Vercel cron が anon 権限で動いて RLS に弾かれ、Discord URL 取り込み / schedule snapshot が 4/29 以降ほぼ停止していた問題を修正",
      },
    ],
  },
  {
    version: "2.2",
    date: "2026-05-15",
    parts: [
      {
        title: "🐛 PR #132 — 上のコンテンツタブのカテゴリ切替は「現在のサブタブを引き継ぐ + 非表示タブのみ defaultTab にフォールバック」に再調整 (PR #128 挙動見直し)",
      },
      {
        title: "🐛 PR #130 — Discord 添付画像 URL を Storage に自動退避して 24h 失効を回避",
      },
      {
        title: "✨ PR #128 — 上の「コンテンツ」タブからのカテゴリ切替もカテゴリごとの既定タブ (defaultTab) に着地させる",
      },
    ],
  },
  {
    version: "2.2",
    date: "2026-05-13",
    parts: [
      {
        title: "🐛 PR #125 — Lightbox の ← → キーと画像左右半分クリックでの前後遷移を本対応 (PR #124 の後追い fix)",
      },
      {
        title: "✨ PR #124 — 攻略タブ: リンク追加ボタン改名 + Google フォトアルバム折りたたみ + Lightbox 前後遷移を一括導入",
      },
      {
        title: "🎉 PR #123 (Phase 17) — カテゴリごとの既定タブ / SubTabs 表示 ON/OFF + 名前変更 / 攻略タブセクション折りたたみ",
      },
      {
        title: "✨ PR #122 — 画像追加ダイアログに Google フォト URL 判定を統合 + アルバム scrape からプロフィールアバター除外",
      },
      {
        title: "🎉 PR #121 (Phase 16) — Google フォト共有アルバムを攻略タブに展開 (kind=gphoto / category_gphoto_albums)",
      },
      {
        title: "✨ PR #120 — 画像追加ボタンも stuck 時に SubTabs 右端へ追従 (攻略リンク追加と portal target を統一)",
      },
      {
        title: "🐛 PR #119 — 攻略画像 Lightbox の画像外クリックで閉じる挙動を修正 (<Image fill> letterbox 透明域問題)",
      },
      {
        title: "🎉 PR #118 (Phase 15) — 攻略タブに画像エントリ (kind=image) を追加 + Storage バケット + Lightbox",
      },
    ],
  },
  {
    version: "2.1",
    date: "2026-05-08",
    parts: [
      {
        title: "🤖 TODO #78 — schema.sql / seed-demo.sql の SQL 投入を GitHub Actions で自動化 (fork は repo secret 1 個登録するだけで以後 push のみ反映、psql 直叩きで CLI 学習コスト 0)",
      },
      {
        title: "🧹 TODO #76 follow-up — Section 11 sample categories も demo 扱いに格上げして seed-demo.sql に集約 (本番 fork は空 portal で起動)",
      },
      {
        title: "🧹 TODO #76 — schema.sql の demo seed を seed-demo.sql に分離 (本番再実行時の誤挿入を構造的に根治)",
      },
      {
        title: "🛠 TODO #2 候補 B 後処理 — Vercel Hobby cron 制約を Supabase pg_cron で回避し、通知時刻 HH 設定を本対応",
      },
      {
        title: "🎉 TODO #2 完結 — 自前スケジュールの残候補 3 件 (sync cron skip / 通知時刻 HH 設定 / 動画リンク表示) 全実装で TODO #2 を close",
      },
    ],
  },
  {
    version: "2.1",
    date: "2026-05-07",
    parts: [
      {
        title: "🆕 TODO #2 phase 2-C — native スケジュール settings 管理 UI 3 section (members CRUD / 凡例 CSV editor / CANCELLED 行復帰) で自前モードが実運用可能に",
      },
      {
        title: "🆕 TODO #2 phase 2-B — native スケジュール UI 第 1 弾 (admin 候補日追加 dialog + 本人出欠入力 popover + admin status toggle dropdown) で native mode が実利用可能に",
      },
      {
        title: "🆕 TODO #2 phase 1 — スケジュールソースモード切替 (`sync` / `native` / `disabled`) を追加、自前スケジュール用テーブル 3 件を schema 化 (実装は phase 2 以降)",
      },
      {
        title: "✅ TODO #72 案 J — Claude 自前観察 (demo + Claude in Chrome) で真因 (rapid 連続 hover で複数 Popover 同時 close → React 19 batch race で `data-open=\"\"` 残置) 確定、`{open && <PopoverContent>}` controlled unmount で根絶",
      },
      {
        title: "🩹 TODO #72 案 T — 案 E も本番残留継続 → Base UI ソース調査で真因 (React 19 + production の `useTransitionStatus` race) 特定、`<Portal keepMounted>` で構造的回避 + DOM 直接操作系防御層 (案 B / part3) を撤去",
      },
      {
        title: "🩹 TODO #72 案 E — 案 D / A / B いずれも本番残留継続 → 発想転換: `[&:not([data-open])]:hidden` で「DOM 残留しても visual に出ない」CSS 防御層",
      },
      {
        title: "🩹 TODO #72 案 B — 案 A も本番継続 → 常駐 MutationObserver で残留 popover node を物理 GC",
      },
      {
        title: "🩹 TODO #72 案 A — 案 D 効果なし (本番ユーザー実機で残留継続) → bootstrap で `triggerRef.click()` 同期発火に切替",
      },
      {
        title: "🩹 TODO #72 案 D — popover hover-only 経路 (リロード後初回) の白枠残留を `triggerRef.focus({ preventScroll: true })` で click 経路と等価化",
      },
      {
        title: "🩹 TODO #71 part3 — 残留検知時に `stale.remove()` で物理削除を追加 + selector を `:not([data-open])` に絞り込み (part2 でも本番白枠が継続したため強化)",
      },
      {
        title: "🩹 TODO #71 follow-up — 常時 remount で hover 連続反応が阻害される副作用を「DOM 残留検知時のみ remount」に縮退",
      },
      {
        title: "🐛 TODO #71 クローズ — TODO #70 follow-up: production build のみで残る popover DOM 残留を `<Popover key={remountKey}>` 強制 remount で根絶",
      },
      {
        title: "🐛 TODO #70 クローズ — スケジュール各員コメント popover の close 時に「白枠だけ残る」現象を Strategy G (CSS exit transition 撤去) で根絶",
      },
      {
        title: "🐛 TODO #69 クローズ — schedule_past_sessions に CANDIDATE 行が混入するバグを修正 (snapshot DECISION-only filter + 既存 CANDIDATE row 自動 cleanup)",
      },
    ],
  },
  {
    version: "2.1",
    date: "2026-05-02",
    parts: [
      {
        title: "🔧 TODO #68 part10 — 詳細診断 chunk を「details 開時のみマウント」する controlled 構造に強化",
      },
      {
        title: "📦 TODO #68 クローズ — `fflogs-sync-section.tsx` 内の詳細診断パネル (~190 行) を `next/dynamic({ ssr: false })` で別 chunk に分離",
      },
      {
        title: "🪟 TODO #65 クローズ — Film/Logs dropdown スクロール時の 3 段階ちらつきを Strategy G (CSS exit transition 撤去) で根絶",
      },
      {
        title: "🧹 TODO #66 クローズ — `settings-dialog.tsx` (1,761 行 / 88 KB) を 5 つの sub-component に機能別分割",
      },
      {
        title: "📦 TODO #67 クローズ — `changelog.ts` (629 行 / 234 KB) を最新リリース 1 件 + `changelog-archive.ts` に分離 + dynamic import で lazy load",
      },
      {
        title: "🗂 TODO #64 クローズ — schedule_past_sessions の logs_url を子テーブル `schedule_past_session_logs` に分離 (1 セッション = 複数 FFLogs URL)",
      },
      {
        title: "⚡ TODO #55 クローズ — スケジュール TOP の Vercel Data Cache を `updateTag` 即時無効化方式で復活 (FCP 短縮)",
      },
      {
        title: "🎨 設定タブの更新履歴を 1 行サマリーのみ表示に簡略化 — part body 折りたたみ撤去",
      },
      {
        title: "🎨 TODO #62 クローズ — schedule 凡例を character-sheets `/schedule/edit` の「日程オプション」から動的生成",
      },
      {
        title: "🐛 TODO #61 クローズ — DECISION 行が CANDIDATE 描画される + ルールに「日程状況一覧」混入を解消",
      },
    ],
  },
  {
    version: "2.1",
    date: "2026-05-01",
    parts: [
      {
        title: "🎬 TODO #1 クローズ — スケジュール表の動画 / Logs アイコンを同日複数件で DropdownMenu 化",
      },
      {
        title: "🎨 TODO #60 クローズ — schedule 出欠記号にカスタムラベル (昼/夜/全 等) を許容",
      },
      {
        title: "🐛 TODO #59 クローズ — schedule 時間レンジ未入力時のメンバー欄が空になる不具合を修正",
      },
      {
        title: "🌐 TODO #8 クローズ (part C-ii + E) — Demo data bulk seed + PUBLIC_DEMO_MODE フラグ",
      },
      {
        title: "🛡 TODO #23 クローズ — 設定ダイアログ末尾に Danger Zone 追加 + 全データ初期化ボタン (admin 限定 + 2 段階確認)",
      },
      {
        title: "✨ TODO #57 クローズ — スケジュール TOP の Suspense fallback に遅延 fade-in 'Now Loading' を投入",
      },
      {
        title: "📌 TODO #58 part2 — /category 一覧の Maintenance/追加ボタンを MainTabs 右端 portal へ追従 + macros は元位置 + 複製ボタン両表示方式へ変更",
      },
      {
        title: "📌 TODO #58 part1 (クローズ済) — sub-nav stuck 時に各 page アクションボタンを SubTabs 右端へ portal 集約 (+ 振動ループ抑止)",
      },
      {
        title: "✨ TODO #56 part2 — sub-nav stuck 時に Contents 戻りリンクを左端追加 + MainTabs/SubTabs の縦スペース詰め",
      },
      {
        title: "📌 TODO #56 クローズ — カテゴリ詳細 sub-nav を sticky top + scroll 連動 collapsed 形へ",
      },
      {
        title: "🌐 TODO #20 クローズ — Vercel ドメイン変更 (`raid-repository.vercel.app` → `yurutto-raid-repository.vercel.app`)",
      },
      {
        title: "⚡ TODO #55 part2 — スケジュール TOP に Suspense streaming 投入 (FCP 短縮狙い)",
      },
      {
        title: "⚡ TODO #55 part1 — スケジュール TOP の外部 scrape TTL を 30 分へ + videos プリフィルタ",
      },
      {
        title: "🗑️ 死コード除去 — `next-nprogress-bar` 依存と `top-progress-bar.tsx` を撤廃 (TODO #54 part1 取り下げの後始末)",
      },
      {
        title: "🎨 過去簡易ログの祝日チップを文字色のみ赤に変更 + TODO #55 追加 (スケジュールページ軽量化)",
      },
      {
        title: "✅ TODO #54 クローズ — Vercel デプロイ後の遷移ロード再発を Edge → Node runtime 個別判定で解決 (本番体感確認済)",
      },
      {
        title: "⚡ TODO #54 part3 横展開 — カテゴリ系全 5 ページを Edge → Node runtime 化 (cold start 短縮)",
      },
      {
        title: "⚡ TODO #54 part3 第一歩 — 動画ページのみ Edge → Node runtime に切替 (cold start 試験投入)",
      },
      {
        title: "🗑️ warmup-vercel GitHub Action と `/api/health` を撤廃 (TODO #11 遺物整理)",
      },
      {
        title: "♻️ TODO #54 part2-c / part2-d を build-safe な単独 commit で再投入",
      },
      {
        title: "🔙 TODO #54 part2 系を全 revert (Vercel build 連続失敗による撤退)",
      },
    ],
  },
  {
    version: "2.1",
    date: "2026-04-30",
    parts: [
      {
        title: "🚧 デプロイ直後遷移の無音 stuck 体感を top progress bar で改善 (TODO #54 part1)",
      },
      {
        title: "🎯 確定セル 最古未来日 のジャンプ位置を `#stickyhead` で揃える (TODO #44 part11)",
      },
      {
        title: "🎯 確定セル 最古未来日 (rowIndex=0) のジャンプを修正 (TODO #44 part10)",
      },
      {
        title: "🎯 確定セル `/list` ジャンプの 1 行ズレを `rowIndex - 1` 補正 (TODO #44 part9)",
      },
      {
        title: "🎯 編集 iframe の per-date jump を `#row_N` URL hash anchor 方式に置換 (TODO #44 完了)",
      },
      {
        title: "🎯 編集 iframe URL に `#comment` hash anchor を付けて初期スクロール位置を最適化 (TODO #53 真の完了)",
      },
      {
        title: "✅ 編集 iframe ダイアログのデフォルト表示を mid → top に変更 (TODO #53 part6, 後に part7 で真の完了)",
      },
      {
        title: "🪜 ダイアログを閉じた後にスクロール位置がズレる事象を防御 (TODO #53)",
      },
      {
        title: "🏷 累計時間バッジの文言 + 配色を status 依存に (TODO 追加要望)",
      },
      {
        title: "🛟 動画ページ 選択モードの動線改善 (フォロー: TODO #47 / #52)",
      },
      {
        title: "⭐ 動画お気に入り機能 + 「お気に入りのみ」フィルタ (TODO #47)",
      },
      {
        title: "⏱ 選択中動画の合計再生時間をクリア時間として保存するボタン (TODO #52)",
      },
      {
        title: "🛟 動画削除時にスクロールが頭に戻る挙動を抑止 (TODO #49)",
      },
      {
        title: "🚫 過去詳細表のユーザ名クリック編集を無効化 (TODO #50)",
      },
      {
        title: "🌀 framer-motion 復活 + on-demand UI を更に lazy 化 (TODO #11)",
      },
      {
        title: "🪶 framer-motion 撤廃 + Toaster dynamic import で client bundle ~46KB gz 削減 (TODO #11)",
      },
      {
        title: "🔄 schedule_session_memos の Realtime を親 1 channel に集約 (TODO #11)",
      },
      {
        title: "🛡 Next.js 標準 deploymentId 有効化でデプロイ直後の skew 解消 (TODO #11)",
      },
      {
        title: "⚡ 上部 Film アイコン → 動画ページ遷移の重さ改善 (TODO #11)",
      },
      {
        title: "⚡ TOP `buildSessionVideoLinkMap` を O(n·m) → O(n+m) に (TODO #11)",
      },
      {
        title: "🛡 デプロイ後 navigation 失敗対策 + hover prefetch (TODO #11/#48)",
      },
      {
        title: "🚀 画像最適化 + Realtime payload delta 化 (TODO #11/#48)",
      },
      {
        title: "📅 過去日程が保存されない不具合修正 (TODO #46)",
      },
      {
        title: "⚙ メンテナンスメニューを DropdownMenu に集約 + Hobby plan 25s 上限対応で 3 phase 個別実行に分割",
      },
      {
        title: "📎 攻略チャンネルから軽減表 / ロット sheet URL を自動紐付け (TODO #37)",
      },
      {
        title: "🖼 軽減表 / ロット iframe にズームトグル追加 (TODO #43)",
      },
      {
        title: "📅 スケジュール各セルから該当日 iframe スクロールジャンプ (TODO #44)",
      },
      {
        title: "🔑 カテゴリ編集に「FFLogs マッチワード」追加 (TODO #45)",
      },
      {
        title: "🔗 FFLogs auto-link: 1 レポート → 同日複数動画 OK に緩和",
      },
      {
        title: "🔍 FFLogs Logs 取り込みの 2 段階バグ修正 (TODO #45 完了)",
      },
      {
        title: "🩹 FFLogs scrape 失敗時に session cookie を消さないよう修正 (TODO #45 即効対応)",
      },
      {
        title: "🛡 セキュリティ強化フェーズ 6: Server Action エラー汎用化 + OAuth/cron rate limit (TODO #40, #41)",
      },
      {
        title: "🖼 CSP img-src 緩和 (画像リセット問題対策) + 🎯 開催中バッジ「挑戦中」表記 (TODO #39, #42)",
      },
      {
        title: "🔐 セキュリティ強化フェーズ 5: RLS で書き込みを is_admin claim 限定に (TODO #36 phase 2)",
      },
      {
        title: "🛡 セキュリティ強化フェーズ 4: RLS で書き込みを authenticated 限定に (TODO #36 phase 1)",
      },
      {
        title: "🔐 セキュリティ強化フェーズ 3: CSP enforce 切替 + FFLogs token を AES-256-GCM 暗号化保管 (TODO #33, #35)",
      },
      {
        title: "🛡 セキュリティ強化フェーズ 2: CSP を Report-Only で投入 (TODO #33)",
      },
      {
        title: "🔒 セキュリティ強化フェーズ 1: 各種ヘッダー追加 + Storage bucket policy 厳格化 (TODO #32, #34)",
      },
      {
        title: "🔗 TODO #31 実装: 軽減表 / ロット管理ページの紐付け解除 UI + 軽減表テンプレート案内",
      },
      {
        title: "🔐 admin gate 強化: settings dialog 全 DB 書き込み + category_links CRUD + 過去詳細名前メモ撤去",
      },
      {
        title: "🗑 schedule_past_sessions の個別削除 UI",
      },
      {
        title: "🛡 TODO #24 続報 2: 過去日程は Discord/snapshot を authoritative source に + FFLogs scraper UA を実ブラウザ化",
      },
      {
        title: "🎯 TODO #24 さらに修正: ◯ fallback を撤去して DECISION 限定に",
      },
      {
        title: "🧹 TODO #24 続報: Discord 取り込みの過去表示 + 未来日時クリーンアップ",
      },
      {
        title: "🩹 TODO #24/#30 のフォローアップ修正",
      },
      {
        title: "📝 /category 説明文更新 + ダイアログヘッダー更新 + ロールセクション折りたたみ + 動画追加 UI 撤去",
      },
      {
        title: "🧩 TODO #25-27 実装 (説明文 / 手動クリア時間 / 動画追加) + #28 padding で右端揃え + 累計時間 lowercase",
      },
      {
        title: "🧹 カード layout 再調整 (Status を icon 行に / Trophy + Hourglass のみ右上) + メンテを単独ボタンに",
      },
      {
        title: "🧰 メンテ 1 ボタン化 + クリア累計時間/Trophy を上揃え + カードサイズ固定 + Trophy 遷移スクロール修正",
      },
      {
        title: "🛠 メンテに「全部実行」追加 + Trophy バッジを Status と同列に移設",
      },
      {
        title: "🩹 posted_at の取得元を YouTube uploadDate 優先に反転 (TODO #22 追加対応)",
      },
      {
        title: "🎯 スケジュール↔動画の紐付けをタイトル日付ベースに (TODO #22)",
      },
      {
        title: "🔧 2 ヶ月畳みのスクロール挙動を再修正 (視点保存方式へ)",
      },
      {
        title: "🔁 2 ヶ月畳みボタン押下時のスクロール固定 + サインアウトを設定ダイアログ内に移設",
      },
      {
        title: "📚 過去日程の詳細ログで 2 ヶ月以上前を畳む",
      },
      {
        title: "🔁 カテゴリ編集後の UI 即時反映 + サインアウト確認ダイアログ",
      },
      {
        title: "👑 admin ロール持ちのみカテゴリ編集可に (TODO #21)",
      },
    ],
  },
  {
    version: "2.0",
    date: "2026-04-29",
    parts: [
      {
        title: "🔓 ロール制限カテゴリの「戻せない」問題を解消 + 拒否ページの折返し修正",
      },
    ],
  },
  {
    version: "2.0",
    date: "2026-04-28",
    parts: [
      {
        title: "🛡️ ロール単位のページ閲覧制御 (TODO #19)",
      },
      {
        title: "🔐 サイト全体を Discord メンバー限定に (PR #1)",
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-04-28",
    parts: [
      {
        title: "📤 コンテンツカード背景画像にローカルアップロードを追加 + 文字埋もれ修正",
      },
      {
        title: "🖼️ コンテンツカードに背景画像を設定可能にする (TODO #17)",
      },
      {
        title: "🚚 募集文テンプレの DnD をカテゴリブロック単位の sortable に再設計 (TODO #16)",
      },
      {
        title: "🎬 過去日程の動画アイコンを直接外部リンクへ (詳細表 + 簡易チップ両方、Logs と同じ挙動)",
      },
      {
        title: "🔔 各人のコメントに更新があった場合、ヘッダーの吹き出しアイコンを amber でハイライト (TODO #14)",
      },
      {
        title: "↩️ 動画ページの theater mode (ポップアップ拡大) を撤去 — シンプルなカード内 inline 再生に戻す",
      },
      {
        title: "🎬 ポップアップ後 play 方式に変更 + 別動画を開くと前を自動 close",
      },
      {
        title: "🎯 theater mode のアスペクト比崩れと背景透けを根治",
      },
      {
        title: "🪟 theater mode を 3 件改善 (上部見切れ修正 + 自動サイズ調整 + ちらつき解消)",
      },
      {
        title: "🎭 動画ページ内再生を theater mode で拡大表示 (sticky header に被らない)",
      },
      {
        title: "🩹 動画 embed エラー 153 を Zenn 記事準拠で再修正 + 強調表示の挙動統合",
      },
      {
        title: "🎥 動画ページに 3 件追加改善 (embed 救済 + 余白クリック遷移 + 強調 auto-off)",
      },
      {
        title: "🎬 動画ページに 3 件改善 (TODO #10 anchor jump + カスタム逆順修正 + 通信量削減)",
      },
      {
        title: "🧹 Suspense streaming + skeleton を一旦撤去 (体感比較のため)",
      },
      {
        title: "🌏 Vercel Function の Region を Tokyo (hnd1) に固定 (USA → JP) ",
      },
      {
        title: "🩹 Suspense streaming スケルトンのボタン枠ズレを修正",
      },
      {
        title: "🔢 バージョン管理体系を MAJOR.MINOR (YYYY-MM-DD) 方式へ移行",
      },
      {
        title: "📝 マクロ未登録時のプレースホルダー文を簡潔化",
      },
      {
        title: "🔗 攻略リンクのアイコンをサイト種別で色分け (Web / 動画 / X)",
      },
      {
        title: "🎬 動画リンクのアイコンを 5 種に細分化 (YouTube / Twitch / ニコニコ / X / Web)",
      },
      {
        title: "📐 動画カードの高さばらつきを 44px → 5px に圧縮",
      },
      {
        title: "📏 動画カードを更に縦に 35px 圧縮 (350px → 315px)",
      },
      {
        title: "🚦 ヘッダーバッジに「デプロイ識別色」を導入 (7 色サイクル)",
      },
      {
        title: "🗂 更新履歴を折りたたみ + コミット単位の part 分け表示に",
      },
      {
        title: "🔀 マクロページの募集文テンプレに DnD 並び替え追加 (トップページ連動)",
      },
      {
        title: "📦 更新履歴に「もっと見る」ボタン (5 件以降は省略)",
      },
      {
        title: "📋 トップの「テンプレ」ポップアップに DnD + カテゴリ折りたたみ + マクロページリンク",
      },
      {
        title: "🌅 ヘッダー色を日付跨ぎでデフォルト (cyan) にリセット",
      },
      {
        title: "🏷 過去活動履歴の見出し名を「簡易ログ / 詳細ログ」に差別化",
      },
      {
        title: "✏️ 運用ルール popup を inline 編集 + オリジナル/編集後トグルに刷新",
      },
      {
        title: "🩹 運用ルール popup の保存後フリッカー / トグル非表示 / 反映遅延を修正 (3 件)",
      },
      {
        title: "🔄 同期 (refresh) 後も override が保持されるよう view 自動同期を強化",
      },
      {
        title: "🐛 運用ルール override が DB に保存できていなかったバグを修正 (Server Reference proxy 化問題)",
      },
      {
        title: "🛡 楽観 state の reset 条件を厳格化 (prop 不一致時は保持)",
      },
      {
        title: "🔗 設定ダイアログに FF14 Lodestone (公式) リンクを追加",
      },
      {
        title: "🔣 取り込み文字の HTML エンティティ decode を網羅化 (TODO #13)",
      },
      {
        title: "⚡ 重いダイアログ系を `next/dynamic` で別 chunk 化してリロード時間短縮 (TODO #11)",
      },
      {
        title: "⚡ スケジュール page の memo を server prefetch して N 個の SELECT クエリを回避 (TODO #11)",
      },
      {
        title: "🗂 更新履歴を最新 5 件のみに絞り、それ以前は GitHub commits リンクへ (bundle 軽量化)",
      },
      {
        title: "🚀 / ページを Edge Runtime 化 + 5 分毎の warm-up cron でコールドスタート抑制",
      },
      {
        title: "🌊 Suspense streaming で初期 paint を即時化 (TODO #11)",
      },
    ],
  },
  {
    version: "1.9.38",
    date: "2026-04-28",
    notes: [
      "🏳️ チップ縦中央の追求を断念し、シンプルな `inline-flex items-center py-1 leading-tight` に戻す。1.9.28-1.9.37 で試した h-6 + leading-6 / leading-none / asymmetric padding / translateY / inline-grid + place-items-center などのいずれも、Windows / Yu Gothic UI 環境での font metric 非対称を完全には吸収できず、副作用 (アイコンとのズレ) が出ていた。Windows ユーザーにはわずかな上寄りの空白が残るが、アイコン整列が崩れないことを優先",
    ],
  },
  {
    version: "1.9.37",
    date: "2026-04-28",
    notes: [
      "📐 チップ縦中央: `translateY` を撤回。日付スパンだけ動かしていたので「アイコンが日時から下にずれる」問題が起きていた。代わりに chip 全体に `pt-0 pb-1.5` の非対称 padding → 日付・アイコン双方が同じ量だけ上方にシフト。両者の baseline を維持",
      "🎨 ルールボタン位置を修正: 凡例左寄り → 更新ボタン横の右端 1 グループに統合 (`ml-auto` を group コンテナに適用)。ポップオーバーは `right-0` で button right-edge 揃え、画面右端からの overflow を抑制",
      "🎯 `parseTopText` が `■コメント` 直前で truncate するように修正。コメント内容が運用ルール表示に混入しないように。コメントは出席表ヘッダーの著者名横で別途表示しているため重複も解消",
    ],
  },
  {
    version: "1.9.36",
    date: "2026-04-28",
    notes: [
      "💬 ルールアイコンを「未回答 (－)」横から凡例の右寄りに移動。アイコンのみから「ルール」ラベル付きボタンに変更し、より目立つ位置に独立配置",
      "📐 ルールポップオーバーの幅を `w-[min(20rem,...)]` (320px) → `w-[min(36rem,...)]` (576px) に拡張、フォントサイズも 11px → 12px に上げて読みやすく",
      "🎯 `parseTopText` の HTML エンティティ / 絵文字対応を強化 — 数値文字参照 `&#xNNN;` `&#NNN;` を `String.fromCodePoint` でデコード、`<img alt=\"絵文字\">` 形式の Twemoji も alt テキストを抽出",
      "📐 チップ縦中央: `translateY(-2px)` → `-3px` に強化。Linux/Noto では下寄り過剰になるが、Yu Gothic UI ユーザーの可読性を優先",
    ],
  },
  {
    version: "1.9.35",
    date: "2026-04-28",
    notes: [
      "🔬 Claude Preview の dev server 経由でチップ縦中央問題を実測。Linux/Noto 環境では 4.5/5.5 px と OS 側で既に近似中央。Windows / Yu Gothic UI ユーザーの「上 2x 下」の報告は font 固有の glyph 描画位置によるものと判断。`transform: translateY(-2px)` を inner span に適用し、Yu Gothic UI 環境で中央 (約 4.5/5.5) に揃うよう物理シフト",
      "💬 凡例の「未回答 (－)」横にコメントアイコン (MessageSquare) を追加。スケジュール元サイトの上部にある運用ルール / 注意事項テキストを `parseTopText()` で抽出し、ポップオーバーで表示。元サイトに該当テキストが無ければアイコン自体を非表示",
      "🔧 `parseSchedule` の戻り値型 `ParsedSchedule` に `topText: string \\| null` を追加。`<p>` `<pre>` `<blockquote>` `<h2>`-`<h4>` 要素を `<table>` より前から抽出 → script/style 除外 + HTML strip + 空白正規化",
    ],
  },
];
