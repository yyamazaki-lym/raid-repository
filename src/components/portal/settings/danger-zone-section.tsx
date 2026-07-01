"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/portal/confirm-dialog";
import type { DataInitResult } from "@/lib/server/admin-actions";
import { clearAllFflogsLinks } from "@/lib/server/categories-actions";
import { DataInitConfirmDialog } from "../data-init-confirm-dialog";

/**
 * TODO #66 (2026-05-02): settings-dialog.tsx 分割の一部。
 * 全データ初期化 (TODO #23 で導入) — admin 限定で settings dialog 末尾
 * に隔離配置。誤操作防止のため 2 段階確認 dialog (warn → INITIALIZE
 * 入力) を必須にしている。
 *
 * 2026-07-01: 破壊的リセット操作を 1 箇所へ集約する要望に合わせ、
 * FflogsSyncSection にあった「全 logs URL クリア」もここへ移設
 * (全データ初期化ほど破壊的ではないので上段に軽めの扱いで配置)。
 * さらに誤操作防止のため、セクション全体を折りたたみ (native <details>、
 * 既定は畳んだ状態) にして FFLogs OAuth / Session Cookie 節と流儀を揃える。
 *
 * onComplete は親 (settings-dialog) が ok 時に dialog 自体を閉じて
 * router.refresh() を発火するため。
 */
export function DangerZoneSection({
  onComplete,
}: {
  onComplete: (result: DataInitResult) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [showDataInitDialog, setShowDataInitDialog] = useState(false);
  const [clearingLogs, startClearLogs] = useTransition();

  return (
    <>
      <section>
        <details className="group/danger flex flex-col gap-3">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h3 className="flex items-center gap-2 border-b border-border/30 pb-2 font-mono text-[10px] tracking-[0.22em] text-rose-300 uppercase transition-colors hover:text-rose-200">
              <span className="text-rose-300/80 transition-transform group-open/danger:rotate-90">
                ▸
              </span>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Danger Zone
            </h3>
          </summary>

          {/* 全 logs URL クリア — FflogsSyncSection から集約 (2026-07-01)。
              全データ初期化ほど破壊的ではないので outline ボタンで軽めに。 */}
          <div className="flex flex-col gap-2.5 rounded-md border border-rose-400/30 bg-rose-400/5 p-3">
            <p className="text-[12px] leading-relaxed text-rose-100/90">
              動画 / 過去予定に紐づいた FFLogs レポート URL をすべて削除します
              （自動紐づけ + 手動紐づけの両方が対象）。過去の誤紐づけを
              リセットしたいときに使います。
            </p>
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await confirm({
                    title: "全ての logs URL をクリアしますか？",
                    description:
                      "動画 / 過去予定の自動紐づけ + 手動紐づけの両方が対象です。",
                    confirmText: "クリア",
                    destructive: true,
                  });
                  if (!ok) return;
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
                className="gap-1.5 text-[11px] tracking-normal text-rose-200"
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
          </div>

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
                className="gap-1.5 border border-rose-400/50 bg-rose-500/20 text-[11px] tracking-normal text-rose-100 hover:bg-rose-500/30"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                全データ初期化
              </Button>
            </div>
          </div>
        </details>
      </section>
      <DataInitConfirmDialog
        open={showDataInitDialog}
        onOpenChange={setShowDataInitDialog}
        onComplete={onComplete}
      />
    </>
  );
}
