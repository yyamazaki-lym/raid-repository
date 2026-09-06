"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { whenToasterReady } from "@/lib/toaster-ready";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getDiscordScheduleChannelId,
  getScheduleSourceModeFromDb,
  getScheduleUrlFromDb,
} from "@/lib/schedule-url-store";
import {
  setDiscordScheduleChannelIdAction,
  setScheduleUrlAction,
} from "@/lib/server/categories-actions";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
import {
  fetchNativeScheduleAdminAux,
  type NativeAdminAux,
} from "@/lib/schedule/native-admin-client";
import { ScheduleSourceModeSection } from "./settings/schedule-source-mode-section";
import { ScheduleSourceSection } from "./settings/schedule-source-section";
import { PastSessionsSection } from "./settings/past-sessions-section";
import { NativeMembersSection } from "./settings/native-members-section";
import { NativeChoiceValuesSection } from "./settings/native-choice-values-section";
import { NativeCancelledSessionsSection } from "./settings/native-cancelled-sessions-section";
import { NativeDefaultRaidTimeSection } from "./settings/native-default-raid-time-section";
import { NativeDiscordNotifySection } from "./settings/native-discord-notify-section";
import { AttendanceReminderSection } from "./settings/attendance-reminder-section";
import { NativeAutoConfirmSection } from "./settings/native-auto-confirm-section";
import { FflogsSyncSection } from "./settings/fflogs-sync-section";
import { ChangelogFooter } from "./settings/changelog-footer";
import { DangerZoneSection } from "./settings/danger-zone-section";
import { LocaleSection } from "./settings/locale-section";
import { useMessages } from "@/lib/i18n/client";

/**
 * Settings dialog: shared global configuration that all members see
 * once any one of them saves.
 *
 * TODO #66 (2026-05-02): 1,723 行 / 88 KB の単一ファイルから 5 つの
 * sub-component に分割。本体はシェル (Dialog 制御 + 共通 url/channelId
 * state + 保存ボタン) のみ保持。各 section 固有の state は section
 * 内部で完結。
 *
 * Sections:
 *   - ScheduleSourceSection: character-sheets URL (canEdit only)
 *   - PastSessionsSection: Discord channel ID + 取り込み / snapshot (canEdit only)
 *   - FflogsSyncSection: v1 username + v2 OAuth + Cookie + 連動実行
 *   - ChangelogFooter: 更新履歴 + GitHub / Lodestone / Sign out
 *     (demo ゲスト時は Sign out の代わりに Sign in 導線、TODO #91 follow-up)
 *   - DangerZoneSection: 全データ初期化 (canEdit only)
 */
export function SettingsDialog({
  canEdit,
  showSignIn = false,
  defaultOpen = false,
}: {
  canEdit: boolean;
  showSignIn?: boolean;
  /**
   * 2.14 (2026-09-06): `settings-dialog-lazy` がトリガーボタンのクリックを
   * 受けてから本体 chunk を読み込む構成になったため、読み込み完了直後に
   * そのまま開いた状態で mount する経路が必要。初期値にのみ使う。
   */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const m = useMessages();
  const [open, setOpen] = useState(defaultOpen);
  const [url, setUrl] = useState("");
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  // TODO #2 phase 1 (2026-05-07): mode で sync 専用セクションの表示を
  // 切替える。`sync` 以外では URL / Discord channel ID は無関係なので
  // 折り畳んで UI ノイズを減らす。
  const [mode, setMode] = useState<ScheduleSourceMode>("sync");
  // TODO #2 phase 2-C (2026-05-07): native 用 admin section が必要とする
  // 集合 (全 member / CANCELLED 行 / 凡例 CSV) を mode='native' のとき
  // だけ client SELECT する。`adminAuxTick` を CRUD 後に bump して再 fetch。
  const [adminAux, setAdminAux] = useState<NativeAdminAux | null>(null);
  const [adminAuxTick, setAdminAuxTick] = useState(0);

  // OAuth callback handler — when the user returns from FFLogs to
  // /api/auth/fflogs/callback, we redirect back to "/" with either
  // ?fflogs_oauth_connected=1 or ?fflogs_oauth_error=<reason>. Toast
  // the result, auto-open the settings dialog so the user sees the
  // connected state, and clean the query params from the URL.
  //
  // 2.14 (2026-09-06): トーストは `whenToasterReady()` を待ってから発火する。
  // Toaster (`toaster-dynamic.tsx`, `ssr: false` の遅延 chunk) が mount する
  // 前に `toast()` を呼ぶと sonner は再送せず黙って捨てるため、OAuth 復帰
  // 直後のトーストが表示されないことがあった (Playwright 計測 3 回中 0〜1
  // 回)。自動オープンと query 除去は従来どおり同期で行う。cleanup での
  // キャンセルは意図的にしない: dev の StrictMode は effect を mount →
  // unmount → mount と二重実行し、2 回目は query が既に剥がれていて早期
  // return するため、1 回目の pending をキャンセルすると通知が出なくなる。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("fflogs_oauth_connected");
    const errParam = params.get("fflogs_oauth_error");
    if (!connected && !errParam) return;
    if (connected) {
      void whenToasterReady().then(() => {
        toast.success(m.settingsDialog.toastOauthConnected);
      });
      setOpen(true);
    } else if (errParam) {
      void whenToasterReady().then(() => {
        toast.error(m.settingsDialog.toastOauthError(errParam));
      });
      setOpen(true);
    }
    // Strip the params so reload doesn't re-fire the toast.
    params.delete("fflogs_oauth_connected");
    params.delete("fflogs_oauth_error");
    const cleanQuery = params.toString();
    const cleanUrl =
      window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "");
    window.history.replaceState({}, "", cleanUrl);
  }, [m]);

  // Initial fetch of url + channelId + mode on open. URL / channelId は
  // sync mode の Save ボタン経由で永続化、mode は ScheduleSourceModeSection
  // 内で即時保存。ここでは現在値を読み出して表示制御に使うのみ。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [currentUrl, currentChannel, currentMode] = await Promise.all([
        getScheduleUrlFromDb(),
        getDiscordScheduleChannelId(),
        getScheduleSourceModeFromDb(),
      ]);
      if (!cancelled) {
        setUrl(currentUrl ?? "");
        setChannelId(currentChannel ?? "");
        if (
          currentMode === "native" ||
          currentMode === "disabled" ||
          currentMode === "sync"
        ) {
          setMode(currentMode);
        } else {
          setMode("sync");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // TODO #2 phase 2-C: native mode のときだけ admin aux (全 member /
  // CANCELLED 行 / 凡例 CSV) を fetch。CRUD 後は section から `onChanged`
  // で `adminAuxTick` を bump → このフックが再走して最新値を反映。
  useEffect(() => {
    if (!open || mode !== "native") {
      setAdminAux(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const aux = await fetchNativeScheduleAdminAux();
      if (!cancelled) setAdminAux(aux);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, adminAuxTick]);

  const onSave = async () => {
    setBusy(true);
    // Save URL first; if URL save fails, don't bother with the rest.
    const urlResult = await setScheduleUrlAction(url);
    if (!urlResult.ok) {
      setBusy(false);
      toast.error(m.settingsDialog.toastUrlError(urlResult.reason));
      return;
    }
    const channelResult = await setDiscordScheduleChannelIdAction(channelId);
    setBusy(false);
    if (!channelResult.ok) {
      toast.error(m.settingsDialog.toastChannelError(channelResult.reason));
      return;
    }
    toast.success(m.settingsDialog.toastSaved);
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground"
        aria-label={m.settings.aria}
      >
        <Settings className="h-3.5 w-3.5" aria-hidden />
      </DialogTrigger>

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-xl">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            <Settings className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              Settings
            </DialogTitle>
            <DialogDescription className="text-xs">
              {m.settings.description}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Responsive viewport cap: shorter phones get more headroom
            (80svh) while desktop stays at 70svh so the dialog doesn't
            dominate the viewport on large monitors. */}
        <div className="flex max-h-[80svh] flex-col gap-5 overflow-y-auto p-5 sm:max-h-[70svh]">
          {!canEdit && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              {m.settings.readOnlyNotice}
            </div>
          )}
          {/* 2026-09-06: 表示言語 (ブラウザごと)。共有設定ではないので最上段に
              置き、説明文でその旨を明示する。 */}
          <LocaleSection />
          <ScheduleSourceModeSection
            open={open}
            canEdit={canEdit}
            onModeChange={setMode}
          />
          {canEdit && mode === "sync" && (
            <ScheduleSourceSection url={url} onUrlChange={setUrl} />
          )}
          {canEdit && mode === "sync" && (
            <PastSessionsSection
              open={open}
              channelId={channelId}
              onChannelIdChange={setChannelId}
            />
          )}
          {mode === "native" && (
            <NativeMembersSection
              canEdit={canEdit}
              members={adminAux?.allMembers ?? []}
              loaded={adminAux !== null}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {mode === "native" && (
            <NativeChoiceValuesSection
              canEdit={canEdit}
              currentChoiceCsv={adminAux?.currentChoiceCsv ?? null}
              loaded={adminAux !== null}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {mode === "native" && (
            <NativeCancelledSessionsSection
              canEdit={canEdit}
              cancelledSessions={adminAux?.cancelledSessions ?? []}
              loaded={adminAux !== null}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {mode === "native" && (
            <NativeDefaultRaidTimeSection
              canEdit={canEdit}
              loaded={adminAux !== null}
              defaultStartTime={adminAux?.defaultStartTime ?? "21:00"}
              defaultEndTime={adminAux?.defaultEndTime ?? "23:00"}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {mode === "native" && (
            <NativeDiscordNotifySection
              canEdit={canEdit}
              loaded={adminAux !== null}
              enabled={adminAux?.discordNotifyEnabled ?? true}
              channelId={adminAux?.discordNotifyChannelId ?? null}
              roleId={adminAux?.discordNotifyRoleId ?? null}
              hour={adminAux?.discordNotifyHour ?? "12"}
              template={adminAux?.discordNotifyTemplate ?? null}
              onDecision={adminAux?.discordNotifyOnDecision ?? false}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {mode === "native" && (
            <NativeAutoConfirmSection
              canEdit={canEdit}
              loaded={adminAux !== null}
              enabled={adminAux?.autoConfirmEnabled ?? false}
              minAvailable={adminAux?.autoConfirmMinAvailable ?? "8"}
              onChanged={() => setAdminAuxTick((t) => t + 1)}
            />
          )}
          {/* 2026-08-30: 出欠催促は sync / native どちらのモードでも使える
              (未入力判定はソースを問わず同じ)。disabled のときだけ隠す。 */}
          {mode !== "disabled" && (
            <AttendanceReminderSection open={open} canEdit={canEdit} />
          )}
          <FflogsSyncSection open={open} canEdit={canEdit} />
          <ChangelogFooter showSignIn={showSignIn} />
          {canEdit && (
            <DangerZoneSection
              onComplete={(result) => {
                if (result.ok) {
                  // 初期化後は settings dialog 自体も閉じてリロード相当の
                  // 状態に戻す。サーバ側で revalidatePath 済みなので
                  // router.refresh() で次回 fetch から空状態を取り直す。
                  setOpen(false);
                  router.refresh();
                }
              }}
            />
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-[11px] tracking-normal"
          >
            {m.common.cancel}
          </Button>
          {/* Save ボタンは sync mode の URL / channel ID 保存専用。native /
              disabled mode では URL / channelId 入力欄が非表示なので保存
              ボタンも隠す (それぞれの section が即時保存する設計)。 */}
          {mode === "sync" && (
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={busy}
              className="gap-1.5 text-[11px] tracking-normal"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy ? m.common.saving : m.common.save}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
