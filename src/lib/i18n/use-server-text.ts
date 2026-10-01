"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "./client";
import {
  compileServerTextDict,
  localizeServerText,
  type ServerTextDict,
} from "./server-text";

/**
 * Server Action の日本語の失敗理由を表示言語に訳す (2026-10-01 監査 U-6)。
 *
 * 英語の辞書は英語表示のときだけ読み込む (`loadServerTextEn`、root layout の
 * `ServerTextLocalizer` が mount 時に呼ぶ)。トーストは同じ部品が横取りして
 * 訳すので、ここを使うのは**画面の中に出すエラー** (`setError(r.reason)` 等)
 * だけでよい。辞書が届く前 (読み込み直後の一瞬) は日本語のまま出る。
 */

let dict: ServerTextDict | null = null;
let loading: Promise<ServerTextDict> | null = null;
const listeners = new Set<() => void>();

export function loadServerTextEn(): Promise<ServerTextDict> {
  if (dict) return Promise.resolve(dict);
  loading ??= import("./server-text-en").then(({ SERVER_TEXT_EN }) => {
    dict = compileServerTextDict(SERVER_TEXT_EN);
    for (const l of listeners) l();
    return dict;
  });
  return loading;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getDict = () => dict;
const getServerDict = () => null;

/** 画面の中に出すエラー文を訳す関数を返す。日本語表示ではそのまま返す。 */
export function useServerText(): (text: string | null | undefined) => string {
  const locale = useLocale();
  const loaded = useSyncExternalStore(subscribe, getDict, getServerDict);
  const active = locale === "en" ? loaded : null;
  return (text) => localizeServerText(text ?? "", active);
}
