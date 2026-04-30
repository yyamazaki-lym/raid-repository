"use client";

import dynamic from "next/dynamic";

/**
 * Toaster を SSR せず、初回 hydration 後に lazy load する dynamic 版
 * (TODO #11 phase 9, 2.1, 2026-04-30)。
 *
 * `app/layout.tsx` で同期 mount していた `<Toaster>` を分離 chunk に追い出す
 * ことで、初回 LCP 経路から sonner (32.7 KB / 9 KB gz) のレンダリング
 * コードを外す。`toast()` 関数自体は各 client component が `import
 * { toast } from "sonner"` で個別に pull する (queue に書くだけの軽量
 * 関数なので tree-shake で必要分のみ)。
 *
 * `ssr: false` のため Server Component から直接呼び出せず、この client
 * wrapper を介する形になっている (Next.js 16 制約)。
 *
 * race 上の注意: toast() を hydration 完了前に呼ぶと表示が漏れる可能性
 * がある。実用上 toast はユーザ操作トリガで呼ばれるため hydration 後に
 * Toaster が mount されていれば問題ない。
 */
export const DynamicToaster = dynamic(
  () => import("./sonner").then((m) => ({ default: m.Toaster })),
  { ssr: false },
);
