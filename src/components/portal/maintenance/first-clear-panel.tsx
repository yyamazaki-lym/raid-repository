"use client";

import { Trophy } from "lucide-react";
import { type BackfillResult } from "@/lib/server/categories-actions";
import { useLocale, useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/** クリア日時 / クリア時間 backfill の結果パネル (maintenance-menu から分離、C-5)。 */
export function FirstClearPanel({
  data,
}: {
  data: BackfillResult;
  force: boolean;
}) {
  const m = useMessages();
  const locale = useLocale();
  const t = m.maintenancePanels;
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        {t.firstClearTitle}
      </p>
      {data.filled === 0 && data.noMatchDetails.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t.firstClearNoUpdate(data.noMatch, data.alreadySet)}
        </p>
      ) : (
        <>
          {data.filledDetails.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-[11px]">
              {data.filledDetails.map((d, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 leading-relaxed"
                >
                  <Trophy
                    className="mt-0.5 h-3 w-3 shrink-0 text-amber-300"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono break-all text-foreground">
                      {d.slug}
                    </span>
                    <span className="ml-2 text-amber-200">
                      {formatLong(d.isoDate, locale)}
                    </span>
                    <span
                      className={
                        "ml-2 inline-flex items-center rounded-sm border px-1 text-[9px] font-mono tracking-[0.18em] uppercase " +
                        (d.source === "title"
                          ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
                          : "border-zinc-400/45 bg-zinc-400/10 text-zinc-300")
                      }
                      title={
                        d.source === "title" ? t.sourceTitle : t.sourcePosted
                      }
                    >
                      {d.source === "title"
                        ? "title"
                        : d.source === "posted_at"
                          ? "posted"
                          : "created"}
                    </span>
                    {d.timeToClearSeconds > 0 && (
                      <span className="ml-2 inline-flex items-center rounded-sm border border-violet-400/45 bg-violet-400/10 px-1 text-[9px] font-mono tracking-[0.18em] uppercase text-violet-200">
                        {formatHM(d.timeToClearSeconds)}
                      </span>
                    )}
                    {d.videosWithoutDurationCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-amber-400/45 bg-amber-400/10 px-1 text-[9px] tracking-normal text-amber-200"
                        title={t.noDurationTitle(d.videosWithoutDurationCount)}
                      >
                        {t.noDurationBadge(d.videosWithoutDurationCount)}
                      </span>
                    )}
                    {d.excludedForeignCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-zinc-400/45 bg-zinc-400/10 px-1 text-[9px] tracking-normal text-zinc-300"
                        title={t.foreignTitle(d.excludedForeignCount)}
                      >
                        {t.foreignBadge(d.excludedForeignCount)}
                      </span>
                    )}
                    <p className="mt-0.5 text-muted-foreground/80 break-words">
                      {d.videoTitle}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.noMatchDetails.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border/30 pt-2">
              <p className="text-[10px] font-medium text-rose-300/85 tracking-normal">
                {t.noMatchHeading}
              </p>
              <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
                {data.noMatchDetails.map((nm, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400/70"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <span className="font-mono break-all text-foreground">
                        {nm.slug}
                      </span>
                      <span className="ml-2 text-[10px] text-rose-200/85">
                        {explainNoMatchReason(nm.reason, m)}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {t.countOf(nm.inCategoryCount, nm.videoCount)}
                      </span>
                      {nm.titleSamples.length > 0 && (
                        <ul className="mt-0.5 flex flex-col gap-0.5 text-[10px] text-muted-foreground/80">
                          {nm.titleSamples.map((t, j) => (
                            <li key={j} className="break-words pl-2">
                              · {t}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {(data.filled > 0 || data.noMatchDetails.length > 0) && (
        // 各項目を nowrap span にして「/」始まりの行を防ぐ。
        <p className="mt-2 flex flex-wrap gap-x-1.5 text-[10px] text-muted-foreground">
          <span className="whitespace-nowrap">{t.summaryAlreadySet(data.alreadySet)}</span>
          <span className="whitespace-nowrap">{t.summaryNoMatch(data.noMatch)}</span>
          <span className="whitespace-nowrap">{t.summaryFilled(data.filled)}</span>
        </p>
      )}
    </>
  );
}

/** Translate a no-match reason code into a hint (辞書経由)。 */
function explainNoMatchReason(
  reason: BackfillResult["noMatchDetails"][number]["reason"],
  m: Messages,
): string {
  const t = m.maintenancePanels;
  switch (reason) {
    case "no-videos":
      return t.reasonNoVideos;
    case "all-foreign":
      return t.reasonAllForeign;
    case "no-clear-keyword":
      return t.reasonNoClearKeyword;
    case "no-final-floor":
      return t.reasonNoFinalFloor;
    case "missing-name":
      return t.reasonMissingName;
    default:
      return t.reasonUnknown;
  }
}

function formatHM(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatLong(iso: string, locale: "ja" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = (locale === "en" ? DOW_EN : DOW_JA)[d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}
