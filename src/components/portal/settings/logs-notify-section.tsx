"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getLogsNotifySettingsAction,
  setLogsNotifyEnabledAction,
} from "@/lib/server/logs-notify-actions";
import { LOGS_NOTIFY_KINDS, type LogsNotifyKind } from "@/lib/logs-notify";
import {
  getFflogsGuildIdAction,
  setFflogsGuildIdAction,
  setFflogsReportSourceAction,
} from "@/lib/server/fflogs-guild-actions";
import {
  FFLOGS_AUTO_ROUTES,
  FFLOGS_AUTO_ROUTES_NONE,
  reportSourceReadiness,
  type FflogsAutoRoute,
  type FflogsAutoRoutes,
} from "@/lib/fflogs-report-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * ## L-3 (2026-09-08): 読み込みが失敗したときに無言で固まらせない
 *
 * 実機で「レポートの発見元が 3 択のどれも選び直せない」報告が出た。原因は
 * 初期読み込みの構造そのもので、
 *
 *   - `Promise.all([...]).then(...)` に `.catch` が無かった
 *   - `loaded` を true にするのは `.then` の中だけ
 *   - この節のコントロールは全部 `disabled={pending || !loaded}`
 *
 * だったため、**どちらかの action が reject すると節ごと無言で押せなく
 * なる**。トーストも出ないので画面から原因が分からない。原因が何であれ
 * この「無言で固まる」経路は欠陥なので、
 *
 *   - reject を拾って `loaded` を立てる (= 操作は戻す)
 *   - `ok: false` も含めて**理由を画面に出す**
 *   - 押せば読み直せるボタンを付ける (`loaded` を戻して effect を再走)
 *
 * の 3 点にした。`ok: false` を黙って捨てていた分も同じ扱いにしてある
 * (`getLogsNotifySettingsAction` が ADMIN で弾かれたとき、以前は全部 OFF が
 * 表示されるだけで、それが実際の値なのか読めなかったのか区別できなかった)。
 *
 * 検証の考え方は共有知識の playbook「描画されない画面を静的スキャンで
 * 検証する」に従う — 失敗経路は実機で再現しにくいので、`.catch` が居ること
 * 自体を構造として固定する。
 *
 * ## L-4 (2026-09-08): 発見元を 3 択から経路ごとの ON/OFF へ
 *
 * 「貼られた URL のみ / guild から自動 / 自分のアカウントから自動」の排他
 * 3 択だったが、実機では「guild にも上げているし個人アカウントの分もある」
 * が普通で、排他にする理由が無かった。**貼られた URL は常時 ON** (portal の
 * 土台の経路) として設定から外し、残る 2 経路を独立トグルにしてある。
 * 保存形は `src/lib/fflogs-report-source.ts` 参照 (同じキーの CSV)。
 *
 * ⚠ Unlisted 運用では**どちらの経路も実質 0 件**になる (docs/backlog.md の
 * W-5 の節)。UI を直しても「0 件」は変わらないので、経路の説明に期待値を
 * 併記してある。ここを削ると「設定したのに増えない」の問い合わせが戻る。
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

  // W-5 (2026-09-07) / L-4 (2026-09-08): レポートの発見元と guild ID。
  // 「貼られた URL から」は常時 ON なので state に持たない。ここにあるのは
  // 自動発見の 2 経路の ON/OFF だけ。
  const [guildId, setGuildId] = useState("");
  const [guildSaved, setGuildSaved] = useState("");
  const [routes, setRoutes] = useState<FflogsAutoRoutes>(
    FFLOGS_AUTO_ROUTES_NONE,
  );

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void Promise.all([
      getLogsNotifySettingsAction(),
      getFflogsGuildIdAction(),
    ])
      .then(([notify, guild]) => {
        if (cancelled) return;
        setLoaded(true);
        // ok: false を黙って捨てない。読めなかった値が既定値として
        // 表示されると「OFF なのか読めていないのか」が区別できない。
        const reasons = [
          notify.ok ? null : notify.reason,
          guild.ok ? null : guild.reason,
        ].filter((r): r is string => r !== null);
        setLoadError(reasons.length > 0 ? reasons.join(" / ") : null);
        if (notify.ok) setEnabled(notify.enabled);
        if (guild.ok) {
          setGuildId(guild.guildId);
          setGuildSaved(guild.guildId);
          setRoutes(guild.routes);
        }
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

  /** 自動発見の経路 1 本を切り替える (失敗したら見た目を戻す)。 */
  const toggleRoute = (route: FflogsAutoRoute, next: boolean) => {
    const prev = routes;
    const desired: FflogsAutoRoutes = { ...routes, [route]: next };
    setRoutes(desired);
    startTransition(async () => {
      const r = await setFflogsReportSourceAction(desired);
      if (!r.ok) {
        setRoutes(prev);
        toast.error(r.reason);
        return;
      }
      toast.success(m.logsNotify.sourceSaved);
    });
  };

  const onCount = LOGS_NOTIFY_KINDS.filter((k) => enabled[k]).length;
  // 経路ごとに「ON にしたのに動かない」を出す。両方 ON のときに
  // どちらの設定を直せばよいかを名指しできる形にしてある。
  const readiness = reportSourceReadiness({
    routes,
    guildId: guildSaved,
    // OAuth の接続状態はこのセクションでは持っていないので、guild ID の
    // 不足だけをここで出す (OAuth 未接続は同期結果に出る)。
    oauthConnected: true,
  });
  const blockedRoutes = new Set(readiness.blocked.map((b) => b.route));

  return (
    <CollapsibleSection
      id="logs-notify"
      icon={
        <BellRing className="h-3.5 w-3.5 text-[var(--neon-cyan)]" aria-hidden />
      }
      title={m.logsNotify.title}
      badge={
        <SectionBadge
          state={!loaded ? "loading" : onCount > 0 ? "on" : "off"}
        >
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

      {/* L-4: レポートの発見元。「貼られた URL から」は常時 ON なので
          トグルにせず、動いている経路として文で出す。その上に自動発見の
          2 経路を独立したトグルで足す (排他ではない — guild と個人
          アカウントの両方に上がっているのが普通だった)。 */}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-border/30 pt-2">
        <Label className="text-xs text-foreground/80">
          {m.logsNotify.sourceLabel}
        </Label>
        <p className="rounded-md border border-border/40 bg-secondary/15 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          {m.logsNotify.sourceAlwaysOn}
        </p>
        <div className="flex flex-col gap-1.5">
          {FFLOGS_AUTO_ROUTES.map((route) => (
            <label
              key={route}
              className="flex cursor-pointer items-start justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs">
                  {m.logsNotify.routeLabels[route]}
                </span>
                <span className="text-[12px] leading-relaxed text-muted-foreground">
                  {m.logsNotify.routeHints[route]}
                </span>
                {/* ON にしたのに条件が足りていない状態を、その経路の中に
                    出す (「自動発見にしたのに増えない」の原因が画面で
                    分かるように)。 */}
                {blockedRoutes.has(route) ? (
                  <span className="mt-1 text-[12px] leading-relaxed text-amber-200/90">
                    {m.logsNotify.sourceNeedsGuildId}
                  </span>
                ) : null}
              </span>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--neon-cyan)]"
                checked={routes[route]}
                disabled={pending || !loaded}
                onChange={(e) => toggleRoute(route, e.target.checked)}
                aria-label={m.logsNotify.routeLabels[route]}
              />
            </label>
          ))}
        </div>
        {/* ⚠ 期待値の併記。トグルを ON にしても Unlisted 運用では 0 件の
            まま。これを出さないと「設定したのに増えない」に戻る。 */}
        <p className="text-[12px] leading-relaxed text-amber-200/80">
          {m.logsNotify.sourceUnlistedWarning}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fflogs-guild-id" className="text-xs text-foreground/80">
          {m.logsNotify.guildIdLabel}
        </Label>
        <div className="flex items-center gap-1.5">
          <Input
            id="fflogs-guild-id"
            value={guildId}
            inputMode="numeric"
            maxLength={12}
            placeholder={m.logsNotify.guildIdPlaceholder}
            disabled={pending || !loaded}
            onChange={(e) => setGuildId(e.target.value)}
            className="h-7 w-40 font-mono text-[12px]"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !loaded || guildId.trim() === guildSaved}
            onClick={() => {
              const next = guildId.trim();
              startTransition(async () => {
                const r = await setFflogsGuildIdAction(next);
                if (!r.ok) {
                  toast.error(r.reason);
                  return;
                }
                setGuildSaved(next);
                toast.success(m.logsNotify.guildIdSaved);
              });
            }}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            <Save className="h-3 w-3" aria-hidden />
            {m.common.save}
          </Button>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground/80">
          {m.logsNotify.guildIdHint}
        </p>
      </div>
    </CollapsibleSection>
  );
}
