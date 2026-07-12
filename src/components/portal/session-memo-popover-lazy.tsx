"use client";

import dynamic from "next/dynamic";

/**
 * `SessionMemoPopover` (828 行 — メモ CRUD + FFLogs URL 管理) の chunk
 * 分離 re-export (2026-07-12 監査 C-2)。
 *
 * schedule-list が静的 import しており、sync / native 両モードの TOP 初期
 * bundle に常時混入していた。トリガー (日付セル + メモ dot) ごと popover
 * コンポーネント内で描画される構造のため、comment-popover-lazy のような
 * `ssr: false` にすると **SSR HTML から日付セルが欠落**してレイアウト
 * シフトが出る — ここは必ず `ssr: true` (デフォルト) のまま分離する。
 *
 * ref (React 19 の通常 prop 化済み `SessionMemoPopoverHandle`) は
 * next/dynamic のラッパーが props をそのまま転送するため命令的 open/close
 * (`popoverRef.current?.toggle()`) も従来どおり動く (実機確認対象)。
 */
export const SessionMemoPopover = dynamic(() =>
  import("./session-memo-popover").then((m) => ({
    default: m.SessionMemoPopover,
  })),
);

export type { SessionMemoPopoverHandle } from "./session-memo-popover";
