"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3, Save } from "lucide-react";
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
import { setMitigationColumnLabelsAction } from "@/lib/server/categories-actions";
import type { SheetColumnDiagnostic } from "@/lib/sheet-csv";

/**
 * 軽減表の「列の見え方」設定 + 診断 (2026-08-30 実機報告
 * 「どのことを指しているのか / Type や軽減率以外は情報なし」)。
 *
 * 目的は 2 つ:
 *   1. **アプリが各列をどう解釈したかをそのまま見せる** — 出ない原因が
 *      見出しなのか値なのかを、シートを開かずに切り分けられるようにする
 *   2. **チェックボックス列に名前を付けられるようにする** — 見出しが
 *      アイコン画像の列は CSV に文字が 1 つも出ないため、自動では名前を
 *      付けようがない。ここで付けた名前でカードに表示する
 */
const ROLE_LABEL: Record<SheetColumnDiagnostic["role"], string> = {
  damage: "ダメージ",
  rate: "軽減率",
  final: "最終ダメージ",
  target: "対象",
  check: "チェック",
  text: "データ",
  empty: "空",
};

const ROLE_TONE: Record<SheetColumnDiagnostic["role"], string> = {
  damage: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  rate: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  final: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  target: "border-violet-400/40 bg-violet-400/10 text-violet-200",
  check: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  text: "border-border/50 text-muted-foreground",
  empty: "border-border/30 text-muted-foreground/60",
};

export function MitigationColumnsDialog({
  categoryId,
  gid,
  columns,
  initialLabels,
}: {
  categoryId: string;
  /** 現在表示中のシート (層) の gid。列構成が層ごとに違うため必須。 */
  gid: string;
  columns: SheetColumnDiagnostic[];
  initialLabels: Record<number, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialLabels)) out[k] = v;
    return out;
  });
  const [pending, startTransition] = useTransition();

  // 名前を付ける価値があるのはチェック列 (と、既に名前を付けた列)。
  const nameable = columns.filter(
    (c) => c.role === "check" || labels[String(c.index)],
  );

  const onSave = () => {
    startTransition(async () => {
      const r = await setMitigationColumnLabelsAction(categoryId, gid, labels);
      if (!r.ok) {
        toast.error("保存失敗: " + r.reason);
        return;
      }
      toast.success("列名を保存しました");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="各列の判定結果を確認し、チェック列に名前を付ける"
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Columns3 className="h-3 w-3" aria-hidden />
        列の設定
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        {/* 2026-08-30 実機報告「若干見切れる」: 幅を広げ、横方向は
            テーブル側だけをスクロールさせる (ダイアログ自体は横に
            はみ出さない)。 */}
        <DialogContent className="flex max-h-[85dvh] w-[min(46rem,calc(100vw-2rem))] max-w-none flex-col overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>列の設定 (このシート)</DialogTitle>
            <DialogDescription>
              このシートの各列をアプリがどう解釈したかの一覧です。
              <strong>チェック</strong>と判定された列は「その攻撃で入れる
              軽減/バフ」として扱いますが、見出しがアイコン画像だと CSV に
              文字が出ないため名前が分かりません。ここで名前を付けると
              カードに表示されます。
            </DialogDescription>
          </DialogHeader>

          {nameable.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                チェック列に名前を付ける
              </p>
              {nameable.map((c) => (
                <div key={c.index} className="flex min-w-0 items-center gap-2">
                  <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {c.letter}
                  </span>
                  <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
                    ON {c.checkedCount}
                  </span>
                  <Input
                    value={labels[String(c.index)] ?? ""}
                    onChange={(e) =>
                      setLabels((prev) => ({
                        ...prev,
                        [String(c.index)]: e.target.value,
                      }))
                    }
                    placeholder={c.header || "例: 堅陣 / 士気 / 牽制"}
                    className="h-8 min-w-0 flex-1 text-[12px]"
                    aria-label={`${c.letter} 列の名前`}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              全列の判定結果
            </p>
            <div className="max-h-[18rem] overflow-auto rounded-md border border-border/40">
              <table className="w-full min-w-[28rem] text-left text-[11px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1 font-medium">列</th>
                    <th className="px-2 py-1 font-medium">見出し</th>
                    <th className="px-2 py-1 font-medium">判定</th>
                    <th className="px-2 py-1 font-medium">中身の例</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.index} className="border-t border-border/30">
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {c.letter}
                      </td>
                      <td className="max-w-[9rem] truncate px-2 py-1">
                        {c.header || (
                          <span className="text-muted-foreground/60">
                            (アイコン等)
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={
                            "rounded-sm border px-1 py-px font-mono text-[9px] " +
                            ROLE_TONE[c.role]
                          }
                        >
                          {ROLE_LABEL[c.role]}
                          {c.role === "check" ? ` ${c.checkedCount}` : ""}
                        </span>
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-1 text-muted-foreground">
                        {c.samples.join(" / ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              閉じる
            </Button>
            <Button type="button" onClick={onSave} disabled={pending}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              {pending ? "保存中..." : "列名を保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
