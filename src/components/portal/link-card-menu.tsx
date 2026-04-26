"use client";

import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkFormDialog } from "./link-form-dialog";
import { deleteCategoryLink } from "@/lib/category-links-client";
import type { CategoryLink } from "@/lib/supabase/types";

/**
 * Three-dot menu for a single CategoryLink: edit (opens dialog) + delete
 * (with confirm). Stops event propagation so clicking the menu doesn't also
 * trigger the parent card's link / play action.
 */
export function LinkCardMenu({ link }: { link: CategoryLink }) {
  const onDelete = async () => {
    if (!window.confirm(`「${link.title}」を削除しますか？`)) return;
    const result = await deleteCategoryLink(link.id);
    if (!result.ok) toast.error("削除失敗: " + result.reason);
    else toast.success(`「${link.title}」を削除しました`);
  };

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="リンクメニュー"
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="glass-popup min-w-40">
          <LinkFormDialog
            categoryId={link.categoryId}
            kind={link.kind}
            link={link}
            trigger={
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="flex cursor-pointer items-center gap-2"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                <span className="text-sm">編集</span>
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
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
