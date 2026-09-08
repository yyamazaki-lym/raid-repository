"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getLogsNotifySettingsAction,
  setLogsNotifyEnabledAction,
} from "@/lib/server/logs-notify-actions";
import { LOGS_NOTIFY_KINDS, type LogsNotifyKind } from "@/lib/logs-notify";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { CollapsibleSection, SectionBadge } from "./collapsible-section";

/**
 * 練習ログのイベント通知設定 (W-35、2026-09-07)。
 *
 * 同期のたびに「新レポート到着 / ベスト到達更新 / 初討伐」を Discord に
 * 流す。**全部既定 OFF** で、必要なものだけ ON にする (通知過多が調査ノート
 * 第 4 回 W-35 のデメリット欄そのもの)。
 *
 * 通知先は native スケジュール通知と同じチャンネル設定を使うので、ここには
 * チャンネルの入力欄を置かない。
 *
 * ## この節は「通知」だけを持つ (2026-09-08 実機要望)
 *
 * 2026-09-07 版は「レポートの発見元」と FFLogs guild ID もここに持っていた
 * が、実機で**「FFLOGS SYNC に入れたほうが良い」**という指摘が出た。発見元は
 * 「どこからレポートを取るか」= 同期の設定で、通知とは別の関心事。
 * `./report-discovery.tsx` へ移し、FFLogs Sync 節の OAuth / 表示名の直下に
 * 置いてある (同じ API を叩く設定が並ぶ)。
 *
 * ## L-3 (2026-09-08): 読み込みが失敗したときに無言で固まらせない
 *
 * 実機で「レポートの発見元が 3 択のどれも選び直せない」報告が出た。真の原因は
 * `"use server"` ファイルの非 async export で Server Action の束が丸ごと
 * 読めなくなっていたことだが (`native-schedule-actions.ts`、同日修正)、
 * **それが画面から分からなかったのはこの節の構造**だった:
 *
 *   - `Promise.all([...]).then(...)` に `.catch` が無かった
 *   - `loaded` を true にするのは `.then` の中だけ
 *   - コントロールは全部 `disabled={pending || !loaded}`
 *
 * つまり action が reject すると**節ごと無言で押せなくなる**。トーストも
 * 出ないので画面から原因が分からない。原因を直しても次に別の action が
 * 失敗したとき同じことが起きるので、構造の方も直してある:
 *
 *   - reject を拾って `loaded` を立てる (= 操作は戻す)
 *   - `ok: false` も含めて**理由を画面に出す**
 *   - 押せば読み直せるボタンを付ける (`loaded` を戻して effect を再走)
 *
 * `ok: false` を黙って捨てていた分も同じ扱いにしてある — 以前は ADMIN で
 * 弾かれたときに全部 OFF が表示されるだけで、それが実際の値なのか読めな
 * かったのか区別できなかった。
 */
export function LogsNotifySection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  /** 初期読み込みが失敗した理由 (L-3)。null なら成功。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<LogsNotifyKind, boolean>>({
    newReport: false,
    bestUpdate: false,
    firstClear: false,
  });

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getLogsNotifySettingsAction()
      .then((r) => {
        if (cancelled) return;
        setLoaded(true);
        // ok: false を黙って捨てない。読めなかった値が既定値として
        // 表示されると「OFF なのか読めていないのか」が区別できない。
        if (!r.ok) {
          setLoadError(r.reason);
          return;
        }
        setLoadError(null);
        setEnabled(r.enabled);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // L-3: reject でも loaded を立てる。ここを落とすと節ごと
        // 無言で disabled のままになる。
        setLoaded(true);
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const toggle = (kind: LogsNotifyKind, next: boolean) => {
    const prev = enabled[kind];
    setEnabled((cur) => ({ ...cur, [kind]: next }));
    startTransition(async () => {
      const r = await setLogsNotifyEnabledAction(kind, next);
      if (!r.ok) {
        setEnabled((cur) => ({ ...cur, [kind]: prev }));
        toast.error(r.reason);
        return;
      }
      toast.success(
        next
          ? m.logsNotify.toastOn(m.logsNotify.label(kind))
          : m.logsNotify.toastOff(m.logsNotify.label(kind)),
      );
    });
  };

  const onCount = LOGS_NOTIFY_KINDS.filter((k) => enabled[k]).length;

  return (
    <CollapsibleSection
      id="logs-notify"
      icon={
        <BellRing className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
      }
      title={m.logsNotify.title}
      badge={
        <SectionBadge state={!loaded ? "loading" : onCount > 0 ? "on" : "off"}>
          {!loaded
            ? "…"
            : onCount > 0
              ? m.logsNotify.badgeOn(onCount)
              : m.logsNotify.badgeOff}
        </SectionBadge>
      }
    >
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.logsNotify.description}
      </p>

      {/* L-3: 読み込みが失敗したことを画面に出す。以前はここが無く、
          コントロールが無言で disabled になるだけだった。 */}
      {loadError !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-rose-400/40 bg-rose-400/5 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-rose-100/90">
            {m.logsNotify.loadFailed(loadError)}
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                // loaded を戻すと上の effect が再走して読み直す。
                setLoadError(null);
                setLoaded(false);
              }}
              className="gap-1.5 text-[11px] tracking-normal text-rose-200"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              {m.logsNotify.reload}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {LOGS_NOTIFY_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-xs">{m.logsNotify.label(kind)}</span>
              <span className="text-[12px] leading-relaxed text-muted-foreground">
                {m.logsNotify.hint(kind)}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[var(--neon-cyan)]"
              checked={enabled[kind]}
              disabled={pending || !loaded}
              onChange={(e) => toggle(kind, e.target.checked)}
              aria-label={m.logsNotify.label(kind)}
            />
          </label>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        {m.logsNotify.channelHint}
      </p>
      {/* 発見元はここから FFLogs Sync 節へ移した (2026-09-08 実機要望)。
          迷わないよう、行き先を 1 行だけ残す。 */}
      <p className="text-[12px] leading-relaxed text-muted-foreground/70">
        {m.logsNotify.sourceMovedHint}
      </p>
    </CollapsibleSection>
  );
}
