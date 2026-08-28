"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import {
  initializeAllDataAction,
  type DataInitResult,
} from "@/lib/server/admin-actions";

const CONFIRM_KEYWORD = "INITIALIZE";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: DataInitResult) => void;
};

/**
 * TODO #23 (2.1): 全データ初期化の 2 段階確認ダイアログ。
 *   step1 (warn): 削除対象を明示して「次へ」/「キャンセル」
 *   step2 (type): `INITIALIZE` をテキスト入力で求め、一致時のみ実行可
 *
 * 既存の destructive UI (`window.confirm`) は 1 段階のみで誤クリック耐性
 * が低いため、本機能専用に新規実装。
 */
export function DataInitConfirmDialog({
  open,
  onOpenChange,
  onComplete,
}: Props) {
  const [step, setStep] = useState<"warn" | "type">("warn");
  const [typed, setTyped] = useState("");
  const [running, startRun] = useTransition();

  const reset = () => {
    setStep("warn");
    setTyped("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canExecute =
    step === "type" && typed === CONFIRM_KEYWORD && !running;

  const onExecute = () => {
    startRun(async () => {
      const result = await initializeAllDataAction();
      if (result.ok) {
        const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
        toast.success(`データ初期化完了 — 合計 ${total} 行削除`);
      } else {
        toast.error(`初期化失敗: ${result.reason}`);
      }
      onComplete?.(result);
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            全データ初期化
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            この操作は取り消せません。サイト全体のコンテンツが削除されます。
          </DialogDescription>
        </DialogHeader>

        {step === "warn" ? (
          <div className="flex flex-col gap-3 px-1 text-[12px] leading-relaxed">
            <p className="text-[10px] tracking-normal text-rose-300/90">
              削除対象
            </p>
            <ul className="ml-4 list-disc text-foreground/85 [&>li]:leading-snug">
              <li>
                コンテンツ + 関連 (動画 / 攻略情報 / マクロ / ウェイマーク /
                募集文 / ロット管理 / 軽減表 / BiS リンク / 週次消化)
              </li>
              <li>練習ログ (FFLogs の pull 記録 / 同期台帳 / 動画オフセット)</li>
              <li>過去スケジュール / 日付メモ / タグ</li>
              <li>
                アプリ設定 (Schedule URL / FFLogs username / Discord channel ID 等)
              </li>
            </ul>
            <p className="text-muted-foreground">
              認証情報 / FFLogs OAuth トークンは保持されます。
            </p>
            <p className="font-bold text-rose-200">
              本当にすべてのデータを初期化しますか？
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-1 text-[12px]">
            <p className="leading-relaxed">
              実行するには、下のフィールドに{" "}
              <code className="rounded-sm border border-rose-400/30 bg-rose-400/10 px-1 py-0.5 font-mono font-bold text-rose-200">
                {CONFIRM_KEYWORD}
              </code>{" "}
              と入力してください。
            </p>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="data-init-confirm-input"
                className="text-[10px] tracking-normal text-muted-foreground"
              >
                確認入力
              </Label>
              <Input
                id="data-init-confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder={CONFIRM_KEYWORD}
                disabled={running}
                className="font-mono"
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-end gap-2">
          {step === "warn" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                className="text-[11px] tracking-normal"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setStep("type")}
                className="gap-1.5 border border-rose-400/40 bg-rose-500/15 text-[11px] tracking-normal text-rose-100 hover:bg-rose-500/25"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                次へ
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={running}
                className="text-[11px] tracking-normal"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canExecute}
                onClick={onExecute}
                className="gap-1.5 border border-rose-400/60 bg-rose-500/30 text-[11px] tracking-normal text-rose-50 hover:bg-rose-500/40 disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    実行中…
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    初期化を実行
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
