"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2Off } from "lucide-react";
import { toast } from "sonner";
import { updateCategory } from "@/lib/categories-client";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useMessages } from "@/lib/i18n/client";

type Kind = "mitigation" | "loot";

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
  const m = useMessages();
  const [busy, setBusy] = useState(false);
  const label = m.sheet.kindLabel[kind];

  const onClick = async () => {
    const confirmed = await confirm({
      title: m.sheet.unlinkConfirmTitle(label),
      description: m.sheet.unlinkConfirmDescription(label),
      confirmText: m.sheet.unlinkConfirm,
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    const result = await updateCategory(categoryId, {
      [KIND_COLUMN[kind]]: null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(m.sheet.unlinkFailed(result.reason));
      return;
    }
    toast.success(m.sheet.unlinkDone(label));
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={m.sheet.unlinkTitle(label)}
      aria-label={m.sheet.unlinkAria(label)}
      className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/40 bg-rose-500/5 px-3 py-1.5 text-[11px] tracking-normal text-rose-300 transition-colors hover:border-rose-300/60 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
    >
      <Link2Off className="h-3.5 w-3.5" aria-hidden />
      {busy ? m.sheet.unlinking : m.sheet.unlink}
    </button>
  );
}
