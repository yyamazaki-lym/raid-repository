"use client";

import { useEffect } from "react";
import { useLinkStatus } from "next/link";
import {
  decrementPending,
  incrementPending,
} from "@/lib/navigation-pending-store";

/**
 * 2.1 (2026-05-01) TODO #54 part2: 親 `<Link>` の navigation pending 状態を
 * グローバル store に橋渡しする non-rendering reporter。
 *
 * `useLinkStatus` は Next.js 15.3+ 標準の hook で、`<Link>` の descendant
 * でしか動かない (Pages Router では常に `{ pending: false }`)。各 Link の
 * 中に 1 個ずつ仕込む前提なので `<PortalLink>` ラッパーが自動で埋め込む。
 */
export function NavReporter() {
  const { pending } = useLinkStatus();

  useEffect(() => {
    if (!pending) return;
    incrementPending();
    return () => {
      decrementPending();
    };
  }, [pending]);

  return null;
}
