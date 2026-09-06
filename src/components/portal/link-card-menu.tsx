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
import { useMessages } from "@/lib/i18n/client";

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
  const m = useMessages();
  const onDelete = async () => {
    const ok = await confirm({
      title: m.crud.deleteConfirmTitle(link.title),
      confirmText: m.common.delete,
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteCategoryLink(link.id);
    if (!result.ok) {
      toast.error(m.crud.deleteFailed(result.reason));
      return;
    }
    toast.success(m.linkMenu.deleted(link.title));
    // 行の消失は `useRealtimeCategoryLinks` の DELETE handler が拾うので
    // `router.refresh()` は不要。むしろ refresh は RSC 再描画でスクロール
    // 位置が頭に戻る挙動を引き起こすため意図的に呼ばない (TODO #49)。
  };

  // Discord 取り込み分のみ「今後取り込まない」(除外リスト登録 + リンク削除)。
  // 削除だけだと Discord メッセージが残る限り次回 cron で復活するため
  // (discord-import の dedup は URL の在不在しか見ない)、除外登録で恒久化する。
  const onExclude = async () => {
    const ok = await confirm({
      title: m.linkMenu.excludeTitle(link.title),
      description: m.linkMenu.excludeDesc,
      confirmText: m.linkMenu.excludeConfirm,
      destructive: true,
    });
    if (!ok) return;
    const result = await addDiscordLinkBlocklist(link.categoryId, link.url);
    if (!result.ok) {
      toast.error(m.linkMenu.excludeFailed(result.reason));
      return;
    }
    toast.success(m.linkMenu.excluded(link.title));
  };

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
          aria-label={m.linkMenu.menuAria}
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="glass-popup min-w-40">
          <DropdownMenuItem
            onClick={onEdit}
            className="flex cursor-pointer items-center gap-2"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">{m.common.edit}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {link.source === "discord" && (
            <DropdownMenuItem
              onClick={onExclude}
              className="flex cursor-pointer items-center gap-2 text-amber-300 focus:text-amber-200"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden />
              <span className="text-sm">{m.linkMenu.exclude}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onDelete}
            className="flex cursor-pointer items-center gap-2 text-rose-300 focus:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="text-sm">{m.common.delete}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
