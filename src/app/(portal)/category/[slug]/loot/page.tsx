import { Card } from "@/components/ui/card";
import { Dice5 } from "lucide-react";

export const metadata = {
  title: "ロット管理",
};

export default async function LootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <Card className="glass flex flex-col items-center gap-4 p-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--neon-violet)]/40 bg-background/60 text-[var(--neon-violet)] shadow-[0_0_24px_-6px_var(--neon-violet)]">
        <Dice5 className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-display text-foreground text-sm">Loot Management</p>
        <p className="text-muted-foreground text-xs">
          <code className="font-mono">{decodeURIComponent(slug)}</code> のロット表が
          ここに表示されます（Phase 4）。
        </p>
      </div>
    </Card>
  );
}
