"use client";

import { Download } from "lucide-react";
import { EXPORT_PARTS } from "@/lib/data-export";
import { useMessages } from "@/lib/i18n/client";
import { CollapsibleSection } from "./collapsible-section";
import { DataImportPanel } from "./data-import-panel";

/**
 * データの書き出し (2026-10-01 監査 F-3)。admin のみ。
 *
 * 種類ごとに `/api/admin/export?part=<id>` を普通のリンクでダウンロードする
 * (route が JSON を流し、`Content-Disposition: attachment` で保存させる)。
 * 練習ログの明細は大きいので単独の種類にしてある (理由は `data-export.ts`)。
 * 「全データ初期化」の直前に置き、消す前に書き出せるようにする。
 */
export function DataExportSection({ canEdit }: { canEdit: boolean }) {
  const m = useMessages();
  if (!canEdit) return null;
  return (
    <CollapsibleSection
      id="data-export"
      icon={<Download className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      title={m.dataExport.title}
    >
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {m.dataExport.description}
      </p>
      <ul className="flex flex-col gap-1.5">
        {EXPORT_PARTS.map((part) => (
          <li key={part.id}>
            <a
              href={`/api/admin/export?part=${part.id}`}
              download
              className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2 transition-colors hover:border-[var(--neon-cyan)]/60"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs">{m.dataExport.partLabel(part.id)}</span>
                <span className="text-[12px] leading-relaxed text-muted-foreground">
                  {m.dataExport.partHint(part.id)}
                </span>
              </span>
              <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        {m.dataExport.note}
      </p>
      {/* 2026-10-05 (監査 F-3 の残り): 書き出したファイルからの取り込み直し。 */}
      <DataImportPanel />
    </CollapsibleSection>
  );
}
