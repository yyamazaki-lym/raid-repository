<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

Read in: **日本語** | [English](README.en.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md)

FF14 レイド固定向けのポータル。**日程 / 軽減表 / ロット / 攻略情報 / 動画 / 練習ログ**を 1 か所にまとめます。

「1 固定 = 1 デプロイ」を前提にした単一テナントのアプリで、**自分の固定用に fork して使います**。入口は Discord サーバーの会員かどうかで守られていて、ログインできるのはそのサーバーのメンバーだけです。

🔗 **デモ (閲覧専用): https://demo-raid-repository.vercel.app**
実際の画面を触って確かめられます。**自分でデモを作る必要はありません** — 使い始める手順は下の「[使い始める](#使い始める)」です。

---

## できること

### 日程

- **方式を 3 つから選べます**: **自前作成式** (候補日の追加・出欠入力・開催確定までポータル内で完結) / **同期式** ([character-sheets](https://character-sheets.appspot.com/schedule/) から取り込み) / **使わない**
- 確定した回を**次回開催**として強調 (当日は「開始まで N 時間 M 分」)
- **定期枠** (毎週この曜日) を決めると、候補日の自動追加がその曜日だけになります。ダイアログから**期間 × 曜日の一括生成**も可能。定期枠から外れた日には「臨時」「今回だけ」のバッジが付きます
- 出欠は ○ × △ に加えて、**遅刻の到着予定 / 早退の予定時刻**を本人が入力できます (`21:30〜` のように記号の隣に出ます)
- 未入力の人への**自動催促**、全員そろったときの**自動確定** (任意)
- Discord 通知のテンプレートで `{discord_relative}` / `{discord_time}` が使え、読む人のタイムゾーンで「3 時間後」のように表示されます
- 日ごとの**メモ** (重要度つき)。書いた本人と幹部が編集でき、投稿者が記録されていない古いメモは誰でも片付けられます
- **出席サマリー** — 回答 (○×△) と練習ログの実績を突き合わせて、直近 90 日の出席とズレを一覧にします。自前作成式・同期式のどちらでも使えます

### コンテンツ (カテゴリー)

- レイドコンテンツ単位の**ステータス** (未着手 / 練習中 / クリア済 / 休止中)、ドラッグ並べ替え、Realtime で即時共有
- カードに**直近 8 週の到達度スパークライン**。タブを開かずに現在地が分かります
- **難易度ラベル**と**進行モデル** (層 / フェーズ) をコンテンツごとに指定できるので、名称が未発表の新難易度でも運用できます
- 背景画像を設定でき、カード内の**映す位置**まで指定できます

### コンテンツごとのタブ

| タブ | 中身 |
|---|---|
| **軽減表** | Google スプレッドシートをそのまま表示。**スマホでは読み取り専用のカード表示**に組み替え、「自分のロール」「自分の担当だけ」に絞れます |
| **ロット管理** | 同じくシート表示 + **今週の消化チェック** (火 17:00 JST リセット) と **BiS** (XivGear 埋め込み)。「欲しい人」の行列は畳めます |
| **攻略情報** | リンク集 (タイトル自動取得・タグ・既読)。Google スプレッドシート等は種類が分かるカードで表示します |
| **動画** | YouTube サムネイル + クリック再生、FFLogs / XIVAnalysis へのリンク |
| **マクロ** | ゲーム内マクロをワンタップでコピー。**ウェイマーク**と**ストラテジーボードの共有コード**も同じタブに |
| **練習ログ** | 下記 |

### 練習ログ

FFLogs から pull 単位で取り込んで表示します。

- 総 pull 数 / 練習日数 / 最高到達 / クリア回数、日別の進行バー
- 各 pull から FFLogs / XIVAnalysis / 動画の**その時点**へワンクリック
- **ワイプ原因** (最初に落ちたジョブ ← 致命技) と、どのギミックで崩れているかの集計。**死亡の直前**に何が起きていたかも見られます
- 絶は**フェーズ滞在時間**と各フェーズの初到達、零式は**層ごとの初踏破**
- 1 日ぶんを**プル・ボックス列**で表示 (1 箱 = 1 pull、クリアは `✓`)
- pull ごとの**ミス注釈** — 「ここでこれをミスした」を後から書き足せます
- ⚠ **個人 DPS は保存も表示もしません。** 死亡の記録も「ジョブ + 技」までで、プレイヤー名は持ちません

### 自分のページ (`/me`)

ヘッダーの人型アイコンから開きます。**自分のぶんだけ**が出ます (幹部でも他人の行は出ません)。

- 自分のジョブ設定 (既定 + コンテンツごとの上書き)。ここで決めたジョブが軽減表の絞り込みに使われます
- **残り BiS** と**学習パス**の進み具合をバーで表示
- 出席サマリーへの入口

### そのほか

- **コマンドパレット** (Ctrl+K) — コンテンツ・タブ・操作を横断で検索
- **Discord 自動取り込み** — コンテンツごとに攻略 / 動画チャンネル ID を登録すると、毎日 01:00 JST に直近 100 件から URL を拾って該当タブに登録します (ボタンで即実行も可)
- **学習パス** — 新しく入った人向けに「動画 → 散開図 → マクロ → 軽減表」の順序つきチェックリスト
- **テーマ** — 拡張パック 7 種のテーマと専用の背景演出
- **色の意味は 5 段階で統一** (`src/lib/perf-tone.ts`) — 良い = emerald → lime → amber → orange → rose = 悪い。残り HP・死亡数・進行バー・出欠記号・週制限に同じ尺度を使います。⚠ **色だけで意味を伝えない** (数字と記号を必ず併記)

---

## 使い始める

**手で集める値は 5 つだけ**、所要 20〜40 分です。詳しい画面の位置は **[`docs/setup.md`](docs/setup.md)** にあります。

> ### ⚠ fork する前に
>
> Deploy ボタン / Fork ボタンの先で、**リポジトリ名とプロジェクト名の既定値 `my-raid-repository` を必ず変えてください**。そのままだと他の固定の fork と見分けが付かなくなります (例: `pandora-raid`, `tuesday-night-raid`)。**GitHub と Vercel の両方**に反映されます。

### 1. 値を 5 つ集める (ブラウザ)

| # | 値 | どこで |
|---|---|---|
| 1〜3 | Supabase の **Project URL** / **anon** / **service_role** | [Supabase](https://supabase.com) でプロジェクトを作り、Settings → API |
| 4 | Discord の **Bot トークン** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**SERVER MEMBERS INTENT を ON**) |
| 5 | Discord の **サーバー ID** | Discord (開発者モード) → サーバー右クリック |

あわせてブラウザ側で 2 つ:

- Discord の **OAuth2 → Redirects** に `https://<project ref>.supabase.co/auth/v1/callback` を登録
- Supabase の **Authentication → Providers → Discord** を ON にして、Discord の Client ID / Secret を貼る

### 2. 設定とデータベース (コマンド)

```bash
npm install
npm run setup
```

`npm run setup` が、値を検証しながら `.env.local` を書き、ランダムで良い値 (`CRON_SECRET` など) を生成し、**テーブルの作成**まで案内して、最後に診断まで走ります。

### 3. デプロイして、戻り先を登録する

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yyamazaki-lym/raid-repository&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,DISCORD_BOT_TOKEN,DISCORD_GUILD_ID&envDescription=Supabase%20%2B%20Discord%20OAuth%20%E5%BF%85%E9%A0%88%20%28%E8%A9%B3%E7%B4%B0%20%3A%20envLink%29&envLink=https://github.com/yyamazaki-lym/raid-repository/blob/main/.env.local.example&project-name=my-raid-repository&repository-name=my-raid-repository)

デプロイでドメインが決まったら、**Supabase → Authentication → URL Configuration** に Site URL と Redirect URLs (`https://<ドメイン>/auth/callback` と `http://localhost:3000/auth/callback`) を登録します。**ここを忘れるとログイン後に戻れません。**

```bash
npm run doctor -- --url https://<自分のドメイン>
```

### うまくいかないときは

```bash
npm run doctor
```

環境変数・Supabase への到達・スキーマの適用・Discord ログインの有効化・Bot のトークンとサーバー在籍・**SERVER MEMBERS INTENT** を実際に叩いて確認し、`❌` には直し方を出します。

---

## 技術

Next.js 16 + React 19 + Tailwind CSS v4 / Supabase (Postgres + Realtime + RLS) / shadcn/ui + Base UI / Vercel (`main` への push で自動デプロイ、Cron Jobs)。

### 守りは 4 層

1. **proxy** — Discord OAuth の入口。サーバーのメンバーでなければ中に入れない
2. **ページ** — ロールごとの表示制限
3. **Server Action** — 書き込みは 1 本ずつ admin 判定
4. **RLS** — DB 側でも同じ判定 (アプリを迂回しても書けない)

FFLogs のトークンは AES-256-GCM で暗号化して保管します。

---

## ローカル開発

```bash
npm install
npm run setup   # 初回。.env.local を作ります (手で書くなら .env.local.example をコピー)
npm run dev
```

http://localhost:3000 を開きます。

| コマンド | 何をするか |
|---|---|
| `npm run setup` | 対話式のセットアップ (`.env.local` 作成 → スキーマ → 診断) |
| `npm run doctor` | 設定の診断。`-- --url https://…` で公開済みサイトも見ます |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run lint` | ESLint |

`scripts/check-*.mjs` は純関数と契約の検査で、CI で全部走ります。

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [`docs/setup.md`](docs/setup.md) | **セットアップの詳細手順**とトラブル対応 |
| [`docs/backlog.md`](docs/backlog.md) | 残タスク。次に何をやるかはここから |
| [`docs/guides/discord-setup.md`](docs/guides/discord-setup.md) | Discord の推奨チャンネル構成 |
| [`docs/guides/log-runner.md`](docs/guides/log-runner.md) | ログ担当の手引き |
| [`docs/demo-site.md`](docs/demo-site.md) | デモサイトの作り方 (**通常は不要**) |
| [`docs/release-notes/`](docs/release-notes/) | 各リリースの詳細 (画面に出る 1 行は `src/lib/changelog.ts`) |
| [`.env.local.example`](.env.local.example) | 環境変数の一覧と説明 |

---

## ブランド

ロゴは `public/brand/` にあります。`logo-mark.svg` の正方形マークは、クリスタル = 蓄積した知識の器、周囲の 8 点 = 8 人 PT で、上 2 点がタンク (青)、下 2 点がヒーラー (緑)、左右 4 点が DPS (赤)。`logo-wordmark-dark.svg` / `logo-wordmark-light.svg` は背景の明暗別で、この README の先頭では自動的に切り替わります。アプリ側でもファビコン・iOS ホーム画面アイコン・ログイン画面・起動中スプラッシュに同じマークを使っています。

`social-preview.png` (1280×640) は GitHub のリポジトリカードに出る画像です。**リポジトリの Settings → Social preview から手動でアップロードします** (GitHub の API では変更できません)。

---

## License

MIT
