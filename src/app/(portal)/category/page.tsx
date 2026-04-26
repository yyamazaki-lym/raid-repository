import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLACEHOLDER_CATEGORIES } from "@/lib/placeholder-categories";
import { CategoryList } from "./category-list";

export const metadata = {
  title: "カテゴリー",
};

export default function CategoryIndexPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-foreground sm:text-2xl">
            Categories
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            レイドコンテンツ単位で、ロット・軽減・攻略情報を切り替えます。
          </p>
        </div>
        <Button
          disabled
          variant="outline"
          className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          カテゴリー追加
        </Button>
      </div>

      <CategoryList categories={PLACEHOLDER_CATEGORIES} />
    </div>
  );
}
