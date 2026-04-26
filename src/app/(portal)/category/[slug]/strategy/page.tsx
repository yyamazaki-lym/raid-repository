import { Card } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

export const metadata = {
  title: "攻略情報",
};

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <Card className="glass flex flex-col items-center gap-4 p-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--neon-magenta)]/40 bg-background/60 text-[var(--neon-magenta)] shadow-[0_0_24px_-6px_var(--neon-magenta)]">
        <BookOpen className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-display text-foreground text-sm">Strategy Notes</p>
        <p className="text-muted-foreground text-xs">
          <code className="font-mono">{decodeURIComponent(slug)}</code> の攻略情報が
          ここに表示されます（Phase 5+）。
        </p>
      </div>
    </Card>
  );
}
