"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Save, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { setNativeScheduleChoiceValuesAction } from "@/lib/server/native-schedule-actions";
import { useConfirm } from "@/components/portal/confirm-dialog";

/**
 * TODO #2 phase 2-C (2026-05-07): native スケジュール凡例 (choice values)
 * 編集 section。
 *
 * - CSV textarea (1 行、Input で十分) で「○,×,△,⏰,－」のような記号列を編集
 * - 保存 → setNativeScheduleChoiceValuesAction(csv)、空保存または「既定値に
 *   戻す」 で fallback (`["○","×","△","⏰","－"]`) に戻る
 * - 入力中に live preview chip 列を描画 (split → trim → filter → map)
 *
 * `parseCsv` は `native-fetch.ts#parseChoiceValues` と同じ split 仕様
 * (split + trim + filter Boolean) で揃える。同じ helper を 2 箇所に書く
 * 重複は許容 (server-only / client 境界跨ぎを避けるため)。
 */

const DEFAULT_CHOICES = ["○", "×", "△", "⏰", "－"];

function parseCsv(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function NativeChoiceValuesSection({
  canEdit,
  currentChoiceCsv,
  loaded,
  onChanged,
}: {
  canEdit: boolean;
  currentChoiceCsv: string | null;
  loaded: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  // 親からの最新値で draft を同期 (CRUD 後の reload も含む)。
  useEffect(() => {
    if (loaded) setDraft(currentChoiceCsv ?? "");
  }, [currentChoiceCsv, loaded]);

  const persisted = currentChoiceCsv ?? "";
  const dirty = draft !== persisted;
  const previewItems = parseCsv(draft);
  const usingFallback = previewItems.length === 0;

  const onSave = () => {
    startTransition(async () => {
      const r = await setNativeScheduleChoiceValuesAction(draft);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        draft.trim()
          ? `凡例を保存しました (${previewItems.length} 項目)`
          : "凡例を既定値に戻しました",
      );
      onChanged();
      router.refresh();
    });
  };

  const onReset = async () => {
    if (
      !(await confirm({
        title: "凡例を既定値に戻す",
        description: "凡例を既定値 (○,×,△,⏰,－) に戻します。よろしいですか？",
        confirmText: "戻す",
      }))
    )
      return;
    setDraft("");
    startTransition(async () => {
      const r = await setNativeScheduleChoiceValuesAction("");
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success("凡例を既定値に戻しました");
      onChanged();
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2 border-b border-border/30 pb-2">
        <ListChecks
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
        <span className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
          Native Schedule Choice Values
        </span>
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        スケジュール表の出欠列で選べる凡例。CSV 形式 (カンマ区切り) で記号を並べます。空のまま保存すると既定値 (○, ×, △, ⏰, －) に戻ります。
      </p>

      <div className="flex flex-col gap-2">
        <Input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canEdit || !loaded || pending}
          placeholder="○,×,△,⏰,－"
          className="h-7 text-xs"
        />

        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/30 bg-secondary/20 px-2.5 py-2">
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70 uppercase">
            Preview
          </span>
          {(usingFallback ? DEFAULT_CHOICES : previewItems).map((c, i) => (
            <span
              key={`${c}-${i}`}
              className={
                "inline-flex h-6 max-w-[7rem] min-w-[1.5rem] items-center justify-center truncate rounded border px-1.5 text-xs whitespace-nowrap " +
                (usingFallback
                  ? "border-border/30 text-muted-foreground/70 italic"
                  : "border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/5 text-foreground")
              }
            >
              {c}
            </span>
          ))}
          {usingFallback && (
            <span className="text-[9px] text-muted-foreground/60">
              (既定値)
            </span>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-1.5">
            {persisted && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={onReset}
                className="h-7 gap-1 px-2 text-[10px] tracking-normal"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                既定値に戻す
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={!loaded || pending || !dirty}
              onClick={onSave}
              className="h-7 gap-1 px-3 text-[10px] tracking-normal"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3 w-3" aria-hidden />
              )}
              保存
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
