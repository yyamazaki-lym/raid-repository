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
  X,
} from "lucide-react";
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
  setDiscordScheduleChannelId,
  setFflogsUsername,
  setScheduleUrl,
} from "@/lib/schedule-url-store";
import {
  countStoredPastSessions,
  importPastScheduleFromDiscord,
  linkFflogsReports,
  snapshotScheduleNow,
  type ScheduleSnapshotResult,
} from "@/lib/server/categories-actions";
import { RELEASES } from "@/lib/changelog";

type FflogsLinkResultLite = {
  ok: boolean;
  reason?: string;
  reportsScanned: number;
  videosScanned: number;
  matched: number;
  details: Array<{ videoTitle: string; reportTitle: string; reportUrl: string }>;
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
export function SettingsDialog() {
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
    sampleRawDates: string[];
    reason?: string;
  } | null>(null);
  const [snapshotting, startSnapshot] = useTransition();
  const [snapshotResult, setSnapshotResult] =
    useState<ScheduleSnapshotResult | null>(null);
  const [fflogsUsername, setFflogsUsernameState] = useState("");
  const [linkingLogs, startLinkLogs] = useTransition();
  const [logsResult, setLogsResult] = useState<FflogsLinkResultLite | null>(
    null,
  );
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [currentUrl, currentChannel, currentFflogs] = await Promise.all([
        getScheduleUrlFromDb(),
        getDiscordScheduleChannelId(),
        getFflogsUsername(),
      ]);
      if (!cancelled) {
        setUrl(currentUrl ?? "");
        setChannelId(currentChannel ?? "");
        setFflogsUsernameState(currentFflogs ?? "");
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
    const urlResult = await setScheduleUrl(url);
    if (!urlResult.ok) {
      setBusy(false);
      toast.error("URL: " + urlResult.reason);
      return;
    }
    const channelResult = await setDiscordScheduleChannelId(channelId);
    if (!channelResult.ok) {
      setBusy(false);
      toast.error("チャンネルID: " + channelResult.reason);
      return;
    }
    const fflogsResult = await setFflogsUsername(fflogsUsername);
    setBusy(false);
    if (!fflogsResult.ok) {
      toast.error("FFLogs: " + fflogsResult.reason);
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
        toast.error("取り込み失敗: " + (r.reason ?? "unknown"));
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
      if (!r.ok) toast.error("件数取得失敗: " + (r.reason ?? "unknown"));
    });
  };

  const onSnapshot = () => {
    setSnapshotResult(null);
    startSnapshot(async () => {
      const r = await snapshotScheduleNow();
      setSnapshotResult(r);
      if (!r.ok) {
        toast.error("スナップショット失敗: " + (r.reason ?? "unknown"));
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
        toast.error("FFLogs 連動失敗: " + (r.reason ?? "unknown"));
        return;
      }
      toast.success(
        r.matched > 0
          ? `${r.matched} 件の動画に Logs URL を紐づけ`
          : r.videosScanned === 0
            ? "logs_url 未設定の動画なし"
            : `合うレポートなし (報告 ${r.reportsScanned} / 動画 ${r.videosScanned})`,
      );
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

        <div className="flex max-h-[70svh] flex-col gap-5 overflow-y-auto p-5">
          {/* Schedule URL */}
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                Schedule Source
              </span>
            </header>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="schedule-url"
                className="text-xs text-foreground/80"
              >
                スケジュールページの URL
              </Label>
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
              <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
                ※ 元サイトの変更は最大{" "}
                <strong>10 分</strong> 遅れて反映されます。
              </p>
            </div>
          </section>

          {/* Discord schedule history */}
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
                  className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
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
                  className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
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
                  className="gap-1.5 font-mono text-[10px] tracking-widest uppercase"
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
                      </p>
                      <p className="text-muted-foreground text-[10px]">
                        Discord は最新 100 件まで取得します（必要なら時間を
                        おいて再実行）。
                      </p>
                    </>
                  ) : (
                    <p className="text-rose-300">
                      エラー: {importResult.reason ?? "unknown"}
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
                    エラー: {snapshotResult.reason ?? "unknown"}
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
                    {storedInfo.sampleRawDates.length > 0 && (
                      <ul className="font-mono text-[10px] text-muted-foreground">
                        <li>サンプル（新しい順）:</li>
                        {storedInfo.sampleRawDates.map((s, i) => (
                          <li key={i} className="break-words">
                            ・{s}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-muted-foreground text-[10px]">
                      この件数はスケジュールページの「過去」に
                      マージされる候補数です。0 なら保存されていない or
                      SELECT が RLS で拒否されています。
                    </p>
                  </>
                ) : (
                  <p className="text-rose-300">
                    エラー: {storedInfo.reason ?? "unknown"}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* FFLogs section — feature-gated by FFLOGS_API_KEY env var
              (silently allows username field but the link button will
              report "API key 未設定" if not configured). */}
          <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2 border-b border-border/30 pb-2">
              <BarChart3 className="h-3.5 w-3.5 text-amber-300" aria-hidden />
              <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
                FFLogs Sync
              </span>
            </header>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="fflogs-username"
                className="text-xs text-foreground/80"
              >
                FFLogs ユーザー名 / プロフィール URL（任意）
              </Label>
              <Input
                id="fflogs-username"
                value={fflogsUsername}
                onChange={(e) => setFflogsUsernameState(e.target.value)}
                placeholder="例: TaroYamada または https://ja.fflogs.com/user/reports-list/70734"
                className="font-mono text-[12px]"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                代表 1 名分のレポートで OK — 動画の投稿日時 ±36h でマッチした
                FFLogs レポートを自動的に動画の logs URL に紐づけます。
              </p>
              <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
                サーバー側で <code className="font-mono">FFLOGS_API_KEY</code>
                {" "}環境変数の設定も必要（Vercel ダッシュボード）。
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLinkLogs}
                disabled={linkingLogs || !fflogsUsername.trim()}
                className="self-start gap-1.5 font-mono text-[11px] tracking-widest uppercase"
                title={
                  !fflogsUsername.trim()
                    ? "FFLogs ユーザー名を入力（先に保存）"
                    : "FFLogs レポートを動画に自動紐づけ"
                }
              >
                {linkingLogs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                )}
                {linkingLogs ? "連動中..." : "FFLogs と動画を連動"}
              </Button>
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
                        新規紐づけ <strong>{logsResult.matched}</strong> 件
                        / レポート {logsResult.reportsScanned} / 動画候補{" "}
                        {logsResult.videosScanned}
                      </p>
                      {logsResult.details.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                          {logsResult.details.slice(0, 5).map((d, i) => (
                            <li key={i} className="break-words">
                              <span className="text-amber-200/80">→</span>{" "}
                              {d.videoTitle.slice(0, 40)}
                              {d.videoTitle.length > 40 ? "…" : ""}
                            </li>
                          ))}
                          {logsResult.details.length > 5 && (
                            <li className="text-muted-foreground/60">
                              …他 {logsResult.details.length - 5} 件
                            </li>
                          )}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-rose-300">
                      エラー: {logsResult.reason ?? "unknown"}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowChangelog((v) => !v)}
                className="self-start gap-1.5 font-mono text-[10px] tracking-widest uppercase"
                title="更新履歴を表示 / 非表示"
                aria-expanded={showChangelog}
              >
                <FileClock className="h-3 w-3" aria-hidden />
                {showChangelog ? "更新履歴を隠す" : "更新履歴"}
              </Button>
              {showChangelog && (
                <div className="flex flex-col gap-3 rounded-sm border border-border/40 bg-secondary/20 px-3 py-2.5 text-[11px] leading-relaxed">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                    更新履歴 — Release Notes
                  </p>
                  {RELEASES.length === 0 ? (
                    <p className="text-muted-foreground">記録なし</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {RELEASES.map((r) => (
                        <li
                          key={r.version}
                          className="flex flex-col gap-1 border-l-2 border-[var(--neon-cyan)]/40 pl-2.5"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[12px] font-bold text-[var(--neon-cyan)]">
                              v{r.version}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {r.date}
                            </span>
                          </div>
                          <ul className="flex flex-col gap-0.5 text-[11px] text-foreground/85">
                            {r.notes.map((n, i) => (
                              <li key={i} className="leading-snug">
                                ・{n}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="font-mono text-[11px] tracking-widest uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
