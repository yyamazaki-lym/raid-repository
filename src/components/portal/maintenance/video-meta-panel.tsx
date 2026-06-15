"use client";

import { type DurationBackfillResult } from "@/lib/server/categories-actions";
import { type PostedAtBackfillResult } from "./types";

/**
 * 1.9.16: durations + postedAt の旧 2 ボタンを統合した結果パネル。
 * YouTube 取得 → Discord 取得 を順次実行し、両方の結果サマリーを 1
 * パネルに表示する。(maintenance-menu から分離、C-5)
 */
export function VideoMetaPanel({
  durations,
  postedAt,
}: {
  durations: DurationBackfillResult;
  postedAt: PostedAtBackfillResult;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        動画メタデータ — 取得結果
      </p>
      <div className="flex flex-col gap-2 text-[11px] leading-relaxed">
        <section>
          <p className="font-mono text-[10px] text-violet-300/85 tracking-[0.18em] uppercase">
            YouTube (duration / uploadDate)
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            <li className="flex items-baseline gap-2">
              <span className="text-emerald-300">取得</span>
              <span className="font-mono text-foreground">
                {durations.filled}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="text-zinc-400">
                YouTube 以外 / 取得不可
              </span>
              <span className="font-mono text-foreground">
                {durations.skippedNonYoutube}
              </span>
            </li>
            {durations.failed > 0 && (
              <li className="flex items-baseline gap-2">
                <span className="text-rose-300">失敗</span>
                <span className="font-mono text-foreground">
                  {durations.failed}
                </span>
              </li>
            )}
            <li className="text-[10px] text-muted-foreground">
              対象: {durations.scanned} 件
            </li>
          </ul>
        </section>
        <section>
          <p className="font-mono text-[10px] text-emerald-300/85 tracking-[0.18em] uppercase">
            Discord (posted_at)
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            <li className="flex items-baseline gap-2">
              <span className="text-emerald-300">更新</span>
              <span className="font-mono text-foreground">
                {postedAt.updated}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="text-zinc-400">URL 一致</span>
              <span className="font-mono text-foreground">
                {postedAt.matched}
              </span>
              <span className="text-muted-foreground">件</span>
            </li>
            <li className="text-[10px] text-muted-foreground">
              スキャン: {postedAt.scannedMessages} メッセージ /{" "}
              {postedAt.scannedUrls} URL
            </li>
          </ul>
          {postedAt.channels.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-[10px] leading-relaxed">
              {postedAt.channels.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 rounded-sm border border-border/40 bg-secondary/20 px-2 py-0.5 font-mono"
                >
                  <span className="text-foreground">
                    {c.categorySlug}/{c.kind}
                  </span>
                  <span
                    className={c.ok ? "text-emerald-300" : "text-rose-300"}
                  >
                    +{c.updated}
                  </span>
                  <span className="text-muted-foreground">
                    ({c.scanned} msgs)
                  </span>
                  {c.reason && (
                    <span className="text-rose-300">{c.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
