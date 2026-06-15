"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { type ImportNowItem } from "@/lib/server/categories-actions";

/** Discord 取り込みの結果パネル (maintenance-menu から分離、C-5)。 */
export function DiscordPanel({ items }: { items: ImportNowItem[] }) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        Discord 取り込み結果
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">対象チャンネルなし</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <DiscordIcon item={it} />
              <div className="flex-1 leading-relaxed">
                <span className="font-mono text-foreground">
                  {it.category}/{it.kind}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {describeDiscord(it)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DiscordIcon({ item }: { item: ImportNowItem }) {
  if (!item.ok)
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden />;
  if (item.skipped === "disabled")
    return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
  if (item.failed > 0)
    return <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden />;
  if (item.inserted > 0)
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden />;
  return <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />;
}

function describeDiscord(it: ImportNowItem): string {
  if (!it.ok) return `エラー: ${it.reason ?? "原因不明"}`;
  if (it.skipped === "disabled") return "一時停止中";
  if (it.scanned === 0) {
    // Phase 13.1: フィルタ判定前に URL は見つかっていたが全件フィルタで弾かれた
    // ケースを「Bot 権限不足」と誤判定しない。prefilteredCount > 0 なら原因は
    // フィルタ設定なので、その旨を表示してユーザーに見直しを促す。
    if ((it.prefilteredCount ?? 0) > 0) {
      // Phase 13.3: フィルタ全件除外時、タイトル取得成功数も併記して
      // 「タイトル取得失敗 (0/N) が原因」なのか「ワード不一致が原因」なのかを
      // 区別できるようにする。titleFetchedCount は fresh (DB 未登録) URL 限定
      // なので、`prefilteredCount` (= 抽出ユニーク総数) と必ずしも一致しない。
      const tail =
        typeof it.titleFetchedCount === "number"
          ? ` (タイトル取得 ${it.titleFetchedCount})`
          : "";
      return `フィルタ条件に一致する URL なし (${it.prefilteredCount} 件中 0 件)${tail} — フィルタワード設定を見直し`;
    }
    return "URL 検出できず（チャンネル空 or Bot 不可）";
  }
  if (it.failed > 0)
    return `scanned ${it.scanned}, 失敗 ${it.failed}${it.reason ? " — " + it.reason : ""}`;
  if (it.inserted > 0)
    return `+${it.inserted} 件 (重複 ${it.duplicates})`;
  return `すべて重複 (${it.duplicates})`;
}
