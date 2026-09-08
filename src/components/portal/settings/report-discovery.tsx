"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
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

/**
 * レポートの自動発見 (W-5、2026-09-07 / L-4、2026-09-08)。
 *
 * portal がどのレポートを取り込むかは、これまで**リンクから逆算**していた:
 * 動画に貼った FFLogs URL、日付メモの URL、活動日に紐づけた URL。つまり
 * 誰かが URL を貼るまで portal はレポートの存在を知らない。ここはその
 * 「貼らなくても探しに行く」経路の ON/OFF。
 *
 * ## なぜ FFLogs Sync の中にあるのか (2026-09-08 実機要望)
 *
 * 2026-09-07 版は「練習ログの通知」節の中にあった。実機で
 * **「FFLOGS SYNC に入れたほうが良い」「自分のアカウントから自動と
 * FFLOGS SYNC の機能が被っている気がする」**という指摘が出た。
 *
 * 指摘は当たっていた。コードを追うと 2 つが**同じ API クエリ**を叩いている:
 *
 *   | どこ | 関数 | クエリ |
 *   |---|---|---|
 *   | FFLogs Sync (連動) | `fetchFflogsReportsV2` | `reports(userID: me.id)` |
 *   | 「自分のアカウントから自動」 | `fetchFflogsRecentOwnReports` | `reports(userID: me.id)` |
 *
 * **取れるレポートの範囲は同じ**で、違うのは取り込み方だけ:
 *
 *   - **連動 (上の OAuth / 表示名)**: 自分のレポートを**動画や日付メモの
 *     日付と突き合わせて**紐づける (`logs_url` を埋める)。日付が合う先が
 *     無いレポートは何も起きない
 *   - **「自分のアカウントから自動」**: 日付が合う先が無くても**台帳
 *     (`fflogs_fights`) に未分類として入れる**
 *
 * つまり後者は前者の上位互換ではなく「拾い漏れを台帳に落とす」差分だけ。
 * 同じ節に並べて**その差分を明記する**ことで、2 か所を見比べずに済むように
 * した。通知の節には通知だけを残してある。
 *
 * ## ⚠ Unlisted 運用ではどちらの経路も実質 0 件
 *
 * `reports(userID:)` は実測で **Public のレポートだけ**を返す
 * (`fflogs.ts` の調査コメント)。guild 一覧が Unlisted を返すかは未確認。
 * Unlisted 運用を推奨している (`docs/guides/log-runner.md`) 固定では拾え
 * ないので、UI に期待値を併記してある。**ここを消すと「設定したのに
 * 増えない」の問い合わせが戻る。**
 *
 * ## L-3 の教訓を引き継ぐ
 *
 * 初期読み込みは `.catch` を持ち、失敗しても `loaded` を立てて理由を出す。
 * `.then` の中だけで `loaded` を立てると、action が reject したときに
 * 節ごと無言で操作不能になる (2026-09-08 の実機報告の構造そのもの)。
 */
export function ReportDiscovery({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guildId, setGuildId] = useState("");
  const [guildSaved, setGuildSaved] = useState("");
  const [routes, setRoutes] = useState<FflogsAutoRoutes>(
    FFLOGS_AUTO_ROUTES_NONE,
  );

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getFflogsGuildIdAction()
      .then((r) => {
        if (cancelled) return;
        setLoaded(true);
        if (!r.ok) {
          setLoadError(r.reason);
          return;
        }
        setLoadError(null);
        setGuildId(r.guildId);
        setGuildSaved(r.guildId);
        setRoutes(r.routes);
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

  // 経路ごとに「ON にしたのに動かない」を出す。両方 ON のときに
  // どちらの設定を直せばよいかを名指しできる形にしてある。
  const readiness = reportSourceReadiness({
    routes,
    guildId: guildSaved,
    // OAuth の接続状態はこの節では持っていない (すぐ上の OAuth ブロックが
    // 持っている) ので、guild ID の不足だけをここで出す。OAuth 未接続は
    // 同期結果のトーストに出る。
    oauthConnected: true,
  });
  const blockedRoutes = new Set(readiness.blocked.map((b) => b.route));

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/30 pt-2">
      <Label className="text-xs text-foreground/80">
        {m.logsNotify.sourceLabel}
      </Label>

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
              <span className="text-xs">{m.logsNotify.routeLabels[route]}</span>
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

      <div className="mt-1 flex flex-col gap-1.5">
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
    </div>
  );
}
