"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Eye, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAttendanceReminderSettingsAction,
  previewAttendanceReminderAction,
  sendAttendanceReminderNowAction,
  setAttendanceReminderChannelAction,
  setAttendanceReminderEnabledAction,
  setAttendanceReminderExcludedAction,
  setAttendanceReminderHourAction,
  setAttendanceReminderLeadDaysAction,
  setAttendanceReminderMemberMapAction,
  type AttendanceReminderSettings,
} from "@/lib/server/attendance-reminder-actions";
import type { ReminderPreview } from "@/lib/server/attendance-reminder";

/**
 * 出欠催促の設定 (2026-08-30、調査 第3回 D-3)。
 *
 * 「開催の N 日前の指定時刻に、まだ出欠を入れていない人だけをまとめて
 * メンションする」機能の設定一式。メンションは取り消せない副作用なので
 *   - 既定 OFF (明示的に ON にするまで送らない)
 *   - 送信前に「誰に飛ぶか」を確認できるプレビュー
 *   - 常に未入力のメンバーを黙って外す除外リスト
 * の 3 点を UI に必ず出す。
 *
 * 表示名 → Discord ユーザー ID の対応表が要るのは、sync モード
 * (character-sheets) が表示名しか持たないため。ID 未登録の人は
 * メンションされず名前だけ本文に出る (実害なく、設定漏れも見て分かる)。
 */
export function AttendanceReminderSection({
  open,
  canEdit,
}: {
  open: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<AttendanceReminderSettings | null>(
    null,
  );
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [previewChecked, setPreviewChecked] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [sending, startSend] = useTransition();

  // draft 群 (保存ボタン押下まで反映しない)
  const [channelDraft, setChannelDraft] = useState("");
  const [hourDraft, setHourDraft] = useState("21");
  const [leadDraft, setLeadDraft] = useState("1");
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [excludedDraft, setExcludedDraft] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !canEdit || loaded) return;
    let cancelled = false;
    void getAttendanceReminderSettingsAction().then((r) => {
      if (cancelled) return;
      setLoaded(true);
      if (!r.ok) return;
      setSettings(r.settings);
      setChannelDraft(r.settings.channelId);
      setHourDraft(String(r.settings.hour));
      setLeadDraft(String(r.settings.leadDays));
      setMapDraft(r.settings.memberMap);
      setExcludedDraft(r.settings.excluded);
    });
    return () => {
      cancelled = true;
    };
  }, [open, canEdit, loaded]);

  if (!canEdit) return null;

  const enabled = settings?.enabled ?? false;
  // 候補名: スケジュールソース由来 + 既に対応表 / 除外に入っている名前。
  const names = Array.from(
    new Set([
      ...(settings?.memberNames ?? []),
      ...Object.keys(mapDraft),
      ...excludedDraft,
    ]),
  );

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      const r = await setAttendanceReminderEnabledAction(next);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      setSettings((s) => (s ? { ...s, enabled: next } : s));
      toast.success(next ? "催促を ON にしました" : "催促を OFF にしました");
      router.refresh();
    });
  };

  const onSaveBasics = () => {
    const hour = Number.parseInt(hourDraft, 10);
    const lead = Number.parseInt(leadDraft, 10);
    startTransition(async () => {
      const results = await Promise.all([
        setAttendanceReminderChannelAction(channelDraft),
        setAttendanceReminderHourAction(hour),
        setAttendanceReminderLeadDaysAction(lead),
      ]);
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) {
        toast.error(failed.reason);
        return;
      }
      setSettings((s) =>
        s ? { ...s, channelId: channelDraft, hour, leadDays: lead } : s,
      );
      toast.success("送信設定を保存しました");
      router.refresh();
    });
  };

  const onSaveMembers = () => {
    startTransition(async () => {
      const entries = Object.entries(mapDraft).map(([name, discordUserId]) => ({
        name,
        discordUserId,
      }));
      const [mapResult, excludedResult] = await Promise.all([
        setAttendanceReminderMemberMapAction(entries),
        setAttendanceReminderExcludedAction(excludedDraft),
      ]);
      if (!mapResult.ok) {
        toast.error(mapResult.reason);
        return;
      }
      if (!excludedResult.ok) {
        toast.error(excludedResult.reason);
        return;
      }
      toast.success("メンション先 / 除外を保存しました");
      router.refresh();
    });
  };

  const onPreview = () => {
    startPreview(async () => {
      const r = await previewAttendanceReminderAction();
      setPreviewChecked(true);
      if (!r.ok) {
        toast.error(r.reason);
        setPreview(null);
        return;
      }
      setPreview(r.preview);
    });
  };

  const onSendNow = () => {
    startSend(async () => {
      const r = await sendAttendanceReminderNowAction();
      if (!r.ok) {
        toast.error("送信失敗: " + r.reason);
        return;
      }
      toast.success(
        r.posted > 0
          ? "催促を送信しました"
          : `送信しませんでした (${r.reason ?? "対象なし"})`,
      );
    });
  };

  return (
    <section>
      {/* 2026-09-04 実機要望「出欠の催促が長いので折り畳めるように」。
          設定ダイアログの中でこの節だけ縦に長く、下の節までスクロールする
          のが手間だった。Danger Zone / FFLogs 節と同じ native <details> に
          揃える (既定は畳む)。畳んだままでも運用状態が分かるよう、見出しに
          ON/OFF を出しておく — 「送っているのか」は開かずに知りたい情報。 */}
      <details className="group/reminder flex flex-col gap-3">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h3 className="flex items-center gap-2 border-b border-border/30 pb-2 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase transition-colors hover:text-foreground">
            <span className="text-muted-foreground/80 transition-transform group-open/reminder:rotate-90">
              ▸
            </span>
            <AlarmClock
              className="h-3.5 w-3.5 text-[var(--neon-violet)]"
              aria-hidden
            />
            出欠の催促
            <span
              className={
                "ml-auto rounded-sm border px-1.5 py-px text-[9px] tracking-normal " +
                (!loaded
                  ? "border-border/50 text-muted-foreground/70"
                  : enabled
                    ? "border-[var(--neon-violet)]/50 bg-[var(--neon-violet)]/10 text-[var(--neon-violet)]"
                    : "border-border/50 text-muted-foreground/70")
              }
            >
              {!loaded ? "…" : enabled ? "ON" : "OFF"}
            </span>
          </h3>
        </summary>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        開催予定日の指定日数前になっても出欠が未入力の人だけを、まとめて
        Discord でメンションします。<strong>既定は OFF</strong> で、ON に
        するまで 1 通も送りません。
      </p>

      {/* ON/OFF */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-xs">自動催促 (cron)</span>
          <span className="text-[10px] text-muted-foreground/80">
            {!loaded
              ? "読み込み中…"
              : enabled
                ? `ON (${settings?.leadDays ?? 1} 日前 ${settings?.hour ?? 21}:00 JST 以降に送信)`
                : "OFF (何も送りません)"}
          </span>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--neon-violet)]"
            checked={enabled}
            disabled={pending || !loaded}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label="自動催促の ON/OFF"
          />
        </label>
      </div>

      {/* 送信設定 */}
      <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2.5">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reminder-lead" className="text-[11px]">
              何日前
            </Label>
            <Input
              id="reminder-lead"
              value={leadDraft}
              inputMode="numeric"
              onChange={(e) => setLeadDraft(e.target.value)}
              className="h-7 font-mono text-[12px]"
              placeholder="1"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reminder-hour" className="text-[11px]">
              時刻 (JST)
            </Label>
            <Input
              id="reminder-hour"
              value={hourDraft}
              inputMode="numeric"
              onChange={(e) => setHourDraft(e.target.value)}
              className="h-7 font-mono text-[12px]"
              placeholder="21"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reminder-channel" className="text-[11px]">
              チャンネル ID
            </Label>
            <Input
              id="reminder-channel"
              value={channelDraft}
              onChange={(e) => setChannelDraft(e.target.value)}
              className="h-7 font-mono text-[12px]"
              placeholder="空 = 通常通知と同じ"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSaveBasics}
            disabled={pending}
            className="gap-1.5 text-[10px] tracking-normal"
          >
            <Save className="h-3 w-3" aria-hidden />
            送信設定を保存
          </Button>
        </div>
      </div>

      {/* メンバー: メンション先 ID + 除外 */}
      <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          メンション先の Discord ユーザー ID (17〜20 桁)。未設定の人は名前
          だけ本文に出ます。<strong>除外</strong>にチェックした人は催促にも
          集計にも出しません。
        </p>
        {names.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70">
            {loaded
              ? "メンバーを取得できませんでした (スケジュールの設定を確認してください)"
              : "読み込み中…"}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {names.map((name) => {
              const isExcluded = excludedDraft.includes(name);
              return (
                <li key={name} className="flex items-center gap-2">
                  <span
                    className="w-24 shrink-0 truncate text-[11px] text-foreground/85"
                    title={name}
                  >
                    {name}
                  </span>
                  <Input
                    value={mapDraft[name] ?? ""}
                    onChange={(e) =>
                      setMapDraft((m) => ({ ...m, [name]: e.target.value }))
                    }
                    placeholder="Discord ユーザー ID"
                    disabled={isExcluded}
                    spellCheck={false}
                    className="h-7 min-w-0 flex-1 font-mono text-[11px] disabled:opacity-40"
                    aria-label={`${name} の Discord ユーザー ID`}
                  />
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3 w-3 accent-rose-400"
                      checked={isExcluded}
                      onChange={(e) =>
                        setExcludedDraft((prev) =>
                          e.target.checked
                            ? [...prev, name]
                            : prev.filter((n) => n !== name),
                        )
                      }
                      aria-label={`${name} を催促から除外`}
                    />
                    除外
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSaveMembers}
            disabled={pending || names.length === 0}
            className="gap-1.5 text-[10px] tracking-normal"
          >
            <Save className="h-3 w-3" aria-hidden />
            メンション先 / 除外を保存
          </Button>
        </div>
      </div>

      {/* プレビュー + 手動送信 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPreview}
          disabled={previewing}
          className="gap-1.5 text-[10px] tracking-normal"
          title="今の設定で誰に飛ぶかを確認 (送信はしません)"
        >
          {previewing ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Eye className="h-3 w-3" aria-hidden />
          )}
          誰に飛ぶか確認
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSendNow}
          disabled={sending}
          className="gap-1.5 text-[10px] tracking-normal"
          title="ON/OFF・時刻・送信済み判定を無視して今すぐ送ります"
        >
          {sending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3 w-3" aria-hidden />
          )}
          今すぐ送信 (テスト)
        </Button>
      </div>

      {previewChecked && (
        <div className="rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-1.5 text-[11px] leading-relaxed">
          {!preview ? (
            <p className="text-muted-foreground">
              対象の開催予定がありません ({leadDraft} 日後に予定が無い、または
              スケジュールを取得できませんでした)
            </p>
          ) : (
            <>
              <p>
                <strong>{preview.rawDate}</strong> ({preview.dayOfWeek}) —
                回答済み {preview.answered}/{preview.total}
              </p>
              <p className="mt-0.5">
                催促対象 <strong>{preview.targets.length}</strong> 人:{" "}
                {preview.targets.length === 0 ? (
                  <span className="text-emerald-300">なし (全員入力済み)</span>
                ) : (
                  preview.targets.map((t, i) => (
                    <span key={t.name}>
                      {i > 0 && ", "}
                      <span
                        className={
                          t.discordUserId
                            ? "text-[var(--neon-violet)]"
                            : "text-amber-300"
                        }
                        title={
                          t.discordUserId
                            ? "メンションされます"
                            : "ID 未設定 — 名前のみ表示されます"
                        }
                      >
                        {t.name}
                      </span>
                    </span>
                  ))
                )}
              </p>
              {preview.excluded.length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  除外中: {preview.excluded.join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
      </details>
    </section>
  );
}
