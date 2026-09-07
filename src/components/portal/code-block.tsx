/**
 * コードフェンス風の表示ブロック (UI-6、2026-09-07)。
 *
 * マクロ / ウェイマーク (markercode) / ストラテジーボード共有コード /
 * 募集文は、いずれも「そのままコピーして貼る」文字列。これまでは素の
 * `<pre>` を 11px 等幅で出していて、
 *
 *   - どこからどこまでが本文なのか (前後の UI との境目) が曖昧
 *   - 11px は本 portal の下限 (ラベル用) で、**貼る文字列を読み取る**には小さい
 *
 * という状態だった。調査ノート第 4 回 8-3 UI-6 の指摘 (等幅 12px 以上、
 * コードフェンス風) に合わせ、枠 + ヘッダー + 12px 等幅に揃える。
 *
 * ## マクロの行数を出す
 *
 * FF14 のマクロは **15 行まで**で、超えるとゲーム内に貼れない。
 * portal で作った / Discord から取り込んだマクロが上限を超えていることは
 * コピーしてゲームに戻るまで気付けなかったので、ヘッダーに `12 / 15 行` を
 * 出し、超過は色を変える (`lineLimit` を渡した呼び出しだけ)。数え方は
 * `@/lib/macro-lines` (空行は数えない)。
 *
 * ## コピーボタンは任意
 *
 * マクロ / ウェイマークの行は**折りたたんだままコピーできる**ボタンを
 * 既に行ヘッダーに持っている。ブロック側にも常時置くと同じ操作が 2 つ並ぶ
 * ので、`onCopy` を渡した呼び出しだけ出す。
 */
"use client";

import { ClipboardCopy } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";
import { macroLineInfo } from "@/lib/macro-lines";

export function CodeBlock({
  text,
  label,
  lineLimit,
  maxHeightClass = "max-h-[12rem]",
  breakAll = false,
  onCopy,
  copyAriaLabel,
}: {
  text: string;
  /** ヘッダー左の種別 (例: マクロ / markercode)。 */
  label: string;
  /** 行数の上限を出す場合に渡す (マクロは 15)。 */
  lineLimit?: number;
  maxHeightClass?: string;
  /** 改行の無い長い文字列 (共有コード) を折り返す。 */
  breakAll?: boolean;
  onCopy?: () => void;
  copyAriaLabel?: string;
}) {
  const m = useMessages();
  const info = macroLineInfo(text, lineLimit);

  return (
    <div className="overflow-hidden rounded-md border border-border/50 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/30 px-2 py-1">
        <span className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={
            "ml-auto font-mono text-[11px] tabular-nums " +
            (info.over ? "text-amber-300" : "text-muted-foreground/70")
          }
          title={info.over ? m.codeBlock.overLimitTitle(info.limit ?? 0) : undefined}
        >
          {info.limit === null
            ? m.codeBlock.lines(info.lines)
            : m.codeBlock.linesOfLimit(info.lines, info.limit)}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            aria-label={copyAriaLabel ?? m.codeBlock.copyAria}
            title={copyAriaLabel ?? m.codeBlock.copyAria}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      <pre
        className={
          `${maxHeightClass} overflow-y-auto px-2.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/90 ` +
          (breakAll ? "break-all" : "")
        }
      >
        {text}
      </pre>
    </div>
  );
}
