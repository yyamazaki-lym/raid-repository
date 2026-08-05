"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Save, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  setNativeScheduleDiscordNotifyEnabledAction,
  setNativeScheduleDiscordNotifyChannelIdAction,
  setNativeScheduleDiscordNotifyRoleIdAction,
  setNativeScheduleDiscordNotifyHourAction,
  setNativeScheduleDiscordNotifyTemplateAction,
  setNativeScheduleDiscordNotifyOnDecisionAction,
} from "@/lib/server/native-schedule-actions";
import { NATIVE_DISCORD_DEFAULT_TEMPLATE } from "@/lib/schedule/native-discord-template";

/**
 * TODO #2 phase 3 + phase 4 (2026-05-08): native スケジュール Discord 通知設定。
 *
 * 3 controls:
 *   1. ON/OFF toggle (cron 自動通知の有効/無効、default = 有効)
 *   2. 通知先 channel ID (空なら通知不能、Discord 17–20 桁 ID)
 *   3. mention 対象 role ID (空なら mention prefix 省略、Discord 17–20 桁 ID)
 *
 * 即時保存パターンは phase 2-C 凡例 section と同じ (`useTransition` + toast +
 * `onChanged()` + `router.refresh()`)。`mode==='native'` 時のみ mount される。
 */

const DISCORD_ID_RE = /^\d{17,20}$/;

export function NativeDiscordNotifySection({
  canEdit,
  loaded,
  enabled,
  channelId,
  roleId,
  hour,
  template,
  onDecision,
  onChanged,
}: {
  canEdit: boolean;
  loaded: boolean;
  enabled: boolean;
  channelId: string | null;
  roleId: string | null;
  hour: string;
  /** PR3-A: 通知 template (null = 未設定 → hardcode default 利用)。 */
  template: string | null;
  /** PR3-B: 確定 (DECISION) 切替時の自動通知 ON/OFF。 */
  onDecision: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channelDraft, setChannelDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");

  useEffect(() => {
    if (loaded) {
      setChannelDraft(channelId ?? "");
      setRoleDraft(roleId ?? "");
      setTemplateDraft(template ?? "");
    }
  }, [channelId, roleId, template, loaded]);

  const channelDirty = channelDraft !== (channelId ?? "");
  const roleDirty = roleDraft !== (roleId ?? "");
  const templateDirty = templateDraft !== (template ?? "");

  const onToggleOnDecision = (next: boolean) => {
    if (next === onDecision) return;
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyOnDecisionAction(next);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        next
          ? "確定時の自動通知を ON にしました"
          : "確定時の自動通知を OFF にしました",
      );
      onChanged();
      router.refresh();
    });
  };

  const onSaveTemplate = () => {
    const trimmed = templateDraft;
    if (trimmed.length > 4000) {
      toast.error("テンプレートは 4000 文字以内で入力してください");
      return;
    }
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyTemplateAction(trimmed);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        trimmed.trim()
          ? "通知テンプレートを保存しました"
          : "通知テンプレートを削除しました (既定に戻りました)",
      );
      onChanged();
      router.refresh();
    });
  };

  const onResetTemplateToDefault = () => {
    setTemplateDraft(NATIVE_DISCORD_DEFAULT_TEMPLATE);
  };

  const onClearTemplate = () => {
    setTemplateDraft("");
  };

  const onChangeHour = (next: string) => {
    if (next === hour) return;
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyHourAction(next);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(`通知時刻を ${next}:00 JST に変更しました`);
      onChanged();
      router.refresh();
    });
  };

  const onToggle = (next: boolean) => {
    if (next === enabled) return;
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyEnabledAction(next);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        next
          ? "当日昼の自動通知を ON にしました"
          : "当日昼の自動通知を OFF にしました",
      );
      onChanged();
      router.refresh();
    });
  };

  const onSaveChannel = () => {
    const trimmed = channelDraft.trim();
    if (trimmed && !DISCORD_ID_RE.test(trimmed)) {
      toast.error("Channel ID は 17〜20 桁の数字です");
      return;
    }
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyChannelIdAction(trimmed);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        trimmed ? "通知先 channel ID を保存しました" : "通知先 channel ID を削除しました",
      );
      onChanged();
      router.refresh();
    });
  };

  const onSaveRole = () => {
    const trimmed = roleDraft.trim();
    if (trimmed && !DISCORD_ID_RE.test(trimmed)) {
      toast.error("Role ID は 17〜20 桁の数字です");
      return;
    }
    startTransition(async () => {
      const r = await setNativeScheduleDiscordNotifyRoleIdAction(trimmed);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        trimmed
          ? "mention 対象 role ID を保存しました"
          : "mention 対象 role ID を削除しました (mention なし平文に切替)",
      );
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <Bell className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Schedule Discord Notify
        </span>
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        当日の指定時刻 (JST) に自動で「本日の固定活動予定日です」を Discord に投稿します。
        手動 button (確定列の Bell icon) は ON/OFF と無関係に常時動作します。
      </p>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-secondary/20 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">当日の自動通知</span>
          <span className="text-[9px] text-muted-foreground/60">
            {enabled ? `ON (${String(parseInt(hour, 10)).padStart(2, "0")}:00 JST cron が動作)` : "OFF (cron 停止)"}
          </span>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit || !loaded || pending}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-[var(--neon-cyan)]"
          />
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            {enabled ? "ON" : "OFF"}
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-secondary/20 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">通知時刻 (JST)</span>
          <span className="text-[9px] text-muted-foreground/60">
            毎時 cron が発火し、選択時刻のみ Discord に投稿
          </span>
        </div>
        <select
          value={hour}
          disabled={!canEdit || !loaded || pending}
          onChange={(e) => onChangeHour(e.target.value)}
          className="h-7 rounded-md border border-border/40 bg-background px-2 font-mono text-xs"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={String(i)}>
              {String(i).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] tracking-normal text-muted-foreground">
          通知先 Channel ID
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            value={channelDraft}
            onChange={(e) => setChannelDraft(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            placeholder="123456789012345678"
            className="h-7 text-xs font-mono"
            inputMode="numeric"
          />
          {canEdit && (
            <Button
              type="button"
              size="sm"
              disabled={!loaded || pending || !channelDirty}
              onClick={onSaveChannel}
              className="h-7 gap-1 px-3 text-[10px] tracking-normal"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3 w-3" aria-hidden />
              )}
              保存
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] tracking-normal text-muted-foreground">
          mention 対象 Role ID（任意）
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value)}
            disabled={!canEdit || !loaded || pending}
            placeholder="123456789012345678 (空なら mention なし)"
            className="h-7 text-xs font-mono"
            inputMode="numeric"
          />
          {canEdit && (
            <Button
              type="button"
              size="sm"
              disabled={!loaded || pending || !roleDirty}
              onClick={onSaveRole}
              className="h-7 gap-1 px-3 text-[10px] tracking-normal"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3 w-3" aria-hidden />
              )}
              保存
            </Button>
          )}
        </div>
      </div>

      {/* 2.1 (2026-05-12) PR3-B: 確定 (DECISION) 切替時の自動通知 ON/OFF。 */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-secondary/20 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs">確定時に自動通知</span>
          <span className="text-[9px] text-muted-foreground/60">
            開催日を「確定」に切り替えた瞬間に 1 回だけ Discord 投稿 (同セッションの再送は last_notified_at で抑止)
          </span>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={onDecision}
            disabled={!canEdit || !loaded || pending}
            onChange={(e) => onToggleOnDecision(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-[var(--neon-cyan)]"
          />
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            {onDecision ? "ON" : "OFF"}
          </span>
        </label>
      </div>

      {/* 2.1 (2026-05-12) PR3-A: 通知 message template 編集。空文字列で保存すると
          DB から DELETE され、buildMessage は hardcode default に戻る。 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] tracking-normal text-muted-foreground">
          通知メッセージテンプレート（任意）
        </label>
        <Textarea
          value={templateDraft}
          onChange={(e) => setTemplateDraft(e.target.value)}
          disabled={!canEdit || !loaded || pending}
          placeholder={NATIVE_DISCORD_DEFAULT_TEMPLATE}
          rows={10}
          className="text-xs font-mono"
          spellCheck={false}
          maxLength={4000}
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">
          利用可能な placeholder:
          <code className="ml-1 font-mono">{`{mention}`}</code>,
          <code className="ml-1 font-mono">{`{date}`}</code>,
          <code className="ml-1 font-mono">{`{day}`}</code>,
          <code className="ml-1 font-mono">{`{time_start}`}</code>,
          <code className="ml-1 font-mono">{`{time_end}`}</code>,
          <code className="ml-1 font-mono">{`{note}`}</code>,
          <code className="ml-1 font-mono">{`{note_block}`}</code>,
          <code className="ml-1 font-mono">{`{attendance}`}</code>,
          <code className="ml-1 font-mono">{`{site_url}`}</code>
          <br />
          空欄で保存すると既定 (現行の hardcode フォーマット) に戻ります。
          <code className="font-mono">{`{note_block}`}</code> は note 有無で
          自動的に行ごと出現/省略します。
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!loaded || pending}
                onClick={onResetTemplateToDefault}
                className="h-7 gap-1 px-2 text-[10px] tracking-normal"
                title="既定テンプレートを textarea に流し込む (保存はまだしない)"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                既定を流し込む
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!loaded || pending || !templateDraft}
                onClick={onClearTemplate}
                className="h-7 px-2 text-[10px] tracking-normal"
                title="textarea をクリア (保存すると DB から削除、既定に戻る)"
              >
                クリア
              </Button>
              <div className="flex-1" />
              <Button
                type="button"
                size="sm"
                disabled={!loaded || pending || !templateDirty}
                onClick={onSaveTemplate}
                className="h-7 gap-1 px-3 text-[10px] tracking-normal"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3 w-3" aria-hidden />
                )}
                保存
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
