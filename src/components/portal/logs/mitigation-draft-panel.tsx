"use client";

import { useState } from "react";
import { ClipboardCopy, Loader2, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import {
  buildMitigationDraftTsv,
  formatTimelineClock,
  type BossDamageRow,
} from "@/lib/logs/boss-damage-timeline";
import { fetchBossDamageTimelineAction } from "@/lib/server/boss-damage-actions";
import { useMessages } from "@/lib/i18n/client";

/**
 * 軽減表の雛形 (W-10 + W-9 の x 軸、2026-09-08)。
 *
 * pull の展開行から押すと、その pull でボスが撃った大きい技を
 * `時刻 / 技名 / 対象人数 / 合計 / 最大` の表にして出す。**Sheets に
 * 貼れる TSV のコピー**が本題 (ノートの W-10 が「新層初週に実測プルの
 * ボス詠唱・被ダメ行を出力 → Sheets に貼る」)。
 *
 * ## 何をしないか
 *
 * ⚠ **軽減の判定も率の計算もしない。** ゲーム側のデータ表を抱えると
 * パッチごとの保守が続かない (W-8 と同じ判断)。
 *
 * ⚠ **計画 (Sheets の軽減表) との重ね合わせもしない。** シートの技名は
 * 固定ごとの略称で FFLogs の正式名と一致せず、無理に突き合わせると
 * 「合っているのに合っていないと出る」方が害が大きい。W-9 の「3 要素バー」
 * (計画 × 実測 × CD) はここから先で、**8.0 の軽減再編後に着手する方が
 * 保守が楽**というノート自身の判断に従って据え置いている。
 *
 * ## 押したときだけ取る / 保存しない
 *
 * `DamageTaken` は 1 pull で数百件返る。新層初週にしか使わない機能なので、
 * 同期には載せず押されたときだけ取る (保存もしない)。
 */
export function MitigationDraftPanel({
  reportCode,
  fightId,
}: {
  reportCode: string;
  fightId: number;
}) {
  const m = useMessages();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; reason: string }
    | { kind: "ready"; rows: BossDamageRow[]; truncated: boolean }
  >({ kind: "idle" });

  if (state.kind === "idle") {
    return (
      <button
        type="button"
        onClick={() => {
          setState({ kind: "loading" });
          void fetchBossDamageTimelineAction(reportCode, fightId).then((r) => {
            if (!r.ok) setState({ kind: "error", reason: r.reason });
            else setState({ kind: "ready", rows: r.rows, truncated: r.truncated });
          });
        }}
        title={m.logs.mitDraftHint}
        className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm border border-sky-400/40 bg-sky-400/5 px-1.5 py-0.5 text-[11px] text-sky-200/90 transition-colors hover:bg-sky-400/15"
      >
        <ShieldPlus className="h-2.5 w-2.5" aria-hidden />
        {m.logs.mitDraftLoad}
      </button>
    );
  }
  if (state.kind === "loading") {
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {m.logs.mitDraftLoading}
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span className="mt-1 text-[11px] text-destructive-foreground/90">
        {state.reason}
      </span>
    );
  }
  if (state.rows.length === 0) {
    return (
      <span className="mt-1 text-[11px] text-muted-foreground">
        {m.logs.mitDraftEmpty}
      </span>
    );
  }

  const onCopy = async () => {
    const tsv = buildMitigationDraftTsv({
      rows: state.rows,
      headers: [
        m.logs.mitDraftColTime,
        m.logs.mitDraftColAbility,
        m.logs.mitDraftColTargets,
        m.logs.mitDraftColTotal,
        m.logs.mitDraftColMax,
      ],
    });
    try {
      await navigator.clipboard.writeText(tsv);
      toast.success(m.logs.mitDraftCopied(state.rows.length));
    } catch {
      toast.error(m.recruitment.copyFailed);
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {m.logs.mitDraftCount(state.rows.length)}
          {state.truncated ? ` / ${m.logs.mitDraftTruncated}` : ""}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-sm border border-sky-400/45 bg-sky-400/10 px-1.5 py-0.5 text-[11px] text-sky-200 transition-colors hover:bg-sky-400/20"
        >
          <ClipboardCopy className="h-2.5 w-2.5" aria-hidden />
          {m.logs.mitDraftCopy}
        </button>
      </div>
      {/* 列数は 5 で固定。狭い端末では自分の overflow-x で横に見る
          (本文 11px は下限なので縮めない)。 */}
      <div className="overflow-x-auto">
        <table className="min-w-[22rem] border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-normal">{m.logs.mitDraftColTime}</th>
              <th className="pr-2 font-normal">{m.logs.mitDraftColAbility}</th>
              <th className="pr-2 text-right font-normal">
                {m.logs.mitDraftColTargets}
              </th>
              <th className="pr-2 text-right font-normal">
                {m.logs.mitDraftColTotal}
              </th>
              <th className="text-right font-normal">{m.logs.mitDraftColMax}</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={`${r.t}:${r.abilityId ?? r.ability}`}>
                <td className="pr-2 font-mono text-slate-400 tabular-nums">
                  {formatTimelineClock(r.t)}
                </td>
                <td className="max-w-[12rem] truncate pr-2 text-foreground/90">
                  {r.ability ?? "-"}
                </td>
                <td className="pr-2 text-right font-mono tabular-nums">
                  {r.targets}
                </td>
                <td className="pr-2 text-right font-mono tabular-nums">
                  {Math.round(r.total).toLocaleString()}
                </td>
                <td className="text-right font-mono tabular-nums">
                  {Math.round(r.max).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground/85">
        {m.logs.mitDraftNote}
      </p>
    </div>
  );
}
