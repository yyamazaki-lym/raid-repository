/**
 * 練習ログ: 動画 URL / オフセット / 表示名の編集ダイアログ。
 *
 * 2026-09-07 に `logs-view.tsx` から切り出した (#20)。分割の経緯と依存の
 * 向きは `./README.md` を参照。
 */
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages } from "@/lib/i18n/client";
import {
  deleteReportVideoAction,
  setReportVideoAction,
  suggestVideoForReportAction,
} from "@/lib/server/fflogs-fights-actions";
import { clampOffsetSeconds, nudgeOffset, type VideoSyncAnchor } from "@/lib/video-sync";
import { type OffsetTarget } from "./video-link";
import { OffsetNudge, VideoSyncPanel } from "./video-sync-panel";

export function OffsetDialog({
  target,
  anchors,
  firstPullStartMs,
  onChange,
  onSaved,
}: {
  target: OffsetTarget | null;
  /** 編集中のレポートの pull (W-11 の基準候補)。時刻の昇順。 */
  anchors: VideoSyncAnchor[];
  /** 編集中のレポートの最初の pull の戦闘開始 (オフセットの基準)。 */
  firstPullStartMs: number | null;
  onChange: (v: OffsetTarget | null) => void;
  onSaved: () => void;
}) {
  const m = useMessages();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!target) return;
    const offset = Number(target.offset);
    if (!Number.isFinite(offset)) {
      toast.error(m.logsOffset.errOffset);
      return;
    }
    setBusy(true);
    const result = await setReportVideoAction({
      // id なし = このレポートに動画を 1 本追加 (2026-09-07)。
      id: target.id,
      reportCode: target.reportCode,
      videoUrl: target.videoUrl.trim() || null,
      offsetSeconds: Math.trunc(offset),
      label: target.label.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(m.logs.saveFailed(result.reason));
      return;
    }
    toast.success(m.logsOffset.toastSaved);
    onSaved();
  };

  /** 紐づけを 1 本だけ外す。pull 側のログはそのまま残る。 */
  const remove = async () => {
    if (!target?.id) return;
    setBusy(true);
    const result = await deleteReportVideoAction(target.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(m.logs.saveFailed(result.reason));
      return;
    }
    toast.success(m.logsOffset.toastDeleted);
    onSaved();
  };

  const autofill = async () => {
    if (!target) return;
    const result = await suggestVideoForReportAction(target.reportCode);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    if (!result.videoUrl) {
      toast.error(m.logsOffset.errNoVideo);
      return;
    }
    onChange({ ...target, videoUrl: result.videoUrl });
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onChange(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target?.id ? m.logsOffset.title : m.logsOffset.titleAdd}
          </DialogTitle>
          <DialogDescription>
            {m.logsOffset.descA}
            <strong>{m.logsOffset.descStrong}</strong>
            {m.logsOffset.descB}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offset-video">{m.logsOffset.videoUrlLabel}</Label>
            <div className="flex gap-1.5">
              <Input
                id="offset-video"
                value={target?.videoUrl ?? ""}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(e) =>
                  onChange(target ? { ...target, videoUrl: e.target.value } : null)
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={autofill}
                className="shrink-0 text-[11px]"
              >
                {m.logsOffset.autofill}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offset-seconds">{m.logsOffset.offsetLabel}</Label>
            <div className="flex gap-1.5">
              <Input
                id="offset-seconds"
                inputMode="numeric"
                value={target?.offset ?? "0"}
                placeholder={m.logsOffset.offsetPlaceholder}
                onChange={(e) =>
                  onChange(target ? { ...target, offset: e.target.value } : null)
                }
              />
              {/* ±1 秒 (2026-09-07 W-11)。動画で合わせたあと「開幕が
                  ちょっと早い/遅い」を数字を打ち直さずに詰められるように。 */}
              <OffsetNudge
                onNudge={(delta) => {
                  if (!target) return;
                  const base = clampOffsetSeconds(Number(target.offset));
                  onChange({ ...target, offset: String(nudgeOffset(base, delta)) });
                }}
              />
            </div>
          </div>
          {/* W-11 動画で合わせる (2026-09-07)。YouTube 以外の URL では
              パネル内に「使えない理由」だけ出る。 */}
          {target && (
            <VideoSyncPanel
              videoUrl={target.videoUrl}
              anchors={anchors}
              firstPullStartMs={firstPullStartMs}
              offsetSeconds={clampOffsetSeconds(Number(target.offset))}
              onPick={(seconds) => {
                onChange({ ...target, offset: String(seconds) });
                toast.success(m.logsOffset.syncPicked(seconds));
              }}
            />
          )}
          {/* 2026-09-07: 複数動画を並べたとき「1 本目 / 2 本目」を人が
              決められるようにする (未入力なら UI が「動画 1」と振る)。 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offset-label">{m.logsOffset.labelLabel}</Label>
            <Input
              id="offset-label"
              value={target?.label ?? ""}
              maxLength={40}
              placeholder={m.logsOffset.labelPlaceholder}
              onChange={(e) =>
                onChange(target ? { ...target, label: e.target.value } : null)
              }
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {m.logsOffset.multiHint}
          </p>
        </div>
        <DialogFooter>
          {/* 動画の紐づけ解除。レポート自体を消す「ログ削除」とは別物なので、
              取り違えないようダイアログの中 (左端) に置く。 */}
          {target?.id && (
            <Button
              type="button"
              variant="ghost"
              onClick={remove}
              disabled={busy}
              className="mr-auto text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {m.logsOffset.deleteVideo}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(null)}
            disabled={busy}
          >
            {m.common.cancel}
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? m.logs.savingDots : m.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
