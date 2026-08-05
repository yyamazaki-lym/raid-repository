# セキュリティ監査レポート（2026-08-05）

> ユーザー要望「セキュリティスキャンを掛けたい。他の作業に支障が出ない程度に」を受けた重点スキャン。
> 対象は認証/認可・RLS/GRANT 整合性・Server Actions・API Route Handlers・サーバ/クライアント境界の 5 領域。
> 5 エージェント並列。差分ではなくコードベース現状（`d57a77a` 時点）が対象。
> 実コード 219 ファイル / 1.77MB のうち、セキュリティ関連 41 ファイル / 381KB を精査。
> `changelog.ts` / `changelog-archive.ts` / `seed-demo.sql`（計 580KB の手書きデータ）は grep のみで全読み対象外。

## 概要

| 重大度 | 件数 | 内訳 |
|---|---|---|
| **High** | 3 | 権限失効なし / anon 全件 SELECT / SSRF ホスト名バイパス |
| **Medium** | 4 | メモ全削除 / refresh cookie 不伝搬 / page-title 認可 / キャッシュ増幅 |
| **Low** | 12 | 多層防御の強化項目 |

Critical はありません。基礎構造（RLS 有効化・書き込み側 gate・CSP・シークレット管理）は良好で、
過去監査（`audit-2026-07-12.md`）の対処も実際に反映されています。

## 修正状況（2026-08-05 時点）

| # | 状態 | 対応 |
|---|---|---|
| H-1 | ✅ 修正済 | proxy に TTL 再検証を追加（soft 6h / hard 72h）。`admin-roles.ts` / `membership-revalidation.ts` を新設 |
| H-2 | ✅ 修正済 | §7 の SELECT を `TO authenticated` に。demo は `app.public_demo` GUC で明示 opt-in。`app_settings` 読み取りを service role へ |
| H-3 | ✅ 修正済 | `safe-fetch.ts` を新設し DNS 解決結果を検証 + ピン留め。実ペイロード 4 種でブロックを実測確認 |
| M-1 | ⏸ **保留** | 製品挙動の判断が要る（下記）|
| M-2 | ✅ 修正済 | `setAll` ごとに request headers を再構築 |
| M-3 | ✅ 修正済 | `/api/page-title` にハンドラ内 `requireDiscordMember()` + demo ゲスト 403 |
| M-4 | ✅ 修正済 | `invalidateScheduleCache` に admin gate |
| L-1,2 | ✅ 修正済 | `import "server-only"` 追加 |
| L-4 | ✅ 修正済 | `REVOKE ALL ON public.secrets FROM anon, authenticated` |
| L-5 | ✅ 修正済 | matcher の拡張子除外をルート直下 1 セグメントに限定 |
| L-7 | ✅ 修正済 | `?detail=` 廃止。`/login` 側の任意テキスト描画も削除 |
| L-10 | ✅ 修正済 | `daysAgo` を 1〜365 に丸め |
| L-12 | ✅ 修正済 | `{...patch}` を allow-list に置換 |
| L-3,6,8,9,11 | ⬜ 未対応 | 影響が限定的なため見送り（内容は下表参照）|

### 検証

- `tsc --noEmit` / `eslint`（0 error、既存 warning 1 件のみ）/ `next build`（全 22 route + proxy）通過
- **schema.sql をローカル PostgreSQL 16 に実適用**して確認:
  - SELECT ポリシー 19 本すべてが `authenticated` 単独、anon SELECT ポリシーは 0 本
  - `SET ROLE anon` で `app_settings.schedule_url` / `native_schedule_members` が読めないことを実測
  - `app.public_demo='true'` で anon 読み取りが復活、RESET で戻ることを実測
  - `secrets` の anon/authenticated 権限が消えていること（比較対象の `categories` は 14 件保持）
  - `authenticated` は従来どおり読めること（回帰チェック）
- SSRF は `127.0.0.1.nip.io` / `169.254.169.254.nip.io` / `localtest.me` / `10.0.0.1.nip.io` の
  4 種が接続前に `BLOCKED internal address` で落ちること、公開ホストは通ることを実測

### H-2 のデプロイ手順（重要）

demo プロジェクトの DB で **1 度だけ** 実行しておくこと。忘れるとデモサイトが真っ白になる。

```sql
ALTER DATABASE postgres SET app.public_demo = 'true';
```

本番プロジェクトでは未設定のままにする（= `authenticated` 限定）。

### M-1 を保留した理由

修正には「メンバー全員が誰のメモでも編集できる」という**意図的な製品仕様**を変える判断が要る。
`schema.sql:5c-2` と `7a-2` のコメントが明示的にそう設計しており（所有者カラムを持たない共有メモ、
信頼境界は「ログイン済み guild メンバー」）、`author_name` も localStorage 由来の表示名にすぎない。

一方で実害は実測済み。ローカル PG16 で非 admin の JWT を模した状態から、

```sql
DELETE FROM schedule_session_memos WHERE id <> '00000000-0000-0000-0000-000000000000';
-- DELETE 3  → 全メモ消失
```

が通る。UI は 1 件ずつしか削除できないので、誰がやったかも残らない。UPDATE も `USING (true)` なので
同様に一括改竄が可能。RLS では「1 文あたりの行数」を制限できないため、所有者概念を入れる以外に手がない。

適用するなら以下。`author_user_id` を入れて owner または admin に限定する（＝他人のメモは編集不可になる）。

```sql
ALTER TABLE public.schedule_session_memos
  ADD COLUMN IF NOT EXISTS author_user_id uuid DEFAULT auth.uid();

DROP POLICY IF EXISTS schedule_session_memos_member_insert ON public.schedule_session_memos;
CREATE POLICY schedule_session_memos_member_insert ON public.schedule_session_memos
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS schedule_session_memos_member_update ON public.schedule_session_memos;
CREATE POLICY schedule_session_memos_member_update ON public.schedule_session_memos
  FOR UPDATE TO authenticated
  USING (author_user_id = (SELECT auth.uid())
         OR (SELECT auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')
  WITH CHECK (author_user_id = (SELECT auth.uid())
         OR (SELECT auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

DROP POLICY IF EXISTS schedule_session_memos_member_delete ON public.schedule_session_memos;
CREATE POLICY schedule_session_memos_member_delete ON public.schedule_session_memos
  FOR DELETE TO authenticated
  USING (author_user_id = (SELECT auth.uid())
         OR (SELECT auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');
```

既存行は `author_user_id IS NULL` になるため、移行期は admin のみが触れる状態になる。
UI 側（`session-memo-delete-modal.tsx` / `schedule-memos-client.ts`）で
「自分のメモだけ編集ボタンを出す」対応も併せて必要。

---

## High

### H-1. Discord メンバーシップ / admin 権限の剥奪が永久に反映されない

**場所**: `src/lib/server/auth.ts:123-156`, `src/app/auth/callback/route.ts:65-83`, `src/proxy.ts:242`, `supabase/schema.sql:340,347`

> 認証エージェントと RLS エージェントが**独立に同一の問題を検出**。確度は最も高い。

`discord_guild_member` / `discord_roles` / `is_admin` を書くのは OAuth callback ただ一箇所で、
以後 proxy も `requireDiscordMember()` も JWT 内 `app_metadata` を読むだけ。
callback が書いている `discord_member_verified_at` は**コード中どこからも読まれていない**（参照ゼロ、TTL 判定が存在しない）。

**悪用シナリオ**: kick されたメンバー / admin ロールを剥奪された元管理者が、Supabase セッション cookie を保持し続ける。
`auth.users.app_metadata` は不変のため、refresh のたびに同じ claim を載せた JWT が再発行される。結果、

1. `proxy.ts:242` の gate
2. `requireDiscordMember()`
3. `assertAdminResult()`
4. RLS の `auth.jwt() -> 'app_metadata' ->> 'is_admin'`

の **4 層すべてを通過し続ける**。H-2 と組み合わせると、元 admin は公開 anon key + 自分の JWT で
PostgREST を直叩きし `DELETE /rest/v1/categories?id=neq.<uuid>` 相当を実行できる
（`ON DELETE CASCADE` で category_links / loot / mitigation / macros まで消える）。
アプリ層の gate は同じ claim 由来なので防げず、失効手段が Supabase の DB/Auth を手で叩く以外に無い。

**修正案**: `requireDiscordMember()`（`cache()` 済みなのでリクエスト 1 回）に TTL 再検証を追加。

```ts
// src/lib/server/auth.ts
const MEMBERSHIP_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const verifiedAt = Date.parse(meta.discord_member_verified_at ?? "");
if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > MEMBERSHIP_TTL_MS) {
  const fresh = await fetchGuildMember(meta.discord_id);
  if (!fresh.ok) {
    await supabase.auth.signOut();
    if (demoMode) return publicDemoGuestUser();
    redirect("/auth/denied?reason=membership_revoked");
  }
  await updateUserAppMetadata(user.id, {
    discord_id: meta.discord_id,
    discord_guild_member: true,
    discord_roles: fresh.roles,
    discord_member_verified_at: new Date().toISOString(),
    is_admin: userIsAdmin(fresh.roles),
  });
  await supabase.auth.refreshSession(); // RLS の is_admin claim も更新
  return { userId: user.id, discordId: meta.discord_id, roles: fresh.roles };
}
```

併せて Supabase Auth の session time-box（Dashboard → Auth → Sessions）を有効化。

---

### H-2. 全テーブルの anon SELECT + anon key の公開入手経路

**場所**: `supabase/schema.sql:935-941`（§7 汎用ループ）, `src/app/login/login-button.tsx:28`

19 テーブル全てに `FOR SELECT TO anon, authenticated USING (true)` が張られている。
一方 `/login` は `PUBLIC_PATHS`（`src/proxy.ts:31`）で未認証公開されており、
そのログインボタンが `@/lib/supabase/client` を dynamic import するため
`NEXT_PUBLIC_SUPABASE_ANON_KEY` はビルド時インラインされたチャンクとして誰でも取得できる。

**anon key の公開自体は設計上正しい**（`NEXT_PUBLIC_` は公開前提）。問題は RLS 側が anon に全開放していることで、
この 2 つが噛み合って初めて成立する。Supabase REST は Vercel proxy の外側にあるため、
proxy のメンバーゲートは読み取りに一切効かない。

**悪用シナリオ**: guild 外の第三者が `/login` を開いてボタンを押す（OAuth リダイレクト前に anon key を含むチャンクが落ちる）
→ 鍵を抜いて直接 REST/Realtime を叩く。

- `native_schedule_members?select=*` → 全メンバーの Discord snowflake・表示名・コメント
- `categories` + `category_links` → `required_role_ids` でロール制限したカテゴリの中身
  （`schema.sql:71-78` が「アプリ層のみ」と自認している箇所の実証）
- `app_settings?select=*` → `schedule_url`（character-sheets の URL-as-capability）、通知先 channel/role ID
- `schedule_session_memos` / `native_schedule_attendances` → 全メモと全出欠履歴

**修正案**: §7 ループの SELECT を `TO authenticated` へ変更。

```sql
'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)'
```

**実装上の前提条件（先に対処しないと壊れる）**:

- cron 系ルートはユーザー session を持たず anon ロールで `app_settings` を読んでいる
  （`api/cron/fflogs-sync/route.ts:47`, `snapshot-schedule/route.ts:43` → `fetchAppSetting` は `createClient()` = anon）。
  先に `createSupabaseServiceRoleClient()` へ切り替えること。
- `PUBLIC_DEMO_MODE=true` のデプロイは匿名 guest が anon key で読むため、demo 用 Supabase だけ anon SELECT を残す運用分離が必要。

---

### H-3. DNS 名が内部 IP に解決するケースが SSRF ガードを素通り

**場所**: `src/lib/url-safe.ts:128-133`（`/api/page-title` から到達）

IP リテラルの防御は網羅的で、以下はすべてブロック済み（実測確認）:
10 進/8 進/16 進/短縮 IP、`169.254.169.254`、プライベート帯、`localhost`、`[::1]`、
IPv4-mapped `[::ffff:127.0.0.1]`、NAT64 `64:ff9b::`、6to4 `2002::`、`file://`/`gopher://`、
リダイレクト追従（`fetchWithSafeRedirect` が各 hop で再検証、最大 3 hop）。

しかし**ホスト名は「解決時に内部 IP を引かない前提」で無条件に `true` を返す**。
コメントは DNS rebinding を受容リスクとして挙げているが、実際には **rebinding すら不要**で、
公開 DNS が静的に private IP を返すだけで突破できる。

```bash
# ログイン済み Discord メンバーのセッション cookie で
curl -b "$SESSION" 'https://…/api/page-title?url=http://169.254.169.254.nip.io/latest/meta-data/'
curl -b "$SESSION" 'https://…/api/page-title?url=http://127.0.0.1.nip.io:3000/'
curl -b "$SESSION" 'https://…/api/page-title?url=http://localtest.me/'
# 攻撃者管理ドメインに A 10.0.0.5 を張れば任意の内部ホストへ
```

`nip.io` / `localtest.me` は IPv4 リテラル正規表現（`:85`）にも `.local`/`.internal` 判定にも当たらず通過する。
リダイレクト再検証も同じ関数を使うため 2 段目でも同様。
漏洩は `<title>` の内容に限られる semi-blind SSRF だが、内部ポートスキャン（応答時間差）と
内部管理画面のタイトル取得が成立する。

**修正案**: 名前解決の結果を検証し、**その解決済み IP で接続をピン留め**する（rebinding も同時に塞げる）。
`page-title` は `runtime="nodejs"` なので undici の dispatcher が使える。

```ts
// src/lib/server/safe-fetch.ts (新規)
import "server-only";
import { Agent } from "undici";
import { lookup as dnsLookup } from "node:dns";
import { isPrivateIp } from "@/lib/url-safe"; // 既存 :84-126 の判定を切り出して再利用

export const safeAgent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, "", 0);
        const list = Array.isArray(addrs) ? addrs : [addrs];
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad) return cb(new Error(`blocked internal address ${bad.address}`), "", 0);
        cb(null, list as never, 0); // 検証済みアドレスにピン留め
      });
    },
  },
});
```

`src/lib/server/page-title.ts:74` の `fetch(current, {...})` に `dispatcher: safeAgent` を追加。

---

## Medium

### M-1. `schedule_session_memos` が所有者列なしで全 authenticated に書き込み開放

**場所**: `supabase/schema.sql:1030-1050`

`INSERT WITH CHECK (true)` / `UPDATE USING(true) WITH CHECK(true)` / `DELETE USING (true)`。
所有者カラムが無く、`author_name` は client（localStorage 値）が自由に入れる表示用文字列
（`src/lib/schedule-memos-client.ts:108-117`）。

**悪用シナリオ**: 非 admin のメンバー 1 人が自分の JWT + 公開 anon key で
`DELETE /rest/v1/schedule_session_memos?id=neq.00000000-0000-0000-0000-000000000000` を 1 回叩けば全メモが消える
（UI は 1 件ずつ削除しか出さないので誰がやったかも残らない）。他人名義での投稿・改竄も可能。

```sql
ALTER TABLE public.schedule_session_memos
  ADD COLUMN IF NOT EXISTS author_user_id uuid DEFAULT auth.uid();
DROP POLICY IF EXISTS schedule_session_memos_member_update ON public.schedule_session_memos;
CREATE POLICY schedule_session_memos_member_update ON public.schedule_session_memos
  FOR UPDATE TO authenticated
  USING (author_user_id = (SELECT auth.uid())
         OR (SELECT auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true')
  WITH CHECK (author_user_id = (SELECT auth.uid())
         OR (SELECT auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');
-- delete も同条件へ置換。insert は WITH CHECK (author_user_id = (SELECT auth.uid()))
```

### M-2. セッション refresh 後の cookie が下流レンダに伝搬しない

**場所**: `src/lib/supabase/middleware.ts:39-42,58`, `src/proxy.ts:178`

`proxy.ts:178` が `new Headers(request.headers)` で**refresh 前**の cookie をスナップショットし `nextInit` に固定。
`setAll` は `request.cookies.set()` で更新するが、`NextResponse.next(nextInit)` は古いスナップショットを再利用するため
更新分が捨てられる。Supabase 公式パターンの `NextResponse.next({ request })` は毎回 `request.headers` を読み直すので伝搬する。
CSP nonce 対応（TODO #84）でこの契約が静かに壊れている。

攻撃ではなく自己 DoS。トークンローテーション時、Server Component 側の `cookies()` が
失効済みアクセストークン＋消費済みリフレッシュトークンを受け取り、
proxy は通すのに `requireDiscordMember()` が `/login` へ redirect する不整合が起きる。
Supabase の refresh token 再利用検知の猶予を外れるとセッション一族ごと失効し強制ログアウト。

```ts
setAll(cookiesToSet) {
  for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
  const headers = new Headers(request.headers);
  if (initialRequestHeaders) {
    for (const [k, v] of initialRequestHeaders) {
      if (k.toLowerCase() !== "cookie") headers.set(k, v);
    }
  }
  response = NextResponse.next({ request: { headers } });
  for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
}
```

### M-3. `/api/page-title` にハンドラ内認可が無い

**場所**: `src/app/api/page-title/route.ts:26-42`

認証が `proxy.ts` の matcher 任せ。`proxy.ts:23-27` 自身が
「matcher のリファクタで silent にカバレッジが外れうるので Route Handler 側でも `requireDiscordMember()` を呼ぶ方針」
と書いているが、**SSRF の入口である本 route だけがこの方針から漏れている**。
現状 matcher はカバー済みだが、H-3 と組み合わさると匿名化した瞬間に Critical へ昇格する。

### M-4. 認証なしのキャッシュ無効化が外部 fetch 増幅に使える

**場所**: `src/lib/server/schedule-cache-actions.ts:19` `invalidateScheduleCache`

意図的に無ゲート（「cache miss を強制するだけで無害」とコメント）だが、この tag は 60 秒 `revalidate` 付きの
**外部ホストへの fetch**（`next-session.ts:112`、list + edit の 2 本）を保護している。
`PUBLIC_DEMO_MODE=true` では proxy がゲートを外す（`proxy.ts:215`）ため、
未認証ユーザーが next-action ヘッダ付きで空 body を POST するループを回すと、
以降のページ表示すべてがキャッシュを外れ外向き fetch が飛ぶ。
このパスは `RATE_LIMIT_RULES`（`proxy.ts:86`）のどのルールにもマッチしない。

呼び出し元（`schedule-edit-frame-dialog.tsx:68`）は編集ダイアログなので `assertAdminResult()` で支障ない。

---

## Low

| # | 場所 | 内容 |
|---|---|---|
| L-1 | `src/lib/supabase/server.ts` | `import "server-only"` 欠落。他のシークレット取扱モジュールは全て付与済みで、ここだけ非対称。現状は `next/headers` が暗黙ガードだが、切り出しリファクタで消える |
| L-2 | `src/lib/rate-limit.ts` | 同上。KV/Upstash トークンを参照するがクライアント寄りの `src/lib/` 直下にあり暗黙ガードも無い |
| L-3 | `next.config.ts:95` | `images.remotePatterns` の `hostname: "*.supabase.co"`。誰でも作れる無料プロジェクトが許可元になり、Vercel Image Optimization を踏み台にされる |
| L-4 | `supabase/schema.sql:1184-1202` | `secrets` の防御が RLS ポリシー 1 本のみ。明示 GRANT/REVOKE が無く default privileges で anon/authenticated が DML 権限を保持。`REVOKE ALL ON public.secrets FROM anon, authenticated;` |
| L-5 | `src/proxy.ts:253` | matcher の拡張子除外がパス全体末尾一致のため `/category/x.png` が proxy を全スキップ。認可バイパスには至らない（layout が独立に redirect）が CSP nonce が付かない。`[^/]+\.(?:svg\|png\|…)$` へ限定 |
| L-6 | `src/lib/server/cron-auth.ts:93-94` | preview 環境で `x-vercel-cron: 1` 単独通過が有効。`vercel.json` の `deploymentEnabled` で preview が作られないため実露出はほぼゼロ |
| L-7 | `src/app/auth/callback/route.ts:43-46` | Supabase 内部エラー文字列を `/login?...&detail=` に載せ URL 履歴に残す（React エスケープ済みで XSS は無し） |
| L-8 | `src/app/api/fflogs/scrape-proxy/route.ts:114` | `{ error: String(e) }` をそのまま返却。cron 4 本も `result.reason` を返す（いずれも認証後） |
| L-9 | `src/lib/rate-limit.ts:237-245` | client IP が `x-real-ip` → `x-forwarded-for` 最左値。Vercel では上書きされるが、移設時は `-H 'x-real-ip: …'` で全レート制限を無効化できる |
| L-10 | `src/lib/server/categories-actions.ts:2923` | `daysAgo` 未検証で `toISOString()` が `RangeError` → unhandled 500。`daysAgo=100000` で全行スキャン強制 |
| L-11 | `categories-actions.ts:2777,2815,2923` | 読み取り専用集計 3 件が不要に Server Action 化。呼び出し元は Server Component 1 箇所のみ。`import "server-only"` の別モジュールへ移してエンドポイント面を消すのが確実 |
| L-12 | `categories-actions.ts:246,1912`, `category-macros-actions.ts:59` | `patch` を `{...patch}` で展開する mass assignment。`updateCategoryLinkAction` は `patch.url` を `isSafeUrl` 検証後に全展開するため **`thumbnail_url` が検証を迂回**（create 経路とは非対称）。admin 限定なので昇格には至らない |

### 運用上の注意（脆弱性ではない）

`PUBLIC_DEMO_MODE=true`（`src/proxy.ts:215`）は **NODE_ENV ガード無しで本番でも auth gate を無効化**する意図的な機能。
本番プロジェクトの環境変数に混入するとサイト全体が匿名公開される。CI でこの env が本番に存在しないことを検証しておくのが望ましい。

---

## 問題なしと確認した範囲

**RLS / DB**
- RLS 未有効テーブルは **0 件**（`secrets` / `category_discord_blocklist` を含む全 21 テーブルで有効）
- SECURITY DEFINER 関数 6 本すべて `SET search_path = public` 済み。
  `update_native_placeholder_raid_times` は `REVOKE ... FROM PUBLIC, anon` + 本体の is_admin ゲートで二重に閉じている
- anon への INSERT/UPDATE/DELETE ポリシーは **1 本も存在しない**（書き込みは全て `TO authenticated`）
- `native_schedule_attendances` の self-row ポリシーは書き換え不能な `app_metadata.discord_id` 由来

**認可**
- Server Action 全 76 本中 73 本が `assertAdminResult()` / `requireDiscordMember()` でゲート済み。
  残りは `invalidateScheduleCache()`（M-4）と読み取り専用集計 3 件（L-11）
- IDOR なし。非 admin が呼べる 2 つの action は書き込み先の `discord_user_id` を
  引数ではなくセッション由来の `member.discordId` に固定している
- service role 利用 9 箇所はすべて `assertCronAuth` / `assertAdminResult` の後段
- cron 4 本すべて `assertCronAuth` — `CRON_SECRET` を `timingSafeEqual` で定数時間比較、未設定なら 503、
  前段に 10 req/30s の per-IP レート制限

**Web**
- **オープンリダイレクト無し** — `sanitizeNextParam` でバックスラッシュ・`//` 始まりを拒否し、
  さらに解決後 origin を比較する二重防御。`/%5C`・`/%09/` 系も 2 段目で落ちる
- **CSRF 対策あり** — `sign-out` / `fflogs/disconnect` に Origin 検証、`SameSite=Lax` cookie
- **OAuth state** — fflogs は 32 byte 乱数を HttpOnly cookie に 1 ユーザー 1 state でバインド、
  `timingSafeEqual` 比較、成否問わず破棄。Supabase 側は PKCE で code_verifier が交換をバインド
- **fflogs トークン** — AES-256-GCM で `secrets` テーブルに保存、service role からのみ読み書き。平文 fallback は撤去済み
- `scrape-proxy` に **SSRF なし** — fetch 先が `https://www.fflogs.com/...` に固定、`userId` は正整数・`page` は 1..25 に検証
- **XSS シンク無し** — `eval` / `new Function` / `document.write` / `.innerHTML=` は 0 件。
  `dangerouslySetInnerHTML` は `layout.tsx:80` の 1 箇所のみで、流入値はビルド時定数
- **CSP** 本番で `script-src 'self' 'nonce-…'`（`unsafe-inline`/`unsafe-eval` なし）+ `object-src 'none'` +
  `base-uri 'self'` + `frame-ancestors 'none'`。HSTS / X-Frame-Options: DENY / nosniff / Permissions-Policy も設定済み
- **CORS** `Access-Control-*` の設定箇所なし、`OPTIONS` ハンドラも未定義

**シークレット / 境界**
- ハードコードされたシークレット **0 件**（`eyJ` のヒットは `package-lock.json` の integrity ハッシュのみ）。
  `git log --all --diff-filter=A` でも過去にコミットされた `.env` は無し
- `'use client'` 97 ファイルを起点に型のみ import を除外した推移的到達解析 →
  service_role key / `SECRET_ENCRYPTION_KEY` / `DISCORD_BOT_TOKEN` / `CRON_SECRET` への到達経路 **0 件**
- `NEXT_PUBLIC_*` は 5 種すべて本来公開してよい値
- `.github/workflows/*.yml` — `pull_request_target` 0 件、シークレットの echo なし、
  third-party action 0 件（GitHub 公式のみ）。`warmup-after-deploy.yml` は `permissions: {}` + env 経由参照で script injection 対策済み

**Next.js 16 作法**
- Route Handler / proxy いずれも Next 16 の現行 API に追従（`next@16.2.9` の `dist/docs` を実参照して確認）。
  `middleware.ts` → `proxy.ts` 改名、`params` の Promise 化、Route Handler のデフォルト非キャッシュ、いずれも正しい

---

## 監査手法とコスト

5 エージェント並列（RLS / 認証・セッション / Server Actions / API routes / 境界・シークレット）。
各エージェントが独立コンテキストで担当スライスのみ読み、要約だけを返す構成にしたため、
単一コンテキストで全読みする場合に比べコンテキスト再送分を大幅に削減している。

- 消費: **約 533k トークン**（5 エージェント合計、事前見積もり 0.6〜0.9M の範囲内）
- 所要: 約 7 分（並列実行）

H-1 は認証エージェントと RLS エージェントが**独立に同一の結論に到達**しており、確度が最も高い。
H-2 は「anon key の公開」（境界エージェントは正常と判定）と「RLS の anon 全開放」（RLS エージェントが検出）の
組み合わせで初めて成立する問題で、単一視点では見落としやすい類型。
