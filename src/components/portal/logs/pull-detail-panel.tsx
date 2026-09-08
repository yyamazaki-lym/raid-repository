"use client";

import { useEffect, useState } from "react";
import { Loader2, Skull } from "lucide-react";
import {
  fetchPullDetailAction,
  type PullDetailDeath,
} from "@/lib/server/pull-detail-actions";
import { formatMs, jobAbbr } from "@/lib/fflogs-fight-detail";
import { useMessages } from "@/lib/i18n/client";

/**
 * pull の構造化リキャップ (UI-14、2026-09-08)。
 *
 * 行の「詳細」を開いたときだけ出る展開パネル。行そのものは L-6 で
 * 1 行に収めたばかりなので、**行に足さずに下へ展開する**。
 *
 * ## 何を出すか
 *
 * 保存済みの死亡イベント (W-1) を 1 件 = 1 行で並べる:
 * `0:42 P2 WHM ← 技名 (+3s)`。自由記述のメモを「技 + フェーズ + ジョブ」に
 * 寄せると集計できる、というのが UI-14 の狙いなので、**並べる順と粒度を
 * 崩さない** (時刻昇順、ジョブは略称、技名は日本語優先)。
 *
 * ⚠ **プレイヤー名は出ない。** `death_events` の保存形が名前を持たない
 * (W-1 の設計)。「誰が落ちたか」ではなく「どのジョブが何で落ちたか」。
 *
 * ## 取得は開いたときだけ
 *
 * 死亡イベントを一覧の payload に載せると `check-fights-payload.mjs` の
 * gzip 予算 (300 KB / 20,000 pull) を超える。展開時に 1 行だけ引く
 * (`fetchPullDetailAction`) ので、一覧の重さは変わらない。
 *
 * 一度取った結果は state に持つので、閉じて開き直しても再取得しない。
 */
export function PullDetailPanel({
  reportCode,
  fightId,
  /** 直前の死亡から N ms 以内を「まとめて落ちた」と見なす閾値。 */
  clusterMs = 10_000,
}: {
  reportCode: string;
  fightId: number;
  clusterMs?: number;
}) {
  const m = useMessages();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; reason: string }
    | { kind: "ready"; deaths: PullDetailDeath[]; missing: boolean }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void fetchPullDetailAction(reportCode, fightId).then((r) => {
      if (!alive) return;
      if (!r.ok) setState({ kind: "error", reason: r.reason });
      else setState({ kind: "ready", deaths: r.deaths, missing: r.missing });
    });
    return () => {
      alive = false;
    };
  }, [reportCode, fightId]);

  return (
    <div className="w-full border-t border-border/30 pt-1.5">
      {state.kind === "loading" ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {m.common.loading}
        </span>
      ) : state.kind === "error" ? (
        <span className="text-[11px] text-destructive-foreground/90">
          {state.reason}
        </span>
      ) : state.deaths.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          {state.missing ? m.logs.pullDetailMissing : m.logs.pullDetailNoDeaths}
        </span>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {state.deaths.map((d, i) => {
            // まとめて落ちた 2 件目以降は薄くする (1 件目の連鎖なのか、
            // 別の場面での死亡なのかを目で分けられるようにする)。
            const chained = d.sincePrev !== null && d.sincePrev <= clusterMs;
            return (
              <li
                key={`${d.t}:${i}`}
                className={
                  "flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums " +
                  (chained ? "text-muted-foreground/70" : "text-foreground/90")
                }
              >
                <span className="w-10 shrink-0 text-right text-slate-400">
                  {formatMs(d.t)}
                </span>
                <span className="w-8 shrink-0 text-center text-indigo-300/90">
                  {d.phase !== null ? `P${d.phase}` : ""}
                </span>
                <span className="w-10 shrink-0 text-cyan-300/85">
                  {jobAbbr(d.job)}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Skull className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0">
                    {d.ability ?? m.logs.pullDetailUnknownAbility}
                  </span>
                </span>
                {chained && d.sincePrev !== null && (
                  <span className="text-muted-foreground/60">
                    {m.logs.pullDetailSincePrev(Math.round(d.sincePrev / 100) / 10)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
