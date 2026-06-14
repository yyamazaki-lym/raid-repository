"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2Off } from "lucide-react";
import { toast } from "sonner";
import { updateCategory } from "@/lib/categories-client";
import { useConfirm } from "@/components/portal/confirm-dialog";

type Kind = "mitigation" | "loot";

const KIND_LABEL: Record<Kind, string> = {
  mitigation: "軽減表",
  loot: "ロット管理",
};

const KIND_COLUMN: Record<Kind, "mitigation_sheet_url" | "loot_sheet_url"> = {
  mitigation: "mitigation_sheet_url",
  loot: "loot_sheet_url",
};

/**
 * 軽減表 / ロット管理ページのスプレッドシート紐付けを解除する
 * ボタン (TODO #31)。実体は `categories.{mitigation_sheet_url,
 * loot_sheet_url}` を NULL にするだけ。解除後はページが
 * `SheetUrlOnboarding` (URL 未設定時の登録 form) に戻る。
 *
 * Admin gate は呼び出し側で `canEdit` 判定済み前提 — このボタンは
 * 表示された時点で「クリックして良い」UI として扱う。`updateCategory`
 * は server action 経由で `assertAdminResult()` も走るので二重防御。
 */
export function SheetUrlUnlinkButton({
  categoryId,
  kind,
}: {
  categoryId: string;
  kind: Kind;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const label = KIND_LABEL[kind];

  const onClick = async () => {
    const confirmed = await confirm({
      title: `${label}のスプレッドシート紐付けを解除しますか?`,
      description: `表示中の URL は ${label}カードから消え、再登録するまで未設定状態に戻ります。スプレッドシート自体は削除されません。`,
      confirmText: "解除",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    const result = await updateCategory(categoryId, {
      [KIND_COLUMN[kind]]: null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error("解除失敗: " + result.reason);
      return;
    }
    toast.success(`${label}の紐付けを解除しました`);
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`${label}のスプレッドシート紐付けを解除 (URL を消去)`}
      aria-label={`${label}のスプレッドシート紐付けを解除`}
      className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/40 bg-rose-500/5 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-rose-300 uppercase transition-colors hover:border-rose-300/60 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
    >
      <Link2Off className="h-3.5 w-3.5" aria-hidden />
      {busy ? "解除中..." : "紐付け解除"}
    </button>
  );
}
