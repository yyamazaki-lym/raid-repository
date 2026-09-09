# デモサイトの作り方 (upstream の管理者向け)

> **自分の固定で使う人はこのページを読む必要はありません。**
> デモサイトは「触らずに使用感を見せる」ための公開モックで、実運用には不要です。
> セットアップは [`setup.md`](setup.md) を見てください。

公開デモ: **https://demo-raid-repository.vercel.app** (閲覧専用)

このページは、そのデモを**もう 1 つ作る / 作り直す**ときの手順です。

---

## 何が違うのか

| | 本番 (各固定の fork) | デモ |
|---|---|---|
| ログイン | Discord OAuth 必須 | 不要 (誰でも閲覧可) |
| 書き込み | メンバー / admin が可 | **全部拒否** |
| データ | 空から自分で登録 | `supabase/seed-demo.sql` のサンプル |
| Supabase | 自分のプロジェクト | **デモ専用の別プロジェクト** |
| Vercel | 自分のプロジェクト | `demo-raid-repository` |

⚠ **本番と同じ Supabase プロジェクトを使い回さないこと。** サンプルデータが
本番のテーブルに混ざります。

---

## 読み取り専用をどう担保しているか

`PUBLIC_DEMO_MODE=true` は Discord のログイン門だけを外します。書き込みは
**4 層**で止まります。1 枚でも通れば書けてしまうので、どれも外さないこと。

1. **proxy** — ログイン必須の判定を skip するが、書き込み経路は素通ししない
2. **ページ** — 編集 UI は admin 判定 (`userIsAdmin`) で出さない
3. **Server Action** — 各アクションの冒頭で `member.isDemoGuest` を弾く
4. **RLS** — anon キーのままなので `WITH CHECK (auth.jwt()->>is_admin = 'true')` を通れない

デモのゲストは `roles: []` の固定ユーザー (`publicDemoGuestUser()`) です。
実セッションを持つ guild メンバー (owner 等) がデモにログインした場合は
**本物の権限**になります (デモの中身を直せるようにするため、TODO #91 案 A)。

---

## 手順

1. **Supabase をもう 1 つ作る** (デモ専用)。手順は [`setup.md`](setup.md) の 2 と同じ
2. `supabase/schema.sql` を流す
3. 続けて [`supabase/seed-demo.sql`](../supabase/seed-demo.sql) を流す
   - 冪等 (`ON CONFLICT` / sentinel / URL の存在チェック) なので**何度流しても安全**
   - ⚠ **本番プロジェクトでは絶対に流さない**
4. **Vercel プロジェクトを分けて**デプロイし、環境変数に
   `PUBLIC_DEMO_MODE=true` を足す
5. Discord の設定は不要 (ログイン門を通らないため)。ただし
   `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` を空にすると一部の機能が
   「未設定」表示になるので、デモ用のダミー値か実値を入れておく

---

## サンプルデータを足したいとき

⚠ **デモの DB に直接書かない。** 次にスキーマを流し直したときに消え、
何が入っているのか誰も分からなくなります。

`supabase/seed-demo.sql` に節を足してください。守る決まり:

- **冪等**にする (`ON CONFLICT DO NOTHING` / 既存チェック)
- **sentinel** を持たせる (何を投入済みかを `app_settings` で見分ける)
- `scripts/check-seed-sql.mjs` が構文と決まりを検査する。CI では
  **seed は実行されない**ので、この静的検査だけが頼り

デモは **自前作成式 (native)** のスケジュールで動かしています
(同期式は外部の character-sheets に依存するため)。

---

## 自動反映 (upstream だけ)

`.github/workflows/deploy-database-demo.yml` が、`SUPABASE_DB_URL_DEMO` secret を
登録したリポジトリでだけ動きます。

⚠ **fork した人はこの secret を登録しないでください。** 登録すると自分の
プロジェクトに seed-demo.sql が流れます。未登録なら workflow は skip して
成功終了するので、そのままで問題ありません。
