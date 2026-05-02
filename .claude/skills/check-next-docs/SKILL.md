---
name: check-next-docs
description: Next.js 16 / React 19 のAPI（Server Actions, route handlers, async params/searchParams, cookies/headers, caching, revalidate, dynamic, middleware, Image など）に触れるコードを書く・編集する前に、該当する `node_modules/next/dist/docs/` のガイドを読み、学習データとの差分（特に async 化された API、caching デフォルト変更、Server Components の制約）を確認する
user-invocable: false
---

# check-next-docs

このプロジェクトは **Next.js 16.2 + React 19** を使っており、`AGENTS.md` に明記されている通りモデルの学習データと現行 API には破壊的な差分がある。経験則ではなく必ずローカルの公式 docs を読んでから書く。

## いつ発動するか

以下のいずれかを書く・修正する前に必ず docs を確認する:

- `app/**/page.tsx` `app/**/layout.tsx` の `params` / `searchParams` を扱う箇所
- `app/api/**/route.ts` の Route Handler
- `cookies()` / `headers()` / `draftMode()` の呼び出し
- `'use server'` を含む Server Action
- `fetch()` の `cache` / `next.revalidate` オプション
- `revalidatePath` / `revalidateTag` / `unstable_cache`
- `middleware.ts`
- `next/image` `next/link` `next/font`
- `next.config.ts` の編集

## 手順

1. 編集対象に該当する API を列挙する
2. `node_modules/next/dist/docs/` を `Glob` または `Grep` で検索し、該当ガイドのファイルパスを特定
3. `Read` で該当 docs を読む（最低限 API シグネチャと "Breaking changes" / "Migration" 節）
4. その API を使うコードを書く

## 既知の罠（Next.js 16 / React 19 特有）

- `params` と `searchParams` は **Promise** で渡る。`await` 必須
- `cookies()` `headers()` `draftMode()` は **async**
- `fetch` のデフォルト caching は **キャッシュしない** に変更されている
- `<form action={serverAction}>` の挙動と `useActionState` の戻り値仕様
- React 19 の `use()` フックと Suspense 境界の関係

## 参考

`AGENTS.md`:
> This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.
