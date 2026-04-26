"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dice5,
  ShieldHalf,
  Save,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCategory } from "@/lib/categories-client";

type Kind = "mitigation" | "loot";

const KIND_LABEL: Record<Kind, string> = {
  mitigation: "軽減表",
  loot: "ロット管理",
};

const KIND_ICON: Record<Kind, LucideIcon> = {
  mitigation: ShieldHalf,
  loot: Dice5,
};

const KIND_COLUMN: Record<Kind, "mitigation_sheet_url" | "loot_sheet_url"> = {
  mitigation: "mitigation_sheet_url",
  loot: "loot_sheet_url",
};

/**
 * Inline URL register form shown on the mitigation / loot sub-tab when no
 * sheet URL is set on the parent category. Avoids forcing users to detour
 * through the category edit dialog.
 */
export function SheetUrlOnboarding({
  categoryId,
  categoryName,
  kind,
}: {
  categoryId: string;
  categoryName: string;
  kind: Kind;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = KIND_ICON[kind];
  const label = KIND_LABEL[kind];

  const onSave = async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return setError("URLを入力してください");
    if (!/^https?:\/\//i.test(trimmed))
      return setError("http:// または https:// で始めてください");
    try {
      new URL(trimmed);
    } catch {
      return setError("URLの形式が正しくありません");
    }

    setBusy(true);
    const result = await updateCategory(categoryId, {
      [KIND_COLUMN[kind]]: trimmed,
    });
    setBusy(false);
    if (!result.ok) {
      setError("保存失敗: " + result.reason);
      return;
    }
    toast.success(`${label}URLを登録しました`);
    router.refresh();
  };

  return (
    <Card className="glass flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-base tracking-[0.16em] uppercase">
            {label} 未設定
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            「{categoryName}」の{label}スプレッドシートURLを登録すると、
            このページに埋め込み表示されます。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`sheet-url-${kind}`}
            className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase"
          >
            {label} URL
          </Label>
          <Input
            id={`sheet-url-${kind}`}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/.../pubhtml"
            className="font-mono text-[12px]"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Google Sheets の「ウェブに公開」/「埋め込み」URLか、共有URLを指定してください。
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
              aria-hidden
            />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : "URL を登録"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
