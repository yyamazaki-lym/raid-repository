"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Save,
  Calendar,
  History,
  Cloud,
  Loader2,
  Database,
  Camera,
  FileClock,
  BarChart3,
  Link2,
  LogOut,
  AlertTriangle,
  X,
} from "lucide-react";

/**
 * Inline GitHub mark — `lucide-react` v1.x removed brand icons (Github
 * et al.) so we embed the simple-icons SVG path directly. Single use,
 * not worth a separate component.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.51 11.51 0 0 1 12 5.803c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .319.216.694.825.576C20.565 22.092 24 17.598 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getDiscordScheduleChannelId,
  getFflogsUsername,
  getScheduleUrlFromDb,
} from "@/lib/schedule-url-store";
import {
  clearAllFflogsLinks,
  countStoredPastSessions,
  deleteStoredPastSession,
  disconnectFflogsOAuthAction,
  fetchFflogsOAuthStatus,
  getFflogsSessionCookieStatus,
  importPastScheduleFromDiscord,
  linkFflogsReports,
  setDiscordScheduleChannelIdAction,
  setFflogsSessionCookie,
  setFflogsUsernameAction,
  setScheduleUrlAction,
  snapshotScheduleNow,
  type ScheduleSnapshotResult,
} from "@/lib/server/categories-actions";
import { RELEASES } from "@/lib/changelog";
import { DataInitConfirmDialog } from "./data-init-confirm-dialog";

type FflogsLinkResultLite = {
  ok: boolean;
  reason?: string;
  reportsScanned: number;
  videosScanned: number;
  matched: number;
  sessionsScanned: number;
  sessionsMatched: number;
  details: Array<{
    kind: "video" | "session";
    label: string;
    reportTitle: string;
    reportUrl: string;
    videoDate?: string;
    reportDate?: string;
    /** Report start formatted in JST (YYYY-MM-DD HH:mm). */
    reportStartJst?: string;
  }>;
  reportsDateRange?: { earliest: string; latest: string };
  videosDateRange?: { earliest: string; latest: string };
  sessionsDateRange?: { earliest: string; latest: string };
  reportSamples?: Array<{ date: string; title: string; url: string }>;
  queriedUsername?: string;
  apiPath?: "v1" | "v2";
  diag?: {
    v2RawCount?: number;
    v2OwnedCount?: number;
    v2Me?: { id: number; name: string };
    v2OwnersSample?: Array<{
      id: number | null;
      name: string | null;
      count: number;
    }>;
    htmlPageSize?: number;
    htmlCodesFound?: number;
    cookieUsed?: boolean;
    htmlReportCount?: number;
    htmlScrapeError?: string;
    htmlSample?: string;
    videosSkippedNoPostedAt?: number;
    titleDateHitCount?: number;
    titleDateMissCount?: number;
    titleDateMissSample?: string[];
  };
  userTypeFields?: string[];
};

// Inline copy of the Server Action result type — we can't re-export the
// type from a "use server" module on the client side, and the shape is
// stable.
type ScheduleHistoryImportResult = {
  ok: boolean;
  reason?: string;
  scanned: number;
  parsed: number;
  inserted: number;
  duplicates: number;
  /** Of `parsed`, how many were skipped because parsed_date is in the future. */
  skippedFuture?: number;
  /** Pre-existing future-dated rows deleted during this import as cleanup. */
  cleanedFuture?: number;
};

/**
 * Settings dialog: shared global configuration that all members see
 * once any one of them saves.
 *
 * Sections:
 *   1. Schedule Source — character-sheets URL (used for live data)
 *   2. Past History — Discord channel ID + on-demand back-fill button
 *      that reads daily-reminder messages and stores parsed past
 *      session dates so the schedule UI can show history that has
 *      aged out of character-sheets
 */
export function SettingsDialog({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] =
    useState<ScheduleHistoryImportResult | null>(null);
  const [counting, startCount] = useTransition();
  const [storedInfo, setStoredInfo] = useState<{
    ok: boolean;
    count: number;
    recentRows: { rawDate: string; parsedDate: string; source: string | null }[];
    reason?: string;
  } | null>(null);
  const [deletingRow, startDeleteRow] = useTransition();
  const [snapshotting, startSnapshot] = useTransition();
  const [snapshotResult, setSnapshotResult] =
    useState<ScheduleSnapshotResult | null>(null);
  const [fflogsUsername, setFflogsUsernameState] = useState("");
  const [savingUsername, startSaveUsername] = useTransition();
  const [linkingLogs, startLinkLogs] = useTransition();
  const [logsResult, setLogsResult] = useState<FflogsLinkResultLite | null>(
    null,
  );
  const [clearingLogs, startClearLogs] = useTransition();
  // FFLogs OAuth state — fetched from server when dialog opens. Lets
  // us show "Connected as XYZ" vs "Connect" in the OAuth section.
  const [oauthStatus, setOauthStatus] = useState<{
    connected: boolean;
    userName: string | null;
    expiresAt: string | null;
  } | null>(null);
  const [disconnecting, startDisconnect] = useTransition();
  // FFLogs session cookie — opt-in for retrieving Private/Unlisted
  // reports. Auto-deleted after each sync run (server-side) so the
  // window of exposure is minimized.
  const [sessionCookieInput, setSessionCookieInput] = useState("");
  const [cookieStatus, setCookieStatus] = useState<{
    set: boolean;
    preview: string | null;
  } | null>(null);
  const [savingCookie, startSaveCookie] = useTransition();
  const [showChangelog, setShowChangelog] = useState(false);
  // TODO #23 (2.1): 全データ初期化ボタン用の confirm dialog 表示制御。
  const [showDataInitDialog, setShowDataInitDialog] = useState(false);
  // 1.9 (2026-04-28) TODO #11: 古い changelog エントリーは source から
  // 削除して bundle weight を削減 (`changelog.ts` には最新 5 件のみ
  // 残置)。それ以前の履歴は GitHub commits リンクで確認可能。
  // → 旧 `showAllReleases` / `RELEASES_INITIAL_LIMIT` の state は
  //   不要になったので削除。

  // OAuth callback handler — when the user returns from FFLogs to
  // /api/auth/fflogs/callback, we redirect back to "/" with either
  // ?fflogs_oauth_connected=1 or ?fflogs_oauth_error=<reason>. Toast
  // the result, auto-open the settings dialog so the user sees the
  // connected state, and clean the query params from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("fflogs_oauth_connected");
    const errParam = params.get("fflogs_oauth_error");
    if (!connected && !errParam) return;
    if (connected) {
      toast.success("FFLogs OAuth 認証に成功しました");
      setOpen(true);
    } else if (errParam) {
      toast.error("FFLogs OAuth: " + errParam);
      setOpen(true);
    }
    // Strip the params so reload doesn't re-fire the toast.
    params.delete("fflogs_oauth_connected");
    params.delete("fflogs_oauth_error");
    const cleanQuery = params.toString();
    const cleanUrl =
      window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "");
    window.history.replaceState({}, "", cleanUrl);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [
        currentUrl,
        currentChannel,
        currentOauth,
        currentCookie,
        currentUsername,
      ] = await Promise.all([
        getScheduleUrlFromDb(),
        getDiscordScheduleChannelId(),
        fetchFflogsOAuthStatus(),
        getFflogsSessionCookieStatus(),
        getFflogsUsername(),
      ]);
      if (!cancelled) {
        setUrl(currentUrl ?? "");
        setChannelId(currentChannel ?? "");
        setOauthStatus(currentOauth);
        setCookieStatus(currentCookie);
        setFflogsUsernameState(currentUsername ?? "");
        setSessionCookieInput("");
        setImportResult(null);
        setLogsResult(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onSave = async () => {
    setBusy(true);
    // Save URL first; if URL save fails, don't bother with the rest.
    const urlResult = await setScheduleUrlAction(url);
    if (!urlResult.ok) {
      setBusy(false);
      toast.error("URL: " + urlResult.reason);
      return;
    }
    const channelResult = await setDiscordScheduleChannelIdAction(channelId);
    setBusy(false);
    if (!channelResult.ok) {
      toast.error("チャンネルID: " + channelResult.reason);
      return;
    }
    toast.success("設定を保存しました（全員共有）");
    setOpen(false);
    router.refresh();
  };

  const onImport = () => {
    setImportResult(null);
    startImport(async () => {
      const r = await importPastScheduleFromDiscord();
      setImportResult(r);
      if (!r.ok) {
        toast.error("取り込み失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      toast.success(
        r.inserted > 0
          ? `${r.inserted} 件の過去日程を追加`
          : r.parsed > 0
            ? "新規分なし（すべて取り込み済み）"
            : "通知メッセージ未検出",
      );
      router.refresh();
    });
  };

  const onCount = () => {
    setStoredInfo(null);
    startCount(async () => {
      const r = await countStoredPastSessions();
      setStoredInfo(r);
      if (!r.ok) toast.error("件数取得失敗: " + (r.reason ?? "原因不明"));
    });
  };

  const onDeleteStoredRow = (rawDate: string) => {
    if (!confirm(`削除しますか?\n${rawDate}\n\n過去日程からこの日が消えます。Discord 取り込みを再実行しても、この raw_date のメッセージが Discord 100 件に残っていれば再度 insert されます。`)) {
      return;
    }
    startDeleteRow(async () => {
      const r = await deleteStoredPastSession(rawDate);
      if (!r.ok) {
        toast.error("削除失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      toast.success(`削除しました: ${rawDate}`);
      // Refresh the count panel + schedule view.
      const refreshed = await countStoredPastSessions();
      setStoredInfo(refreshed);
      router.refresh();
    });
  };

  const onSnapshot = () => {
    setSnapshotResult(null);
    startSnapshot(async () => {
      const r = await snapshotScheduleNow();
      setSnapshotResult(r);
      if (!r.ok) {
        toast.error("スナップショット失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      toast.success(
        r.scanned > 0
          ? `${r.scanned} 件保存（新規 ${r.inserted} / 更新 ${r.updated}）`
          : "保存対象のセッションなし",
      );
      router.refresh();
    });
  };

  const onLinkLogs = () => {
    setLogsResult(null);
    startLinkLogs(async () => {
      const r = await linkFflogsReports();
      setLogsResult(r);
      if (!r.ok) {
        toast.error("FFLogs 連動失敗: " + (r.reason ?? "原因不明"));
        return;
      }
      const totalMatched = r.matched + r.sessionsMatched;
      toast.success(
        totalMatched > 0
          ? `動画 ${r.matched} 件 / 過去予定 ${r.sessionsMatched} 件 に Logs URL を紐づけ`
          : r.videosScanned === 0 && r.sessionsScanned === 0
            ? "logs_url 未設定の動画 / 過去予定なし"
            : `合うレポートなし (報告 ${r.reportsScanned} / 動画 ${r.videosScanned} / 予定 ${r.sessionsScanned})`,
      );
      // 連動完了直後 — session cookie は使われていれば server 側で
      // 自動削除されているはず。UI のステータスを再フェッチ。
      void getFflogsSessionCookieStatus().then((s) => setCookieStatus(s));
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/30 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/40 hover:text-foreground"
        aria-label="設定"
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
              この設定は固定の全員に共有されます
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Responsive viewport cap: shorter phones get more headroom
            (80svh) while desktop stays at 70svh so the dialog doesn't
            dominate the viewport on large monitors. */}
        <div className="flex max-h-[80svh] flex-col gap-5 overflow-y-auto p-5 sm:max-h-[70svh]">
          {!canEdit && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              スケジュール / FFLogs / DB 編集系の設定は ADMIN ロールを持つ
              ユーザーのみ操作できます。閲覧専用モードで表示中です。
            </div>
          )}
          {/* Schedule URL — admin only */}
          {canEdit && (
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                Schedule Source
              </span>
            </header>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label
                  htmlFor="schedule-url"
                  className="text-xs text-foreground/80"
                >
                  スケジュールページの URL
                </Label>
                <a
                  href="https://character-sheets.appspot.com/schedule/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--neon-cyan)]"
                  title="character-sheets.appspot.com を開く"
                >
                  <Calendar className="h-2.5 w-2.5" aria-hidden />
                  character-sheets を開く
                </a>
              </div>
              <Input
                id="schedule-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://character-sheets.appspot.com/schedule/list?key=..."
                className="font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                character-sheets.appspot.com の{" "}
                <code className="font-mono">schedule/list?key=…</code>{" "}
                形式を指定してください。
              </p>
              <details className="group/help">
                <summary className="cursor-pointer text-[10px] text-muted-foreground/80 transition-colors hover:text-foreground/90 list-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[var(--neon-cyan)]/70 transition-transform group-open/help:rotate-90">
                      ▸
                    </span>
                    URL の取得手順
                  </span>
                </summary>
                <ol className="mt-1.5 ml-3.5 flex list-decimal flex-col gap-0.5 text-[10px] text-muted-foreground/80 leading-relaxed">
                  <li>
                    <a
                      href="https://character-sheets.appspot.com/schedule/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--neon-cyan)]/85 underline decoration-dotted underline-offset-2 hover:text-[var(--neon-cyan)]"
                    >
                      character-sheets.appspot.com/schedule/
                    </a>
                    {" "}を開く
                  </li>
                  <li>固定で使っているスケジュールページに移動</li>
                  <li>
                    ブラウザのアドレスバーから URL をコピー（
                    <code className="font-mono">/schedule/list?key=…</code>
                    {" "}で終わるもの）
                  </li>
                  <li>上の入力欄に貼り付けて「保存」</li>
                </ol>
              </details>
              <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
                ※ 元サイトの変更は最大{" "}
                <strong>10 分</strong> 遅れて反映されます。
              </p>
            </div>
          </section>
          )}

          {/* Discord schedule history — admin only */}
          {canEdit && (
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                Past Sessions from Discord
              </span>
            </header>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="discord-schedule-channel"
                className="text-xs text-foreground/80"
              >
                スケジュール通知チャンネル ID（任意）
              </Label>
              <Input
                id="discord-schedule-channel"
                inputMode="numeric"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="例: 1234567890123456789"
                className="font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                日次の活動予定通知が投稿されているチャンネル ID。設定すると
                「<strong>本日YYYY/MM/DD(曜) HH:MM~HH:MM</strong>」形式の
                メッセージから過去の開催日を取得できます。
              </p>
              <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
                Bot がこのチャンネルにアクセスできる必要があります（View
                Channels + Read Message History）。
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onImport}
                  disabled={importing || !channelId.trim()}
                  className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
                  title={
                    !channelId.trim()
                      ? "チャンネル ID を入力してください（先に保存）"
                      : "Discord 履歴から過去日程を取り込み"
                  }
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Cloud className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {importing ? "取り込み中..." : "Discord 履歴から取り込み"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSnapshot}
                  disabled={snapshotting}
                  className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
                  title="現在の出席状況を即時スナップショット（自動: 毎日21:50 JST）"
                >
                  {snapshotting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Camera className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {snapshotting ? "保存中..." : "出席状況を即時保存"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onCount}
                  disabled={counting}
                  className="gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
                  title="schedule_past_sessions の現在の保存件数を確認（デバッグ用）"
                >
                  {counting ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <Database className="h-3 w-3" aria-hidden />
                  )}
                  DB の保存件数
                </Button>
              </div>
              {importResult && (
                <div className="flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 text-[11px] leading-relaxed">
                  {importResult.ok ? (
                    <>
                      <p className="font-mono">
                        scanned {importResult.scanned} / 検出{" "}
                        {importResult.parsed} / 新規 {importResult.inserted} /
                        重複 {importResult.duplicates}
                        {(importResult.skippedFuture ?? 0) > 0 &&
                          ` / 未来日時 skip ${importResult.skippedFuture}`}
                        {(importResult.cleanedFuture ?? 0) > 0 &&
                          ` / 未来日時 cleanup ${importResult.cleanedFuture}`}
                      </p>
                      <p className="text-muted-foreground text-[10px]">
                        Discord は最新 100 件まで取得します（必要なら時間を
                        おいて再実行）。未来日時の通知メッセージは過去日程に
                        混ざらないよう自動で除外・クリーンアップされます。
                      </p>
                    </>
                  ) : (
                    <p className="text-rose-300">
                      エラー: {importResult.reason ?? "原因不明"}
                    </p>
                  )}
                </div>
              )}
            </div>

            {snapshotResult && (
              <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
                <button
                  type="button"
                  onClick={() => setSnapshotResult(null)}
                  aria-label="スナップショット結果を閉じる"
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
                {snapshotResult.ok ? (
                  <>
                    <p className="font-mono">
                      対象 {snapshotResult.scanned} 件 / 新規{" "}
                      <strong>{snapshotResult.inserted}</strong> / 更新{" "}
                      <strong>{snapshotResult.updated}</strong>
                    </p>
                    <p className="text-muted-foreground text-[10px]">
                      character-sheets の現スケジュール全体を出席情報込みで保存しました。
                    </p>
                  </>
                ) : (
                  <p className="text-rose-300">
                    エラー: {snapshotResult.reason ?? "原因不明"}
                  </p>
                )}
              </div>
            )}
            {storedInfo && (
              <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
                <button
                  type="button"
                  onClick={() => setStoredInfo(null)}
                  aria-label="保存件数表示を閉じる"
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
                {storedInfo.ok ? (
                  <>
                    <p className="font-mono">
                      DB 保存件数: <strong>{storedInfo.count}</strong>
                    </p>
                    {storedInfo.recentRows.length > 0 && (
                      <ul className="font-mono text-[10px] text-muted-foreground">
                        <li className="mb-0.5">
                          直近 {storedInfo.recentRows.length} 件（新しい順
                          / 削除可）:
                        </li>
                        {storedInfo.recentRows.map((row, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-1.5 break-words py-0.5"
                          >
                            <button
                              type="button"
                              onClick={() => onDeleteStoredRow(row.rawDate)}
                              disabled={deletingRow}
                              aria-label={`${row.rawDate} を削除`}
                              title={`この行を schedule_past_sessions から削除`}
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                            <span className="text-muted-foreground/70">
                              [{row.source ?? "?"}]
                            </span>
                            <span>{row.rawDate}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-muted-foreground text-[10px]">
                      この件数はスケジュールページの「過去」に
                      マージされる候補数です。実際は開催されていない日が
                      混ざっていれば × ボタンで個別削除できます。0 なら
                      保存されていない or SELECT が RLS で拒否されています。
                    </p>
                  </>
                ) : (
                  <p className="text-rose-300">
                    エラー: {storedInfo.reason ?? "原因不明"}
                  </p>
                )}
              </div>
            )}
          </section>
          )}

          {/* FFLogs section — header + footer (changelog / signout) は
              全員に表示。フォーム本体だけ canEdit で gate。
              三 sources スタック:
              ① v1 表示名 (基本・常時表示) — Public のみ取得
              ② v2 OAuth (オプション・畳んで表示)
              ③ Session Cookie (オプション・Private/Unlisted 用、畳んで表示) */}
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <BarChart3 className="h-3.5 w-3.5 text-amber-300" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                FFLogs Sync
              </span>
            </header>

            {canEdit && (
            <>
            {/* v1 表示名 (基本) — Public レポートを取得する最も簡単な
                方法。FFLOGS_API_KEY env var (v1 Public Key) のみ必要、
                ブラウザでの操作不要。 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label
                  htmlFor="fflogs-username"
                  className="text-xs text-foreground/80"
                >
                  FFLogs 表示名 (基本)
                </Label>
                <a
                  href="https://www.fflogs.com/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-amber-300/85 underline decoration-dotted underline-offset-2 transition-colors hover:text-amber-300"
                  title="自分のプロフィールページを開く"
                >
                  <BarChart3 className="h-2.5 w-2.5" aria-hidden />
                  fflogs.com/profile
                </a>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Input
                  id="fflogs-username"
                  value={fflogsUsername}
                  onChange={(e) => setFflogsUsernameState(e.target.value)}
                  placeholder="例: Ascian_Emet-Selch"
                  // min-w only on sm+ so narrow phones (<640px) don't get
                  // a 12rem-wide input forced into a tighter row layout.
                  className="font-mono text-[12px] flex-1 sm:min-w-[12rem]"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    startSaveUsername(async () => {
                      const r = await setFflogsUsernameAction(fflogsUsername);
                      if (!r.ok) {
                        toast.error("表示名保存失敗: " + r.reason);
                        return;
                      }
                      toast.success("表示名を保存しました");
                    });
                  }}
                  disabled={savingUsername}
                  className="gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
                >
                  <Save className="h-3 w-3" aria-hidden />
                  保存
                </Button>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                <strong>基本構成</strong>: 表示名 + サーバーの{" "}
                <code className="font-mono">FFLOGS_API_KEY</code>
                {" "}env var (v1 Public Key) で
                <strong>Public レポート</strong> を取得します。
                Private/Unlisted も自動取得したい場合は、下のオプションを開いて{" "}
                <strong>Session Cookie</strong> を設定してください。
              </p>
            </div>

            {/* v2 OAuth — オプション。Public 取得を v1 より厳密にする
                (owner filter を API 側で適用)。Private/Unlisted の追加
                取得には貢献しないが、html scrape との連携で userId 取得に
                使われる。 */}
            <details className="group/oauth flex flex-col gap-2">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2 hover:bg-secondary/25 transition-colors">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                    <span className="text-[var(--neon-cyan)]/70 transition-transform group-open/oauth:rotate-90">
                      ▸
                    </span>
                    <Link2 className="h-3 w-3" aria-hidden />
                    OAuth 認証 (v2 API・オプション)
                  </span>
                  {oauthStatus?.connected && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-emerald-200 uppercase">
                      <span className="inline-block h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153)]" />
                      接続済
                    </span>
                  )}
                </div>
              </summary>
              <div className="ml-2 flex flex-col gap-2 rounded-md border border-amber-400/35 bg-amber-400/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-amber-200/95 uppercase">
                  <Link2 className="h-3 w-3" aria-hidden />
                  OAuth 認証 (v2 API)
                </span>
                {oauthStatus?.connected && (
                  <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-400/45 bg-emerald-400/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-emerald-200 uppercase">
                    <span className="inline-block h-1 w-1 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153)]" />
                    接続済
                  </span>
                )}
              </div>
              {oauthStatus?.connected ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-foreground/85">
                    {oauthStatus.userName ? (
                      <>
                        <strong>{oauthStatus.userName}</strong> として接続中
                      </>
                    ) : (
                      "FFLogs と接続済み"
                    )}
                  </p>
                  {oauthStatus.expiresAt && (
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      access_token 有効期限:{" "}
                      {new Date(oauthStatus.expiresAt).toLocaleString("ja-JP")}
                      （期限切れ時は refresh_token で自動更新）
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      startDisconnect(async () => {
                        const r = await disconnectFflogsOAuthAction();
                        if (!r.ok) {
                          toast.error("切断失敗: " + r.reason);
                          return;
                        }
                        setOauthStatus({
                          connected: false,
                          userName: null,
                          expiresAt: null,
                        });
                        toast.success("FFLogs OAuth を切断しました");
                      });
                    }}
                    disabled={disconnecting}
                    className="self-start inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:bg-secondary/60 hover:text-rose-200 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" aria-hidden />
                    {disconnecting ? "切断中..." : "切断"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] leading-relaxed text-foreground/85">
                    FFLogs にログインして認可すると、Public / Unlisted /
                    Private を含む自分のレポートを動画 / 過去予定に
                    自動紐づけできます。
                  </p>
                  <a
                    href="/api/auth/fflogs/start"
                    className="self-start inline-flex items-center gap-1.5 rounded-md border border-amber-400/55 bg-amber-400/15 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-amber-100 uppercase transition-colors hover:border-amber-400/80 hover:bg-amber-400/25"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                    FFLogs と OAuth 接続
                  </a>
                  <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                    ※ サーバー側で{" "}
                    <code className="font-mono">FFLOGS_OAUTH_CLIENT_ID</code>{" "}
                    と{" "}
                    <code className="font-mono">FFLOGS_OAUTH_CLIENT_SECRET</code>{" "}
                    の設定が必要（{" "}
                    <a
                      href="https://www.fflogs.com/api/clients/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--neon-cyan)] underline decoration-dotted underline-offset-2 hover:text-[var(--neon-cyan)]/85"
                    >
                      fflogs.com/api/clients/
                    </a>
                    {" "}で OAuth クライアントを作成）。リダイレクト URI には
                    現在のドメイン{" "}
                    <code className="font-mono">/api/auth/fflogs/callback</code>{" "}
                    を登録。
                  </p>
                </div>
              )}
              </div>
            </details>

            {/* Session Cookie — オプション。Private/Unlisted を取得したい
                場合のみ使う。auto-delete でセキュリティリスクを最小化。 */}
            <details className="group/cookie flex flex-col gap-2">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-400/40 bg-rose-500/5 px-3 py-2 hover:bg-rose-500/10 transition-colors">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-rose-200/95 uppercase">
                    <span className="text-rose-300/80 transition-transform group-open/cookie:rotate-90">
                      ▸
                    </span>
                    <BarChart3 className="h-3 w-3" aria-hidden />
                    Session Cookie (Private/Unlisted 用・オプション)
                  </span>
                  {cookieStatus?.set && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-amber-400/45 bg-amber-400/10 px-1.5 py-px font-mono text-[9px] tracking-[0.18em] text-amber-200 uppercase">
                      <span className="inline-block h-1 w-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgb(251_191_36)]" />
                      セット済 (次回連動で消費)
                    </span>
                  )}
                </div>
              </summary>
              <div className="ml-2 flex flex-col gap-2 rounded-md border border-rose-400/30 bg-rose-500/5 px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-foreground/85">
                <strong>Private / Unlisted のレポートも取得したい場合のみ</strong>
                {" "}使う opt-in 機能。fflogs.com にログインしたブラウザの
                cookie を一時的にここに保存し、次回「FFLogs と動画を連動」
                時に使われます。
              </p>
              <p className="text-[10px] leading-relaxed text-rose-200/85">
                <strong>⚠ セキュリティ注意</strong>: cookie は FFLogs
                アカウントの全権限を持ちます。漏れると当該アカウントに
                自由にアクセスできてしまいます。リスクを最小化するため、
                <strong>連動実行直後に自動削除</strong>される設計です
                （ワンタイムユース）。次回紐づけ時に都度再貼り付けが必要。
              </p>
              <details className="text-[10px]">
                <summary className="cursor-pointer text-muted-foreground/85 hover:text-foreground/90">
                  ▸ Cookie の取り方（Network タブから一括コピー — 推奨）
                </summary>
                <ol className="mt-1 ml-3.5 flex list-decimal flex-col gap-0.5 text-muted-foreground leading-relaxed">
                  <li>fflogs.com を開いて<strong>ログイン</strong></li>
                  <li>
                    自分のプロフィール{" "}
                    <code className="font-mono">/user/reports-list/...</code>{" "}
                    に移動
                  </li>
                  <li>
                    F12 で DevTools → <strong>Network</strong> タブを開く
                  </li>
                  <li>
                    ページを <strong>F5 でリロード</strong>{" "}
                    → リクエスト一覧の一番上（HTML ドキュメント）をクリック
                  </li>
                  <li>
                    右側 <strong>Headers</strong> タブ →{" "}
                    <strong>Request Headers</strong> セクション →{" "}
                    <code className="font-mono">Cookie:</code>{" "}
                    の右側の値（長い文字列）を全て選択してコピー
                  </li>
                  <li>下の入力欄に貼り付け → 保存 → すぐ「連動」を実行</li>
                </ol>
                <p className="mt-1 ml-3.5 text-muted-foreground/75 leading-relaxed">
                  ※ Cookie の名前は FFLogs 側の実装で変わる可能性があるため、
                  特定の cookie 名を探すのではなく <strong>Cookie ヘッダー
                  全体</strong> をそのまま使うのが確実です。
                  <br />
                  ※ 値は{" "}
                  <code className="font-mono">name1=value1; name2=value2; ...</code>
                  {" "}の形式で 1 行のテキスト。改行が含まれる場合は削除。
                </p>
              </details>
              <Input
                value={sessionCookieInput}
                onChange={(e) => setSessionCookieInput(e.target.value)}
                placeholder="name1=value1; name2=value2; ... (Cookie ヘッダー全体)"
                type="password"
                className="font-mono text-[11px]"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    startSaveCookie(async () => {
                      const r = await setFflogsSessionCookie(sessionCookieInput);
                      if (!r.ok) {
                        toast.error("Cookie 保存失敗: " + r.reason);
                        return;
                      }
                      toast.success(
                        "Cookie を保存しました — 次回連動時に使われ、その後自動削除されます",
                      );
                      setCookieStatus({ set: true, preview: null });
                      setSessionCookieInput("");
                    });
                  }}
                  disabled={savingCookie || !sessionCookieInput.trim()}
                  className="gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
                >
                  <Save className="h-3 w-3" aria-hidden />
                  Cookie 保存
                </Button>
                {cookieStatus?.set && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      startSaveCookie(async () => {
                        const r = await setFflogsSessionCookie("");
                        if (!r.ok) {
                          toast.error("Cookie 削除失敗: " + r.reason);
                          return;
                        }
                        toast.success("Cookie を削除しました");
                        setCookieStatus({ set: false, preview: null });
                      });
                    }}
                    disabled={savingCookie}
                    className="gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden />
                    今すぐ削除
                  </Button>
                )}
              </div>
              </div>
            </details>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onLinkLogs}
                  disabled={
                    linkingLogs ||
                    (!oauthStatus?.connected && !fflogsUsername.trim())
                  }
                  className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
                  title={
                    !oauthStatus?.connected && !fflogsUsername.trim()
                      ? "先に「FFLogs 表示名」を保存するか「OAuth 接続」を実行してください"
                      : "FFLogs レポートを動画 / 過去予定に自動紐づけ"
                  }
                >
                  {linkingLogs ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {linkingLogs ? "連動中..." : "FFLogs と動画を連動"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "全ての logs URL（動画 / 過去予定の自動紐づけ + 手動紐づけの両方）をクリアします。よろしいですか？",
                      )
                    )
                      return;
                    startClearLogs(async () => {
                      const r = await clearAllFflogsLinks();
                      if (!r.ok) {
                        toast.error("クリア失敗: " + (r.reason ?? "原因不明"));
                        return;
                      }
                      toast.success(
                        `動画 ${r.videosCleared} 件 / 過去予定 ${r.sessionsCleared} 件の logs URL をクリア`,
                      );
                      router.refresh();
                    });
                  }}
                  disabled={clearingLogs}
                  className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase text-rose-200"
                  title="全 logs URL を一括削除（過去の v1 fallback で誤って紐づいたものをリセット）"
                >
                  {clearingLogs ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {clearingLogs ? "クリア中..." : "全 logs URL クリア"}
                </Button>
              </div>
              {logsResult && (
                <div className="relative flex flex-col gap-0.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 pr-7 text-[11px] leading-relaxed">
                  <button
                    type="button"
                    onClick={() => setLogsResult(null)}
                    aria-label="結果を閉じる"
                    className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                  {logsResult.ok ? (
                    <>
                      <p className="font-mono">
                        動画 <strong>{logsResult.matched}</strong> /{" "}
                        過去予定 <strong>{logsResult.sessionsMatched}</strong>
                        {" "}件を紐づけ · レポート {logsResult.reportsScanned}
                        {logsResult.reportsScanned >= 625 && (
                          <span
                            className="ml-1 inline-flex items-center gap-1 rounded-sm border border-amber-400/40 bg-amber-400/10 px-1 py-px text-[9px] tracking-[0.16em] text-amber-200/85 uppercase"
                            title="FFLogs v2 API のページネーション上限 (25 ページ × 25 件) に達しました。それ以前の古いレポートは取得できていない可能性があります"
                          >
                            上限到達
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/70">
                        候補: 動画 {logsResult.videosScanned} / 過去予定{" "}
                        {logsResult.sessionsScanned}
                      </p>
                      {/* Diagnostics: when nothing matched, show the
                          date ranges so the user can spot a "different
                          time period" mismatch (e.g. their FFLogs
                          uploads are from 2024 but videos start 2025).
                          Also explains the 12-reports situation when
                          the API returns only one user's owned reports. */}
                      {logsResult.matched === 0 &&
                        logsResult.sessionsMatched === 0 &&
                        logsResult.reportsScanned > 0 && (
                          <div className="mt-2 flex flex-col gap-1 rounded-sm border border-amber-400/30 bg-amber-400/5 px-2 py-1.5">
                            <p className="font-mono text-[10px] text-amber-200/90">
                              ⚠ どれもマッチしませんでした — 期間の不一致が原因の可能性
                            </p>
                            <ul className="ml-2 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                              {logsResult.queriedUsername && (
                                <li>
                                  クエリしたユーザー名:{" "}
                                  <strong className="text-foreground/90">
                                    {logsResult.queriedUsername}
                                  </strong>
                                </li>
                              )}
                              {logsResult.reportsDateRange && (
                                <li>
                                  レポート期間:{" "}
                                  <strong className="text-amber-200/80">
                                    {logsResult.reportsDateRange.earliest}
                                    {" 〜 "}
                                    {logsResult.reportsDateRange.latest}
                                  </strong>
                                </li>
                              )}
                              {logsResult.videosDateRange && (
                                <li>
                                  未紐づけ動画期間:{" "}
                                  <span className="text-foreground/85">
                                    {logsResult.videosDateRange.earliest}
                                    {" 〜 "}
                                    {logsResult.videosDateRange.latest}
                                  </span>
                                </li>
                              )}
                              {logsResult.sessionsDateRange && (
                                <li>
                                  未紐づけ過去予定期間:{" "}
                                  <span className="text-foreground/85">
                                    {logsResult.sessionsDateRange.earliest}
                                    {" 〜 "}
                                    {logsResult.sessionsDateRange.latest}
                                  </span>
                                </li>
                              )}
                            </ul>
                            <div className="mt-1.5 flex flex-col gap-1 rounded-sm bg-secondary/30 px-2 py-1.5 text-[10px] leading-relaxed">
                              <p className="font-mono text-[10px] text-amber-200/90">
                                想定される原因 — FFLogs API の制約：
                              </p>
                              <p className="text-muted-foreground leading-relaxed">
                                FFLogs v2 API は <strong>Public</strong> 設定の
                                レポートしか自動取得できません（OAuth で本人認証
                                していても <strong>Private (非公開)</strong> /{" "}
                                <strong>Unlisted (限定公開)</strong> は API
                                では露出されない仕様）。レポート期間が
                                <strong> 古い日付に偏っている</strong>場合、
                                最近のレポートは Public 以外の visibility に
                                なっている可能性が高いです。
                              </p>
                              <p className="text-muted-foreground leading-relaxed mt-1">
                                対処：
                              </p>
                              <ol className="ml-3.5 flex list-decimal flex-col gap-1 text-muted-foreground">
                                <li>
                                  <strong>fflogs.com で当該レポートを Public に変更</strong>
                                  {" "}→ 再度「FFLogs と動画を連動」で取得可能
                                </li>
                                <li>
                                  <strong>個別に手動紐づけ</strong>
                                  {" "}— スケジュール上の日付をクリックして
                                  メモポップオーバー最下部の{" "}
                                  <strong>FFLogs URL 欄</strong>に
                                  レポート URL を貼り付け
                                </li>
                                <li>
                                  <strong>表示名 / API キーが別人の可能性</strong>
                                  {" "}— 上の「v2 currentUser」が想定通りの
                                  ユーザーになっているか確認
                                </li>
                              </ol>
                            </div>
                          </div>
                        )}
                      {/* Fetched report list — lets the user verify
                          which reports the API actually returned. If
                          they're old / unfamiliar / wrong group, the
                          username probably points to a stale account. */}
                      {logsResult.reportSamples &&
                        logsResult.reportSamples.length > 0 && (
                          <details className="mt-2 group/reports">
                            <summary className="cursor-pointer list-none text-[10px] text-muted-foreground/80 hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
                              <span className="inline-flex items-center gap-1">
                                <span className="text-[var(--neon-cyan)]/70 transition-transform group-open/reports:rotate-90">
                                  ▸
                                </span>
                                取得済みレポート (新しい順 上位
                                {logsResult.reportSamples.length} 件)
                              </span>
                            </summary>
                            <ul className="mt-1.5 ml-3.5 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                              {logsResult.reportSamples.map((r, i) => (
                                <li
                                  key={i}
                                  className="flex items-baseline gap-2 break-words"
                                >
                                  <span className="shrink-0 tabular-nums text-amber-200/70">
                                    {r.date}
                                  </span>
                                  <a
                                    href={r.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="min-w-0 flex-1 truncate text-foreground/85 underline decoration-dotted underline-offset-2 hover:text-[var(--neon-cyan)]"
                                    title={r.title}
                                  >
                                    {r.title}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      {/* 詳細診断パネル — 各フェッチレイヤーの結果を
                          全部見せる。なぜ 0 件なのか切り分けに使う。 */}
                      {logsResult.diag && (
                        <details className="mt-2 group/diag">
                          <summary className="cursor-pointer list-none text-[10px] text-muted-foreground/80 hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-amber-300/70 transition-transform group-open/diag:rotate-90">
                                ▸
                              </span>
                              詳細診断（v2 / HTML スクレイプの取得状況）
                            </span>
                          </summary>
                          <div className="mt-1.5 ml-3.5 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                            {logsResult.diag.v2Me && (
                              <p>
                                v2 currentUser: id=
                                <strong className="text-foreground/85">
                                  {logsResult.diag.v2Me.id}
                                </strong>
                                {" / name="}
                                <strong className="text-foreground/85">
                                  {logsResult.diag.v2Me.name || "(空)"}
                                </strong>
                              </p>
                            )}
                            <p>
                              v2 raw fetched:{" "}
                              <strong className="text-foreground/85">
                                {logsResult.diag.v2RawCount ?? "(なし)"}
                              </strong>
                              {" / owner-filter 通過: "}
                              <strong className="text-foreground/85">
                                {logsResult.diag.v2OwnedCount ?? "(なし)"}
                              </strong>
                            </p>
                            {logsResult.diag.v2OwnersSample &&
                              logsResult.diag.v2OwnersSample.length > 0 && (
                                <>
                                  <p className="mt-0.5">
                                    v2 取得時の owner 上位:
                                  </p>
                                  <ul className="ml-3 flex flex-col gap-0.5">
                                    {logsResult.diag.v2OwnersSample.map(
                                      (o, i) => (
                                        <li key={i}>
                                          ・id={o.id ?? "(null)"} / name=
                                          {o.name ?? "(null)"} ×{o.count}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </>
                              )}
                            {logsResult.diag.htmlPageSize !== undefined && (
                              <p className="mt-0.5">
                                HTML スクレイプ: page1 size=
                                <strong className="text-foreground/85">
                                  {logsResult.diag.htmlPageSize}
                                </strong>
                                {" bytes / 検出 codes="}
                                <strong className="text-foreground/85">
                                  {logsResult.diag.htmlCodesFound ?? 0}
                                </strong>
                                {" / 取得 reports="}
                                <strong className="text-foreground/85">
                                  {logsResult.diag.htmlReportCount ?? 0}
                                </strong>
                              </p>
                            )}
                            <p className="mt-0.5">
                              Session Cookie 適用:{" "}
                              <strong
                                className={
                                  logsResult.diag.cookieUsed
                                    ? "text-emerald-300"
                                    : "text-rose-300/80"
                                }
                              >
                                {logsResult.diag.cookieUsed ? "あり" : "なし"}
                              </strong>
                              {logsResult.diag.cookieUsed && (
                                <span className="ml-1 text-muted-foreground/70">
                                  (連動完了後に自動削除済)
                                </span>
                              )}
                            </p>
                            {logsResult.diag.htmlScrapeError && (
                              <p className="mt-0.5 text-rose-300/85">
                                HTML スクレイプエラー:{" "}
                                {logsResult.diag.htmlScrapeError}
                              </p>
                            )}
                            {(logsResult.diag.videosSkippedNoPostedAt ?? 0) >
                              0 && (
                              <p className="mt-0.5 text-amber-200/85">
                                ⚠ タイトル日付なしでスキップ:{" "}
                                <strong>
                                  {logsResult.diag.videosSkippedNoPostedAt}
                                </strong>
                                {" 件"}
                                <span className="ml-1 text-muted-foreground/85">
                                  ※ 1.9.9 から、タイトルに raid 日が無い動画は
                                  自動マッチ対象から除外（誤マッチ防止）。
                                  動画編集ダイアログから FFLogs URL を手動指定
                                  してください
                                </span>
                              </p>
                            )}
                            {logsResult.diag.titleDateHitCount !== undefined && (
                              <p className="mt-0.5">
                                タイトル日付抽出:
                                {" 成功 "}
                                <strong className="text-emerald-300">
                                  {logsResult.diag.titleDateHitCount}
                                </strong>
                                {" / 失敗 "}
                                <strong className="text-rose-300">
                                  {logsResult.diag.titleDateMissCount ?? 0}
                                </strong>
                                {" 件"}
                                <span className="ml-1 text-muted-foreground/70">
                                  (失敗 = 自動マッチ対象外)
                                </span>
                              </p>
                            )}
                            {logsResult.diag.titleDateMissSample &&
                              logsResult.diag.titleDateMissSample.length >
                                0 && (
                                <details className="mt-1 group/missdates">
                                  <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
                                    <span className="inline-flex items-center gap-1">
                                      <span className="text-rose-300/70 transition-transform group-open/missdates:rotate-90">
                                        ▸
                                      </span>
                                      日付抽出に失敗したタイトル (上位
                                      {logsResult.diag.titleDateMissSample.length}
                                      件)
                                    </span>
                                  </summary>
                                  <ul className="mt-1 ml-3 flex flex-col gap-0.5 font-mono text-[9px] leading-tight text-muted-foreground">
                                    {logsResult.diag.titleDateMissSample.map(
                                      (t, i) => (
                                        <li
                                          key={i}
                                          className="break-all bg-secondary/20 px-1.5 py-0.5 rounded"
                                        >
                                          {t}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </details>
                              )}
                            {logsResult.diag.htmlSample && (
                              <details className="mt-1.5 group/htmlsample">
                                <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
                                  <span className="inline-flex items-center gap-1">
                                    <span className="text-amber-300/70 transition-transform group-open/htmlsample:rotate-90">
                                      ▸
                                    </span>
                                    HTML サンプル (最初のレポートコード周辺)
                                  </span>
                                </summary>
                                <pre className="mt-1 ml-3 rounded bg-secondary/30 px-1.5 py-1 font-mono text-[9px] leading-tight whitespace-pre-wrap break-all text-muted-foreground/85 max-h-[16rem] overflow-y-auto">
                                  {logsResult.diag.htmlSample}
                                </pre>
                              </details>
                            )}
                            {logsResult.userTypeFields &&
                              logsResult.userTypeFields.length > 0 && (
                                <details className="mt-1.5 group/userfields">
                                  <summary className="cursor-pointer list-none text-[10px] hover:text-foreground/90 [&::-webkit-details-marker]:hidden">
                                    <span className="inline-flex items-center gap-1">
                                      <span className="text-amber-300/70 transition-transform group-open/userfields:rotate-90">
                                        ▸
                                      </span>
                                      User 型のフィールド一覧 (introspect、{
                                        logsResult.userTypeFields.length
                                      } 個)
                                    </span>
                                  </summary>
                                  <pre className="mt-1 ml-3 rounded bg-secondary/30 px-1.5 py-1 font-mono text-[9px] leading-tight whitespace-pre-wrap break-words text-muted-foreground/85 max-h-[12rem] overflow-y-auto">
                                    {logsResult.userTypeFields.join("\n")}
                                  </pre>
                                </details>
                              )}
                          </div>
                        </details>
                      )}
                      {logsResult.details.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                          {logsResult.details.slice(0, 8).map((d, i) => {
                            const dateMismatch =
                              d.videoDate &&
                              d.reportDate &&
                              !d.videoDate.startsWith(d.reportDate) &&
                              !d.reportDate.startsWith(d.videoDate.slice(0, 10));
                            return (
                              <li key={i} className="break-words">
                                <span
                                  className={
                                    d.kind === "video"
                                      ? "text-amber-200/80"
                                      : "text-[var(--neon-cyan)]/80"
                                  }
                                >
                                  {d.kind === "video" ? "▶" : "📅"}
                                </span>{" "}
                                {d.videoDate && (
                                  <span
                                    className={
                                      dateMismatch
                                        ? "text-rose-300"
                                        : "text-emerald-300/80"
                                    }
                                    title={
                                      dateMismatch
                                        ? "video 日付とレポート日付がズレている"
                                        : "video 日付と一致"
                                    }
                                  >
                                    [{d.videoDate}
                                    {d.reportDate &&
                                      d.videoDate !== d.reportDate &&
                                      `→${d.reportDate}`}
                                    ]
                                  </span>
                                )}{" "}
                                {d.label.slice(0, 40)}
                                {d.label.length > 40 ? "…" : ""}
                                {d.reportStartJst && (
                                  <span className="ml-1 text-[9px] text-muted-foreground/70">
                                    {` · report=${d.reportStartJst} JST`}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                          {logsResult.details.length > 8 && (
                            <li className="text-muted-foreground/60">
                              …他 {logsResult.details.length - 8} 件
                            </li>
                          )}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-rose-300">
                      エラー: {logsResult.reason ?? "原因不明"}
                    </p>
                  )}
                </div>
              )}
            </div>
            </>
            )}

            <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
              {/* 更新履歴ボタン + GitHub リポジトリへのリンクを横並び。
                  GitHub アイコンを単独配置すると意図が伝わりにくいので、
                  ラベル "Source" を併記してアウトラインボタンと統一感を出す。 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChangelog((v) => !v)}
                  className="gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
                  title="更新履歴を表示 / 非表示"
                  aria-expanded={showChangelog}
                >
                  <FileClock className="h-3 w-3" aria-hidden />
                  {showChangelog ? "更新履歴を隠す" : "更新履歴"}
                </Button>
                <a
                  href="https://github.com/yyamazaki-lym/raid-repository"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="GitHub リポジトリを新しいタブで開く"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-secondary/40 hover:text-foreground"
                >
                  <GithubMark className="h-3 w-3" />
                  Source
                </a>
                {/* TODO #18 (1.9 (2026-04-28)): FF14 Lodestone への
                    外部リンク。出欠 / 装備チェック / Mog ステーション等の
                    公式入口として頻繁にアクセスするので、設定ダイアログ
                    フッターに常駐させる。 */}
                <a
                  href="https://jp.finalfantasyxiv.com/lodestone/"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="FF14 Lodestone (公式) を新しいタブで開く"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-secondary/40 hover:text-foreground"
                >
                  <Link2 className="h-3 w-3" aria-hidden />
                  Lodestone
                </a>
                {/* 2.1 (2026-04-29): サインアウトボタンは頻度が低いため
                    SiteHeader から本ダイアログ内に移設。誤クリック防止
                    のため confirm を経由してから /auth/sign-out POST。 */}
                <form
                  action="/auth/sign-out"
                  method="post"
                  className="inline-flex"
                  onSubmit={(e) => {
                    if (!window.confirm("サインアウトしますか?")) {
                      e.preventDefault();
                    }
                  }}
                >
                  <button
                    type="submit"
                    title="サインアウト"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/5 px-3 font-mono text-[10px] tracking-[0.18em] text-rose-300 uppercase transition-colors hover:border-rose-400/60 hover:bg-rose-400/10 hover:text-rose-200"
                  >
                    <LogOut className="h-3 w-3" aria-hidden />
                    Sign out
                  </button>
                </form>
              </div>
              {showChangelog && (
                <div className="flex flex-col gap-3 rounded-sm border border-border/40 bg-secondary/20 px-3 py-2.5 text-[11px] leading-relaxed">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                    更新履歴 — Release Notes
                  </p>
                  {RELEASES.length === 0 ? (
                    <p className="text-muted-foreground">記録なし</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {RELEASES.map((r, idx) => (
                        <li
                          key={`${r.version}|${r.date}`}
                          className="border-l-2 border-[var(--neon-cyan)]/40 pl-2.5"
                        >
                          {/* 各リリースは <details> で折りたたみ。最新の
                              1 件のみ default open、他は閉じた状態で開始。
                              ▶/▼ 表示は親の [open] 状態を参照して回転 */}
                          <details open={idx === 0} className="group/release">
                            <summary className="flex cursor-pointer list-none items-baseline gap-2 select-none outline-none [&::-webkit-details-marker]:hidden">
                              <span
                                aria-hidden
                                className="inline-block w-2 text-[10px] text-muted-foreground transition-transform duration-150 group-open/release:rotate-90"
                              >
                                ▶
                              </span>
                              <span className="font-mono text-[12px] font-bold text-[var(--neon-cyan)]">
                                v{r.version}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {r.date}
                              </span>
                              {r.parts && (
                                <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/70 uppercase">
                                  {r.parts.length} parts
                                </span>
                              )}
                            </summary>

                            {/* 展開時の本体: parts (新スキーム) があれば
                                part 単位の collapsible、無ければ notes
                                (旧スキーム) のフラットな箇条書き。
                                1.9 (2026-04-28) TODO #11: 各 release 内の
                                parts も最新 5 個に制限して表示を絞る。
                                (大項目: 5 件、小項目: 5 件 / 大項目) */}
                            <div className="mt-1.5 ml-3 flex flex-col gap-1">
                              {r.parts ? (
                                <>
                                {r.parts.slice(0, 5).map((p, i) => (
                                  <details
                                    key={i}
                                    className="group/part rounded-sm border border-border/30 bg-secondary/25"
                                  >
                                    <summary className="flex cursor-pointer list-none items-start gap-1.5 px-2 py-1 select-none outline-none hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
                                      <span
                                        aria-hidden
                                        className="mt-[2px] inline-block w-2 text-[10px] text-muted-foreground transition-transform duration-150 group-open/part:rotate-90"
                                      >
                                        ▶
                                      </span>
                                      <span className="flex-1 text-[11px] leading-snug text-foreground/90">
                                        {p.title}
                                      </span>
                                    </summary>
                                    <p className="px-3 pt-1 pb-2 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                                      {p.body}
                                    </p>
                                  </details>
                                ))}
                                {r.parts.length > 5 && (
                                  <p className="ml-2 font-mono text-[9px] tracking-[0.18em] text-muted-foreground/70 uppercase">
                                    … +{r.parts.length - 5} more
                                  </p>
                                )}
                                </>
                              ) : (
                                <ul className="flex flex-col gap-0.5 text-[11px] text-foreground/85">
                                  {(r.notes ?? []).map((n, i) => (
                                    <li key={i} className="leading-snug">
                                      ・{n}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 1.9 (2026-04-28) — 古い changelog エントリーは
                      bundle weight 削減のため source から削除済み。それ
                      以前の履歴は GitHub commits 一覧で確認可能 */}
                  <a
                    href="https://github.com/yyamazaki-lym/raid-repository/commits/main"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="self-start font-mono text-[10px] tracking-[0.18em] text-[var(--neon-cyan)]/85 uppercase transition-colors hover:text-[var(--neon-cyan)]"
                    title="これ以前の更新履歴は GitHub commits で確認"
                  >
                    ↗ これより前の履歴を GitHub で見る
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* TODO #23 (2.1): Danger Zone — 全データ初期化。admin 限定で
              表示、誤操作防止のため 2 段階確認 dialog (warn → INITIALIZE
              入力) を必須にしている。settings dialog 末尾に隔離配置 */}
          {canEdit && (
            <section className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-rose-300 uppercase">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Danger Zone
              </h3>
              <div className="flex flex-col gap-2.5 rounded-md border border-rose-400/30 bg-rose-400/5 p-3">
                <p className="text-[12px] leading-relaxed text-rose-100/90">
                  サイト全体のデータを削除して初期化します。すべてのカテゴリ
                  / 動画 / 戦略 / 過去スケジュール / アプリ設定が消去されます。
                  この操作は取り消せません。
                </p>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setShowDataInitDialog(true)}
                    className="gap-1.5 border border-rose-400/50 bg-rose-500/20 font-mono text-[11px] tracking-[0.18em] text-rose-100 uppercase hover:bg-rose-500/30"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    全データ初期化
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <DataInitConfirmDialog
        open={showDataInitDialog}
        onOpenChange={setShowDataInitDialog}
        onComplete={(result) => {
          if (result.ok) {
            // 初期化後は settings dialog 自体も閉じてリロード相当の状態に
            // 戻す。サーバ側で revalidatePath 済みなので router.refresh()
            // で次回 fetch から空状態を取り直す。
            setOpen(false);
            router.refresh();
          }
        }}
      />
    </Dialog>
  );
}
