"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { NavReporter } from "./nav-reporter";

/**
 * 2.1 (2026-05-01) TODO #54 part2: portal 配下の遷移は全て `<PortalLink>` を
 * 経由させて、cold start で stuck する間に上端 progress bar が表示される
 * ようにする。中身は `<Link>` + 末尾の `<NavReporter />` だけで、props は
 * Next.js `<Link>` と完全互換。
 *
 * 既存 `<Link>` を機械的に置換できるよう named export ひとつだけにし、
 * import path も `@/components/portal/portal-link` で統一。Base UI の
 * `DropdownMenuItem render={...}` パターン (children 無しでも render される)
 * もそのまま動く — children が undefined のときは `{undefined}` が描画
 * されないだけで NavReporter は常に末尾に乗る。
 */
export function PortalLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <NavReporter />
    </Link>
  );
}
