"use client";

import { Ban, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addDiscordLinkBlocklist,
  deleteCategoryLink,
} from "@/lib/category-links-client";
import { useConfirm } from "@/components/portal/confirm-dialog";
import type { CategoryLink } from "@/lib/supabase/types";

/**
 * Three-dot menu for a single CategoryLink. Stateless w.r.t. the edit
 * dialog — `onEdit` is provided by the list component which owns the
 * shared dialog (lifted to avoid the menu↔dialog focus collision that
 * caused the dialog to auto-close).
 */
export function LinkCardMenu({
  link,
  onEdit,
}: {
  link: CategoryLink;
  onEdit: () => void;
}) {
  const confirm = useConfirm();
  const onDelete = async () => {
    const ok = await confirm({
      title: `「${link.title}」を削除しますか？`,
      confirmText: "削除",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryLink(link.id);
    if (!result.ok) {
      toast.error("削除失敗: " + result.reason);
      return;
    }
    toast.success(`「${link.title}」を削除しました`);
    // 行の消失は `useRealtimeCategoryLinks` の DELETE handler が拾うので
    // `router.refresh()` は不要。むしろ refresh は RSC 再描画でスクロール
    // 位置が頭に戻る挙動を引き起こすため意図的に呼ばない (TODO #49)。
  };

  // Discord 取り込み分のみ「今後取り込まない」(除外リスト登録 + リンク削除)。
  // 削除だけだと Discord メッセージが残る限り次回 cron で復活するため
  // (discord-import の dedup は URL の在不在しか見ない)、除外登録で恒久化する。
  const onExclude = async () => {
    const ok = await confirm({
      title: `「${link.title}」を今後取り込まないようにしますか？`,
      description:
        "このリンクを削除し、Discord 自動取り込みでも今後この URL を取り込みません。コンテンツ編集ダイアログの「除外 URL」から解除できます。",
      confirmText: "除外",
      destructive: true,
    });
    if (!ok) return;
    const result = await addDiscordLinkBlocklist(link.categoryId, link.url);
    if (!result.ok) {
      toast.error("除外失敗: " + result.reason);
      return;
    }
    toast.success(`「${link.title}」を除外しました（今後取り込まれません）`);
  };

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
          aria-label="リンクメニュー"
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="glass-popup min-w-40">
          <DropdownMenuItem
            onClick={onEdit}
            className="flex cursor-pointer items-center gap-2"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">編集</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {link.source === "discord" && (
            <DropdownMenuItem
              onClick={onExclude}
              className="flex cursor-pointer items-center gap-2 text-amber-300 focus:text-amber-200"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden />
              <span className="text-sm">今後取り込まない</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onDelete}
            className="flex cursor-pointer items-center gap-2 text-rose-300 focus:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">削除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
