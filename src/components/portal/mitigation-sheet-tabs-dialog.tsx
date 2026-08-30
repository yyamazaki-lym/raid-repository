"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setMitigationSheetTabsAction } from "@/lib/server/categories-actions";
import type { SheetTab } from "@/lib/sheet-csv";

/**
 * 軽減表の層タブ登録 (2026-08-30 実機報告
 * 「シートが一番最初のものしか参照されていない」)。
 *
 * ワークシート一覧の自動検出は、シートの公開設定と Google のマークアップに
 * 依存して当てにならない。admin が層ごとの **gid** を登録できる経路を正と
 * する。gid は Google Sheets 側で各シートのタブを開いたときの URL 末尾
 * (`#gid=123456`) をそのまま貼れば良い。URL を丸ごと貼っても抽出する。
 */
export function MitigationSheetTabsDialog({
  categoryId,
  sheetUrl,
  initialTabs,
  autoDetectedCount,
}: {
  categoryId: string;
  sheetUrl: string;
  initialTabs: SheetTab[];
  /** 手動登録が無いとき、自動検出できたタブ数 (0 or 1 なら切替不能)。 */
  autoDetectedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ label: string; gid: string }>>(
    initialTabs.length > 0
      ? initialTabs.map((t) => ({ label: t.name, gid: t.gid }))
      : [{ label: "", gid: "" }],
  );
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    // 「URL を貼った」ケースを救う: #gid=123 / ?gid=123 から数字を拾う。
    const cleaned = rows
      .map((r) => {
        const raw = r.gid.trim();
        const m = /(?:^|[#&?])gid=(\d+)/.exec(raw) ?? /^(\d+)$/.exec(raw);
        return { label: r.label.trim(), gid: m ? m[1]! : "" };
      })
      .filter((r) => r.gid !== "");
    startTransition(async () => {
      const result = await setMitigationSheetTabsAction(categoryId, cleaned);
      if (!result.ok) {
        toast.error("保存失敗: " + result.reason);
        return;
      }
      toast.success(
        cleaned.length > 0
          ? `層タブを ${cleaned.length} 件保存しました`
          : "層タブの登録を解除しました (自動検出に戻ります)",
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="層ごとのシートを登録する"
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Layers className="h-3 w-3" aria-hidden />
        {initialTabs.length > 0
          ? "層タブを編集"
          : autoDetectedCount > 1
            ? "層タブを固定する"
            : "層タブを設定"}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>層タブの設定</DialogTitle>
            <DialogDescription>
              層ごとにシート (ワークシート) を分けている場合、ここに登録すると
              カード表示の上でタブ切り替えできます。
              <strong>gid</strong> は Google Sheets
              で該当シートのタブを開いたときの URL 末尾
              <code className="mx-1 font-mono">#gid=123456</code>
              の数字です (URL を丸ごと貼っても構いません)。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={row.label}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, label: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder="表示名 (例: 4層)"
                  className="h-8 w-32 text-[12px]"
                  aria-label={`${i + 1} 番目のタブ名`}
                />
                <Input
                  value={row.gid}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, gid: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder="gid または シート URL"
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 font-mono text-[11px]"
                  aria-label={`${i + 1} 番目の gid`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label="この行を削除"
                  title="削除"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-rose-300 hover:bg-rose-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((prev) => [...prev, { label: "", gid: "" }])
              }
              className="w-fit gap-1.5 text-[11px] tracking-normal"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              行を追加
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              空にして保存すると登録を解除し、自動検出に戻します。
              {autoDetectedCount > 1 &&
                ` (現在は自動検出で ${autoDetectedCount} 件のシートを認識しています)`}
            </p>
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-[11px] text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              シートを開いて gid を確認する
            </a>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button type="button" onClick={onSave} disabled={pending}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              {pending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
