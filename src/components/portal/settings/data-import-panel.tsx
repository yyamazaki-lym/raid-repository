"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useMessages } from "@/lib/i18n/client";
import { jstDateTimeString } from "@/lib/jst-date";
import {
  IMPORT_PART_ORDER,
  chunkByCount,
  chunkRowsBySize,
  parseExportFile,
  pickKey,
  type ParsedImport,
} from "@/lib/data-import";
import {
  applyImportBatchAction,
  countExistingImportRowsAction,
} from "@/lib/server/data-import-actions";

type Counts = Record<string, { total: number; existing: number }>;
type Results = Record<string, { written: number; failedBatches: number; reason?: string }>;

/**
 * 書き出したデータの取り込み直し (2026-10-05、監査 F-3 の残り)。admin のみ
 * (親の `DataExportSection` が admin 以外に出さない。Server Action も admin を
 * 確かめる)。
 *
 * ユーザー決定: **上書き** (主キーが同じ行は上書き、無い行は足す、ファイルに
 * 無い行は消さない) + **確認画面あり**。流れは「ファイルを選ぶ → 件数を確認
 * (追加 / 上書き。書き込まない) → 確認ダイアログ → 取り込み → 結果」。
 * 作りの理由は `src/lib/data-import.ts`。
 */
export function DataImportPanel() {
  const m = useMessages();
  const t = m.dataImport;
  const router = useRouter();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState<null | "reading" | "checking" | "importing">(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = () => {
    setParsed(null);
    setCounts(null);
    setResults(null);
    setProgress(null);
  };

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    setBusy("reading");
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast.error(t.invalidJson);
        return;
      }
      const r = parseExportFile(data);
      if (!r.ok) {
        toast.error(t.invalidFile(r.reason));
        return;
      }
      setParsed(r.value);
    } finally {
      setBusy(null);
    }
  };

  /** 確認: 主キーだけを送り、既にある行 (= 上書き) を数える。書き込まない。 */
  const onCheck = async () => {
    if (!parsed) return;
    setBusy("checking");
    setResults(null);
    const next: Counts = {};
    const batches = parsed.tables.flatMap((tb) =>
      chunkByCount(tb.rows.map((r) => pickKey(r, tb.keyColumns))).map((keys) => ({ tb, keys })),
    );
    setProgress({ done: 0, total: batches.length });
    try {
      for (const tb of parsed.tables) next[tb.table] = { total: tb.rows.length, existing: 0 };
      let done = 0;
      for (const { tb, keys } of batches) {
        const r = await countExistingImportRowsAction({ part: parsed.part, table: tb.table, keys });
        if (!r.ok) {
          toast.error(t.checkFailed(tb.table, r.reason));
          return;
        }
        next[tb.table]!.existing += r.existing;
        done += 1;
        setProgress({ done, total: batches.length });
      }
      setCounts(next);
    } finally {
      setBusy(null);
    }
  };

  /** 取り込み: 確認ダイアログのあと、塊ごとに主キーで上書きする。 */
  const onImport = async () => {
    if (!parsed || !counts) return;
    const total = Object.values(counts).reduce((n, c) => n + c.total, 0);
    const existing = Object.values(counts).reduce((n, c) => n + c.existing, 0);
    const ok = await confirm({
      title: t.confirmTitle,
      description: t.confirmDescription(
        m.dataExport.partLabel(parsed.part),
        total - existing,
        existing,
      ),
      confirmText: t.confirmButton,
      destructive: true,
    });
    if (!ok) return;
    setBusy("importing");
    const out: Results = {};
    const batches = parsed.tables.flatMap((tb) =>
      chunkRowsBySize(tb.rows).map((rows) => ({ tb, rows })),
    );
    setProgress({ done: 0, total: batches.length });
    try {
      for (const tb of parsed.tables) out[tb.table] = { written: 0, failedBatches: 0 };
      let done = 0;
      for (const { tb, rows } of batches) {
        let r: Awaited<ReturnType<typeof applyImportBatchAction>>;
        try {
          r = await applyImportBatchAction({ part: parsed.part, table: tb.table, rows });
        } catch (e) {
          // 塊が大きすぎて Server Action の上限で落ちた、通信が切れた、など。
          r = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
        const cur = out[tb.table]!;
        if (r.ok) cur.written += r.written;
        else {
          cur.failedBatches += 1;
          cur.reason ??= r.reason;
        }
        done += 1;
        setProgress({ done, total: batches.length });
      }
      setResults(out);
      const failed = Object.values(out).some((x) => x.failedBatches > 0);
      if (failed) toast.error(t.importPartial);
      else toast.success(t.importDone);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border/30 pt-3">
      <p className="text-xs">{t.heading}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t.description}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t.orderHint(IMPORT_PART_ORDER.map((id) => m.dataExport.partLabel(id)).join(" → "))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
          className="text-[11px]"
        >
          {busy === "reading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-3.5 w-3.5" aria-hidden />
          )}
          {t.chooseFile}
        </Button>
        {fileName && <span className="truncate font-mono text-[11px] text-muted-foreground">{fileName}</span>}
      </div>

      {parsed && (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border/40 bg-secondary/20 px-2.5 py-2 text-[11px] leading-relaxed">
          <p>
            <strong>{m.dataExport.partLabel(parsed.part)}</strong>
            {parsed.exportedAt && Number.isFinite(Date.parse(parsed.exportedAt)) && (
              <span className="ml-1 text-muted-foreground">
                {t.exportedAt(jstDateTimeString(new Date(parsed.exportedAt)))}
              </span>
            )}
          </p>
          {parsed.exportErrors.length > 0 && (
            <p className="text-amber-300">{t.exportErrors(parsed.exportErrors.join(", "))}</p>
          )}
          {parsed.ignoredTables.length > 0 && (
            <p className="text-muted-foreground">{t.ignoredTables(parsed.ignoredTables.join(", "))}</p>
          )}
          <ul className="flex flex-col gap-0.5 font-mono">
            {parsed.tables.map((tb) => {
              const c = counts?.[tb.table];
              const res = results?.[tb.table];
              return (
                <li key={tb.table} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-foreground/90">{tb.table}</span>
                  <span className="text-muted-foreground">{t.rows(tb.rows.length)}</span>
                  {tb.skipped > 0 && <span className="text-amber-300">{t.skipped(tb.skipped)}</span>}
                  {c && (
                    <span className="text-cyan-300/90">
                      {t.counts(c.total - c.existing, c.existing)}
                    </span>
                  )}
                  {res && (
                    <span className={res.failedBatches > 0 ? "text-rose-300" : "text-emerald-300"}>
                      {res.failedBatches > 0
                        ? t.resultFailed(res.written, res.failedBatches, res.reason ?? "")
                        : t.resultOk(res.written)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {progress && busy !== null && busy !== "reading" && (
            <p className="text-muted-foreground">{t.progress(progress.done, progress.total)}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void onCheck()}
              className="text-[11px]"
            >
              {busy === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t.checkButton}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy !== null || counts === null}
              onClick={() => void onImport()}
              title={counts === null ? t.importNeedsCheck : undefined}
              className="text-[11px]"
            >
              {busy === "importing" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t.importButton}
            </Button>
          </div>
        </div>
      )}
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">{t.note}</p>
    </div>
  );
}
