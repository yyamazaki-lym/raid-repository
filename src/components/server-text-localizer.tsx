"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locales";
import { localizeServerText, patchToastMethods } from "@/lib/i18n/server-text";
import { loadServerTextEn } from "@/lib/i18n/use-server-text";

/**
 * トーストに出る Server Action の日本語の失敗理由を、英語表示のときだけ
 * 訳す (2026-10-01 監査 U-6)。root layout に 1 つだけ置く。
 *
 * `toast.error(r.reason)` などの呼び出しは 65 ファイル 100 箇所近くあり、
 * 1 つずつ包むと漏れと衝突が出る。`toast` は sonner のモジュール単位の
 * 1 つのオブジェクトなので、ここで `error` / `warning` / `info` /
 * `success` / `message` を「文言を訳してから出す」ものに差し替える
 * (`patchToastMethods`)。日本語表示では何もしない (辞書も読み込まない)。
 * 言語を切り替えたら元に戻す。
 */
export function ServerTextLocalizer({ locale }: { locale: Locale }) {
  useEffect(() => {
    if (locale !== "en") return;
    let cancelled = false;
    let restore: (() => void) | null = null;
    void loadServerTextEn().then((dict) => {
      if (cancelled) return;
      restore = patchToastMethods(
        toast as unknown as Record<string, unknown>,
        (text) => localizeServerText(text, dict),
      );
    });
    return () => {
      cancelled = true;
      restore?.();
    };
  }, [locale]);
  return null;
}
