"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setNativeScheduleAutoConfirmEnabledAction,
  setNativeScheduleAutoConfirmMinAvailableAction,
} from "@/lib/server/native-schedule-actions";

/**
 * 全員入力で開催を自動確定する設定 (Tier2-8, 2026-08-30)。
 *
 * 日本の固定で定番の「○×△ を全員が入れたら開催の有無が決まる」文法
 * (調査 第3回 D-3)。既定 OFF で、ON のときだけ出欠保存のたびに条件を
 * 判定する。全員が「×」でも「全員入力済み」は成立してしまうため、
 * 参加可能人数の下限を必ず併用する。
 */
export function NativeAutoConfirmSection({
  canEdit,
  loaded,
  enabled,
  minAvailable,
  onChanged,
}: {
  canEdit: boolean;
  loaded: boolean;
  enabled: boolean;
  minAvailable: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [minDraft, setMinDraft] = useState(minAvailable);
  // prop が更新されたら draft を追従させる。effect で setState すると
  // カスケードレンダーになる (react-hooks/set-state-in-effect) ため、
  // React 公式の「レンダー中に前回 prop と比べて調整する」形にする。
  const [syncedMin, setSyncedMin] = useState(minAvailable);
  if (loaded && minAvailable !== syncedMin) {
    setSyncedMin(minAvailable);
    setMinDraft(minAvailable);
  }

  if (!canEdit) return null;

  const onToggle = (next: boolean) => {
    if (next === enabled) return;
    startTransition(async () => {
      const r = await setNativeScheduleAutoConfirmEnabledAction(next);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        next ? "自動確定を ON にしました" : "自動確定を OFF にしました",
      );
      onChanged();
      router.refresh();
    });
  };

  const onSaveMin = () => {
    const n = Number.parseInt(minDraft, 10);
    startTransition(async () => {
      const r = await setNativeScheduleAutoConfirmMinAvailableAction(n);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success("必要人数を保存しました");
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <CheckCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          全員入力で自動確定
        </span>
      </header>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        候補日にアクティブメンバー全員が出欠を入れ、参加可能な人数が下の
        人数以上になったとき、その候補日を自動で<strong>確定</strong>に
        切り替えます。既定は OFF です。
      </p>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2">
        <span className="text-xs">
          自動確定
          <span className="ml-2 text-[10px] text-muted-foreground/80">
            {!loaded ? "読み込み中…" : enabled ? "ON" : "OFF"}
          </span>
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-emerald-400"
          checked={enabled}
          disabled={pending || !loaded}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label="全員入力での自動確定 ON/OFF"
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="auto-confirm-min"
            className="text-[11px] text-foreground/80"
          >
            必要な参加可能人数
          </label>
          <Input
            id="auto-confirm-min"
            value={minDraft}
            inputMode="numeric"
            onChange={(e) => setMinDraft(e.target.value)}
            className="h-7 w-24 font-mono text-[12px]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSaveMin}
          disabled={pending || minDraft === minAvailable}
          className="gap-1.5 text-[10px] tracking-normal"
        >
          <Save className="h-3 w-3" aria-hidden />
          保存
        </Button>
      </div>
    </section>
  );
}
