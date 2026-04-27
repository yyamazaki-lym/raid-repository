/**
 * Hand-curated release notes. Shown in the settings dialog when the
 * user clicks the "更新履歴" button.
 *
 * Entries are user-facing (paste-into-a-newsletter level), not
 * commit-level. Add a new top-level item whenever package.json
 * version is bumped, ideally in the same commit.
 *
 * Order: newest first (the UI renders top-to-bottom as-is).
 */

export type ReleaseEntry = {
  version: string;
  /** ISO date `YYYY-MM-DD` of the bump. */
  date: string;
  /** Short bullet points for the release. Markdown not supported. */
  notes: string[];
};

export const RELEASES: ReleaseEntry[] = [
  {
    version: "1.7.8",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の取得を 3 段階フォールバック構造に — ① v2 GraphQL with owner filter → ② v2 GraphQL UNFILTERED (raw 採用) → ③ HTML スクレイプ。owner filter で全消えする状況も raw fetch で救済",
      "詳細診断パネルを結果に追加 — v2 currentUser id/name、raw fetch 件数、owner filter 通過件数、owner 上位の出現リスト、HTML スクレイプの page1 サイズと code 検出数を全部表示。0 件原因の切り分けに使用",
      "HTML スクレイパーをより permissive に — 全ての `/reports/{code}` リンクを抽出、周辺 ±500 文字から日時を抽出（`<tr>` 構造に依存しない）",
      "結果パネルの「クエリしたユーザー名」表示にどのソース経由か注記（OAuth 認証済 / OAuth → owner filter なし / OAuth → HTML スクレイプ）",
    ],
  },
  {
    version: "1.7.7",
    date: "2026-04-27",
    notes: [
      "FFLogs: HTML スクレイピングをフォールバックパスとして追加 — v2 GraphQL が 0 件返した場合、`https://www.fflogs.com/user/reports-list/{userId}` の公開ページをパースして Public + Unlisted レポートを取得（ユーザー提案）",
      "v2 GraphQL の owner 比較を改善: `String(owner.id) === String(me.id)` でロバストに、加えて `owner.name === me.name` を fallback に",
      "結果パネルで HTML スクレイピング fallback 経由かどうか判別可能（クエリしたユーザー名表示に「HTML スクレイプフォールバック」と注記）",
      "備考: HTML スクレイピングは Public 公開ページがソースなので、真の Private レポートは依然取得不可。完全に取得したい場合は FFLogs 上で「Public」または「Unlisted」に変更するか、メモポップオーバーから手動 URL 紐づけ",
    ],
  },
  {
    version: "1.7.6",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL: ページネーション上限超過エラー修正 — 32 → 25 ページに戻す（FFLogs API は page > 25 を「performance 改善まで使用不可」として拒否）。総取得件数の上限は 25 × 25 = 625 件に",
      "スケジュール表「確定」バッジの文字ズレ修正 — バッジ内の `✓` アイコンを削除して「確定」テキストのみに。これでヘッダーの「確定」と各行のバッジの「確定」が文字位置で揃う",
      "ヘッダー th にも `text-center` を明示してセルの `text-center` と完全に一致するように",
    ],
  },
  {
    version: "1.7.5",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL: `reports(userID:)` フィルタを撤廃 — userID で絞ると API 側で Public のみに制限される挙動を発見。代わりに無制限取得 → クライアント側で `owner.id === me.id` フィルタする方式に変更。これで OAuth 認証ユーザー本人の Private/Unlisted を含む全レポートが取得対象になる（FFLogs API の挙動次第。なお Private が依然取れない場合は v2 GraphQL スキーマの制約の可能性が高く、メモポップオーバーから手動で URL 紐づけする必要があります）",
      "ページネーション上限を 16 → 32 ページに拡張（全 800 件まで対応、ギルド共有が多い環境向け）",
      "スケジュール表「確定」バッジを大幅 refine — h-4 w-4 の小さな ✓ から、h-6 + 「✓ 確定」テキスト併記の emerald (緑) バッジに。デフォルトの cyan 系から色を差別化して一目で「確定された日」と分かるように",
      "未確定セルは「·」のみで控えめに、確定との視覚差を最大化",
    ],
  },
  {
    version: "1.7.4",
    date: "2026-04-27",
    notes: [
      "🐛 GraphQL エラー修正: `User.reports` フィールドは存在しないため、2 段階クエリに変更 — まず `userData.currentUser { id }` で自分の userID を取得し、その後 `reportData.reports(userID: $myID)` で自分のレポートだけ取得",
      "二重保険: owner.id が currentUser.id と一致するレポートのみ採用するフィルタを GraphQL filter に加えてクライアント側でも実施",
      "DB クリーンアップ: 旧 `app_settings.fflogs_username` 行を自動削除（設定ダイアログ open 時 + FFLogs 連動実行時の両方で idempotent に削除）",
    ],
  },
  {
    version: "1.7.3",
    date: "2026-04-27",
    notes: [
      "🐛 重大: v2 GraphQL クエリを `reportData.reports` から `userData.currentUser.reports` に変更。前者は API client が見えるレポート全体（**他人のレポートを含む**）を返していたため誤紐づけが発生していた",
      "v1 周りの実装を全削除 — `fetchFflogsReports` (v1 REST)、`setFflogsUsername` / `getFflogsUsername` / `parseFflogsDisplayName`、`FFLOGS_USERNAME_KEY` 定数、`FFLOGS_API_KEY` 環境変数の参照、設定ダイアログの v1 表示名フォーム、保存時の v1 username 自動保存処理など。FFLogs 連動は v2 OAuth のみに",
      "「全 logs URL クリア」ボタンを設定ダイアログに追加 — 過去の誤紐づけを一括削除して再連動するための保守機能。動画 / 過去予定の logs_url を null に",
      "`FFLOGS_API_KEY` 環境変数は不要になりました（残しておいても害はありませんが削除推奨）",
      "DB の `app_settings.fflogs_username` 行は今後参照されません（残しておいても害はありませんが削除しても OK）",
    ],
  },
  {
    version: "1.7.2",
    date: "2026-04-27",
    notes: [
      "FFLogs OAuth トークンエンドポイントの認証方式を Basic Auth に切り替え — FFLogs はリクエストボディに client_id / client_secret を入れる方式を `invalid_client` で拒否するため、HTTP Authorization Basic ヘッダーで送る形に修正（refresh_token のリフレッシュも同じ）",
      "401 / invalid_client エラー時は「client_id/secret が正しいか、Public Client にチェックが入っていないか確認」の具体メッセージを表示",
    ],
  },
  {
    version: "1.7.1",
    date: "2026-04-27",
    notes: [
      "OAuth 接続ボタン押下時に環境変数未設定だった場合、生 JSON エラー表示ではなく、ホーム画面に redirect して toast でメッセージ表示するように修正",
      "エラー文言を具体的な対処手順入りに改善（fflogs.com/api/clients/ で OAuth クライアント作成 → Vercel に環境変数設定 → redeploy）",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-04-27",
    notes: [
      "FFLogs v2 GraphQL + OAuth Authorization Code Flow に対応 — 接続すると Public + Unlisted + Private のすべてのレポートが取得対象に。設定ダイアログから「FFLogs と OAuth 接続」ボタンで認可フロー開始",
      "新ルート: `/api/auth/fflogs/start`（OAuth 開始）/ `/callback`（コード交換）/ `/disconnect`（トークン削除）。state は app_settings に一時保存して CSRF 検証",
      "新 server module: `fflogs-oauth.ts` — トークン保存・自動リフレッシュ・接続状態取得",
      "v2 GraphQL fetcher: `fetchFflogsReportsV2` — `reportData.reports` をページネーション込みで取得（最大 16 ページ × 25 件 = 400 件）",
      "linkFflogsReports: OAuth 接続済みなら v2 を優先、未接続なら v1（表示名 + API キー、Public のみ）にフォールバック。結果パネルに使った API バージョンを表示",
      "ENV 変数追加: `FFLOGS_OAUTH_CLIENT_ID` / `FFLOGS_OAUTH_CLIENT_SECRET`（Vercel に設定要、fflogs.com/api/clients/ で OAuth クライアント作成）",
      "redirect_uri はリクエスト Origin から動的に組み立て — localhost と本番ドメインの両方を OAuth クライアント側で許可リストに登録",
      "メモポップアップの FFLogs URL 編集セクションを最下部に移動（メモ閲覧の邪魔にならないよう）",
      "メモ既読ドット（紫）の表示位置のレイアウトシフトを修正 — count=0 の時も h-4 w-4 の placeholder を確保し、リロード時のチラつきを排除",
    ],
  },
  {
    version: "1.6.8",
    date: "2026-04-27",
    notes: [
      "FFLogs URL の手動紐づけ機能を追加 — メモポップオーバーに「FFLogs URL」セクションを統合。日付クリック → URL 入力 → 保存 で個別の日に直接バインド可能",
      "メモポップオーバー: 現在の URL があれば「現在の URL を開く」直リンク表示、新タブで確認可能",
      "メモポップオーバー: 保存 / クリア両方のアクション、URL 形式バリデーション (fflogs.com/reports/...) 付き",
      "v1 API の `includePrivate=true` パラメータを撤廃 — ドキュメント未記載のため効果がなかった。Unlisted/Private レポートは v1 API では取得不可と確定（v2 OAuth は今後対応予定）",
      "新 server action: `setSessionLogsUrl(rawDate, url, sessionDetails?)` — 既存の past_session を UPDATE、なければ provided details で UPSERT",
    ],
  },
  {
    version: "1.6.7",
    date: "2026-04-27",
    notes: [
      "FFLogs 0件マッチ時の診断パネルに「クエリしたユーザー名」のエコー表示追加（実際に何が API に送られたか確認可能）",
      "0件マッチ時の対処を 3 段階で説明追加 — ① API キーと表示名のユーザーが別人、② 表示名の綴り誤り、③ 別メンバーが最近の分をアップ。原因切り分けの順序を明示",
    ],
  },
  {
    version: "1.6.6",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動の修正: API は表示名 (display name) のみ受け付ける（数値 ID は 400 エラー）。1.6.5 で数値 ID 入力を許可したのを取り消し、表示名専用に戻す",
      "数値 ID / `/reports-list/{id}` URL 形式が入力された場合は保存時に拒否し、「fflogs.com/profile で表示名を確認してください」と案内",
      "URL 形式 `https://www.fflogs.com/user/{name}` または `/user/{name}/reports-list/...` から表示名を自動抽出",
      "API の 400 エラー (Invalid user name) を分かりやすく日本語化し、数値 ID と分かれば具体的な対処を提示",
      "設定ダイアログの placeholder を表示名重視に変更（例: TaroYamada）",
    ],
  },
  {
    version: "1.6.5",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: API リクエストに `includePrivate=true` を自動付与 — これまで非公開 (Private) レポートが返らないため最近のレポートが取得できていなかった (主因)",
      "FFLogs ユーザー入力: 数値 ID（プロフィール URL 末尾の `70734` 等）と表示名の両方を受け付け、プロフィール URL の貼り付けにも対応（末尾を自動抽出）",
      "設定ダイアログ: FFLogs フィールドのラベル右に「fflogs.com/profile」直リンク追加、placeholder と説明文を実態に合わせて更新",
    ],
  },
  {
    version: "1.6.4",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: 0件マッチ時の診断パネルに「取得済みレポート (新しい順上位 10 件)」を折り畳み表示。タイトル + 日付 + リンク付きで、設定したユーザー名が想定通りのアカウントを指しているか即座に確認可能",
      "FFLogs 連動: レポート期間が古すぎる場合のヒントを「ユーザー名が最近のレポートをアップしていないことを意味します」に書き換え",
      "スケジュール募集ボタン: hover 時の title 属性 / toast / aria-label からカテゴリー名を削除（次回開催日カードに既に表示されているので冗長だった）",
    ],
  },
  {
    version: "1.6.3",
    date: "2026-04-27",
    notes: [
      "設定ダイアログ — スケジュール URL ラベルの右側に「character-sheets を開く」リンクを追加（ワンクリックで取得元ページへ）",
      "設定ダイアログ — 「URL の取得手順」展開ガイド（折り畳み式 4 ステップ）を追加。初回設定時に貼り付ける URL の形式が分かるように",
      "FFLogs 連動: 0 件マッチ時に診断情報（レポート期間 / 動画期間 / 過去予定期間）を表示。期間ズレが原因かどうかを一目で確認可能",
      "FFLogs 連動: 仕様の説明を強化 — レポート所有者ベースで取得される旨、別メンバー登録時の対処、限定公開 (Unlisted) は取得可・非公開 (Private) は不可の旨を明記",
    ],
  },
  {
    version: "1.6.2",
    date: "2026-04-27",
    notes: [
      "FFLogs マッチが 0 件になる不具合を修正 — v1 API の `start`/`end` は秒単位（10桁）なのにミリ秒として扱っていたため、タイムスタンプが 1970 年扱いになり全マッチ失敗していた。10桁/13桁を自動判別して秒なら ×1000 で正規化",
      "メモポップオーバー: スクロールで閉じる挙動を撤廃 → スクロール追従に変更（多数のメモがあっても表示し続けながらスクロール可能に）",
      "メモポップオーバー: パネル自体に `maxHeight: calc(100vh - top - 16px)` を設定、内部 body 部に `flex-1 overflow-y-auto` で長文対応。新規メモフォームも下部からスクロールで到達可能",
      "メモ一覧: 内部の `max-h-[18rem]` 制限を撤廃 — 外側のパネルスクロールで全メモを閲覧可能に",
    ],
  },
  {
    version: "1.6.1",
    date: "2026-04-27",
    notes: [
      "FFLogs エラーメッセージを改善 — 401 (Invalid key) 時に「Vercel Settings → Environment Variables で v1 Web API キーを確認してください」と具体的に表示",
      "FFLogs 401: v1 Public API key が必要（v2 OAuth の client_id/secret は不可）。設定ダイアログにキーの取得元と種別の説明追加",
      "FFLogs 404: ユーザー名が見つからない場合に「綴りまたは公開設定を確認」と表示",
      "`shadcn` パッケージを runtime → devDep に移動（npm warn の `node-domexception` 由来。CSS import のみで build 時にしか使わないため）",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動 — 過去予定（動画なしの日も）にも logs URL を自動紐づけ。スケジュール表 / 簡易チップで日付セルから直接 FFLogs を開けるように",
      "DB スキーマ追加: `schedule_past_sessions.logs_url TEXT` 列。supabase/schema.sql を本番 DB に再実行してください",
      "FFLogs 連動の挙動修正: 設定ダイアログの「連動」ボタンを押すと、ユーザー名が未保存でも自動保存してから API を呼ぶように（以前は「未設定」エラーで止まっていた）",
      "FFLogs ユーザー名フィールド: プロフィール URL の入力を撤廃（API は username 文字列のみ受け付けるため）。URL が入力された場合は明確なエラー表示",
      "FFLogs 連動結果パネル: 動画 / 過去予定の両方の matched 件数を表示、絵文字で video / session を区別",
      "簡易過去日程チップの縦中央揃え修正: `font-mono` を撤廃（CJK fallback の baseline 不整合が原因）+ `h-6 + leading-none` で固定。Geist Sans + tabular-nums で数字も揃う",
      "スケジュール表の出欠記号（◯⏰△×－）の縦位置揃え修正: 同じく `font-mono` を撤廃して `leading-none` で baseline を統一",
    ],
  },
  {
    version: "1.5.6",
    date: "2026-04-27",
    notes: [
      "全頁の typography を refine — `tracking-widest` (0.1em) を `tracking-[0.18em]` に統一（uppercase mono ラベルが詰まりすぎていた箇所を改善）",
      "スケジュール表 — 日付セルに `tabular-nums`、時刻表記を `font-mono tabular-nums` に統一して縦の揃い改善、`~` を opacity 60% に",
      "スケジュール表 — Film / FFLogs アクションアイコンの hover に glow（box-shadow）追加、ホバーターゲットを h-4 → h-5 に拡張",
      "スケジュール表 — Legends 行の背景を secondary に、行ヘッダーの padding 調整",
      "Past セクションヘッダー — 「Past · 過去の予定」を mono 大文字 + 通常フォントの 2 段組に分割（読みやすさ向上）",
      "簡易過去日程チップ — 角丸を sm → md に、padding 調整、アクションアイコンを h-4 に揃える",
      "次回開催日カード — 時刻に `tabular-nums`、アイコンコンテナに inset shadow 追加",
      "次回開催日カード「確定」バッジのトラッキングを 0.22em に統一",
      "サブタブ — アイコン gap を tighten（gap-1.5）、トラッキング 0.16em に統一",
      "サイトヘッダー — バージョン表記の構造を改善（vX.X.X · BETA を分離 + tabular-nums）",
      "ステータスバッジ — トラッキング 0.18em / 0.22em に統一",
      "カテゴリー一覧 — 「Drag to reorder」見出しに紫ドットと整理された 2 段組を追加",
      "カテゴリーカード — 名前のトラッキング 0.04em で読みやすさ微調整",
    ],
  },
  {
    version: "1.5.5",
    date: "2026-04-27",
    notes: [
      "メモ削除確認ダイアログの暗転（背景ぼかし）を撤廃 — 背景の他の画面が見える状態に",
      "メモポップオーバーのデザインを refine — 紫アクセントのヘッダー帯、メモごとの hover 効果、入力フォームの余白統一、フォントウェイトとアイコンサイズの調整",
      "メモ削除モーダルのデザインを refine — rose アクセント、本文プレビュー枠の改善、ボタンの余白とトラッキング統一",
      "メモ既読ドット（紫）のホバー時のグロー強化",
      "カテゴリースイッチャーのドロップダウン幅を 32rem → 40rem に拡張、長いカテゴリー名は折り返さず truncate（ホバーで full title 表示）",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-04-27",
    notes: [
      "メモ既存日の紫ドットをクリックでもポップオーバーが開くように（日付ラベル / ドットの両方がトリガー）",
      "メモ削除の確認ダイアログをページ中央に表示（ブラウザ標準 confirm を撤廃 → カスタムモーダル）",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-04-27",
    notes: [
      "メモ削除後にリロードしないと一覧と紫ドットが残る不具合を修正（realtime DELETE で `old.raw_date` が欠落する DB 構成のフォールバック + 削除/追加/更新成功時に手動 refetch も発火）",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-04-27",
    notes: [
      "メモが保存・表示されない不具合を修正（呼び出し側で realtime hook に渡す initial 値の参照を安定化 — 毎レンダリング `[]` リテラルを渡していたため、フェッチ済みデータが毎レンダ空配列で上書きされていた）",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-04-27",
    notes: [
      "カテゴリースイッチャーから各ページへの遷移が動かない不具合を修正（DropdownMenuItem に戻して Base UI のクリック処理に乗せる）",
      "メモ realtime のフィルタを撤廃し callback 側で raw_date 照合（特殊文字混入で配信されない問題に対処）",
      "簡易過去日程チップの上下空白を `h-6 + leading-none` を撤廃して padding-only に（CJK グリフの自然な縦中央表示に）",
      "募集ボタンのホバープレビュー — タイトルからカテゴリー名を削除（冗長だったため）",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-04-27",
    notes: [
      "FFLogs 連動: 設定で FFLogs ユーザー名を保存 → 動画の投稿日時 ±36h でレポートを自動マッチして logs URL に紐づけ",
      "サーバー側で FFLOGS_API_KEY 環境変数の設定が必要",
      "簡易過去日程チップの日時を単一 span に統一し上下空白を完全対称化",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-04-27",
    notes: [
      "メモが取得・表示されない不具合を修正（realtime hook の初期 fetch 漏れ）",
      "簡易過去日程チップを固定高さ (h-6) + items-center に変更し、日時テキストの上下空白を対称化",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-04-27",
    notes: [
      "簡易日程のメモポップオーバーがカード境界で隠れる不具合を修正（Portal 描画 + scroll で自動クローズ）",
      "メモ存在を示す紫ドットを時刻の右（行）/ 末尾（チップ）に移動",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-04-27",
    notes: [
      "スケジュール日付（簡易チップ・詳細日時セル）クリックで共有メモのポップアップ — 全員に共通表示",
      "メモには名前と本文。複数登録可。名前は localStorage に保存して再入力不要",
      "メモがある日付には小さい紫ドットが表示",
      "マクロ追加フォームから「全角→半角」ボタンを除外（テンプレ専用に）",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-04-27",
    notes: [
      "募集文ボタン（ヘッダーの ◧）はデフォルト muted 表示、ホバー時とドロップダウンを開いた時のみ cyan",
      "次回開催日カードの「募集」ボタンを少し大きく + 上下空白を統一 (h-7 / px-2.5)",
      "簡易過去日程チップを font-mono + leading-none に統一して文字の上下ずれを解消",
      "次回開催日カードの外枠を強調（border 不透明度 + glow を強化）",
      "マクロページ募集テンプレートのサブラベルが大文字風に見える問題を修正（font-display → 通常フォント）",
    ],
  },
  {
    version: "1.3.5",
    date: "2026-04-27",
    notes: [
      "マクロページから募集文を追加してもリロードまで反映されないバグを修正",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-04-27",
    notes: [
      "募集ボタンを押した時に色が緑＋✓に変化（コピー成功の視覚フィードバック）",
      "簡易過去日程カードの上下パディングを揃えた（内側のスペース対称に）",
    ],
  },
  {
    version: "1.3.3",
    date: "2026-04-27",
    notes: [
      "マクロページの募集文テンプレはデフォルトで展開表示（1行程度なので隠す必要なし）",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-04-27",
    notes: [
      "スケジュール表の各出欠セルを直接クリックで character-sheets 編集ページへ（新タブ）",
      "ホバー時に拡大表示でクリック可能なことを明示",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-04-27",
    notes: [
      "出席状況の即時保存ボタンを過去予定 → 設定ダイアログに移動（結果に閉じるボタン付き）",
      "次回開催日カードの「確定」バッジをタイトル横に移動（右端より目立つ）",
      "次回開催日カードの「募集」ボタンにホバーで本文プレビュー表示",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-04-27",
    notes: [
      "マクロ・募集文テンプレ: クリックで折り畳み式表示（タイトルだけで一覧性アップ）",
      "マクロ追加・編集をポップアップダイアログ化",
      "募集文テンプレを各カテゴリーのマクロページからも追加・編集・削除可能に",
      "過去の予定カードに「保存」ボタン追加（現在の出席状況を即時スナップショット）",
      "設定: DB保存件数の確認ボタンを Discord 履歴ボタンの隣に移動 + 閉じるボタン",
      "設定: 更新履歴の閲覧ボタン追加",
      "ヘッダーバージョンが package.json から自動同期",
      "スケジュール上の募集文ボタンをアイコンのみに統一（他ボタンと整合）",
      "スケジュールの Legend → Legends 複数形に",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-04-27",
    notes: [
      "ヘッダーのバージョン表示を package.json から自動取得",
      "設定ダイアログに「更新履歴」ボタン + 履歴の閲覧",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-04-27",
    notes: [
      "各カテゴリーに「マクロ」サブタブを追加（コピー対応・並べ替え可）",
      "マクロページに、カテゴリーに紐づく募集文テンプレートを read-only 表示",
      "募集文テンプレに category_id（紐づけ）+ サブラベル（1層 / 2層 等）",
      "募集文テンプレを並べ替え可能に（先頭が次回開催日カードのコピー対象）",
      "次回開催日カードに最上段テンプレのワンタップコピーボタン",
      "本文に全角→半角変換ボタン + 募集文テンプレ作成サイトの外部リンク",
      "ドロップダウン最上段に ★ Top のハイライト",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-04-27",
    notes: [
      "出席状況スナップショット機構（毎日 21:50 JST 自動 + 手動ボタン）",
      "schedule_past_sessions に attendances + user_names 列追加",
      "Discord 通知チャンネルから過去日程を取り込み（設定ダイアログ）",
      "過去日程詳細テーブルに動画 / FFLogs リンク（36h ウィンドウ照合）",
      "簡易過去日程に動画 / Logs アイコン",
      "祝日名のホバー表示（holidays-jp.github.io から自動更新）",
      "次回開催日が当日の時に強調表示",
      "削除即時反映（REPLICA IDENTITY FULL）",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-04-27",
    notes: [
      "v0.1 ALPHA → v1.0.0 BETA に正式版移行",
      "セマンティック・バージョニング採用 (PATCH / MINOR / MAJOR)",
      "公開 README 拡充（他固定向けセットアップガイド）",
      "YouTube Data API + Innertube MWEB 対応で限定公開動画も時間取得",
      "カテゴリーごとの累計練習時間 + クリアまでの時間表示",
      "初クリア日時の自動検出 + 手動編集",
      "カテゴリーカード / スイッチャーにサブページショートカット",
      "スケジュール過去日程: 簡易 / 詳細の2モード",
    ],
  },
];
