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
import { useMessages } from "@/lib/i18n/client";

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
  const m = useMessages();
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
        toast.error(m.crud.saveFailed(result.reason));
        return;
      }
      toast.success(
        cleaned.length > 0
          ? m.mitigationTabs.savedN(cleaned.length)
          : m.mitigationTabs.cleared,
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
        title={m.mitigationTabs.triggerTitle}
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Layers className="h-3 w-3" aria-hidden />
        {initialTabs.length > 0
          ? m.mitigationTabs.triggerEdit
          : autoDetectedCount > 1
            ? m.mitigationTabs.triggerPin
            : m.mitigationTabs.triggerSet}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{m.mitigationTabs.dialogTitle}</DialogTitle>
            <DialogDescription>
              {m.mitigationTabs.descA}
              <strong>{m.mitigationTabs.descStrong}</strong>
              {m.mitigationTabs.descB}
              <code className="mx-1 font-mono">{m.mitigationTabs.descCode}</code>
              {m.mitigationTabs.descC}
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
                  placeholder={m.mitigationTabs.labelPlaceholder}
                  className="h-8 w-32 text-[12px]"
                  aria-label={m.mitigationTabs.labelAria(i + 1)}
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
                  placeholder={m.mitigationTabs.gidPlaceholder}
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 font-mono text-[11px]"
                  aria-label={m.mitigationTabs.gidAria(i + 1)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label={m.mitigationTabs.removeRowAria}
                  title={m.common.delete}
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
              {m.mitigationTabs.addRow}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {m.mitigationTabs.clearHint}
              {autoDetectedCount > 1 &&
                m.mitigationTabs.autoDetectedNote(autoDetectedCount)}
            </p>
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-[11px] text-[var(--neon-cyan)] underline underline-offset-2 hover:text-foreground"
            >
              {m.mitigationTabs.openSheet}
            </a>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {m.common.cancel}
            </Button>
            <Button type="button" onClick={onSave} disabled={pending}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              {pending ? m.crud.savingDots : m.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
