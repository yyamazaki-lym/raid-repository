"use client";

import { Trophy } from "lucide-react";
import { type BackfillResult } from "@/lib/server/categories-actions";

/** クリア日時 / クリア時間 backfill の結果パネル (maintenance-menu から分離、C-5)。 */
export function FirstClearPanel({
  data,
}: {
  data: BackfillResult;
  force: boolean;
}) {
  return (
    <>
      <p className="mb-2 pr-6 text-[10px] font-medium tracking-normal text-muted-foreground">
        クリア日時 / クリア時間 取得結果
      </p>
      {data.filled === 0 && data.noMatchDetails.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          更新なし（該当 {data.noMatch} / 設定済み {data.alreadySet}）
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
                  <div className="flex-1">
                    <span className="font-mono text-foreground">
                      {d.slug}
                    </span>
                    <span className="ml-2 text-amber-200">
                      {formatLong(d.isoDate)}
                    </span>
                    <span
                      className={
                        "ml-2 inline-flex items-center rounded-sm border px-1 text-[9px] font-mono tracking-[0.18em] uppercase " +
                        (d.source === "title"
                          ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
                          : "border-zinc-400/45 bg-zinc-400/10 text-zinc-300")
                      }
                      title={
                        d.source === "title"
                          ? "動画タイトルから抽出した日付"
                          : "投稿日時を使用 (タイトルに日付なし)"
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
                        title={`動画時間が未取得の動画が ${d.videosWithoutDurationCount} 件あります — 「動画時間 + 投稿日時を取得」で取り込んでからクリア時間を再計算してください`}
                      >
                        ⚠ {d.videosWithoutDurationCount} 件未取得
                      </span>
                    )}
                    {d.excludedForeignCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-sm border border-zinc-400/45 bg-zinc-400/10 px-1 text-[9px] tracking-normal text-zinc-300"
                        title={`他コンテンツの動画を ${d.excludedForeignCount} 件除外`}
                      >
                        -{d.excludedForeignCount} 異
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
                該当なし — 詳細
              </p>
              <ul className="flex flex-col gap-1 text-[11px] leading-relaxed">
                {data.noMatchDetails.map((nm, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400/70"
                      aria-hidden
                    />
                    <div className="flex-1">
                      <span className="font-mono text-foreground">
                        {nm.slug}
                      </span>
                      <span className="ml-2 text-[10px] text-rose-200/85">
                        {explainNoMatchReason(nm.reason)}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        ({nm.inCategoryCount}/{nm.videoCount} 件)
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
        <p className="mt-2 text-[10px] text-muted-foreground">
          設定済み {data.alreadySet} ／ 該当なし {data.noMatch} ／ 更新{" "}
          {data.filled}
        </p>
      )}
    </>
  );
}

/** Translate a no-match reason code into a Japanese hint. */
function explainNoMatchReason(
  reason: BackfillResult["noMatchDetails"][number]["reason"],
): string {
  switch (reason) {
    case "no-videos":
      return "動画が登録されていません";
    case "all-foreign":
      return "他コンテンツの動画のみ (フィルター除外)";
    case "no-clear-keyword":
      return "「クリア」/「clear」を含む動画がありません";
    case "no-final-floor":
      return "「4 層 / 4 層クリア / M4S」等の最終層クリアと判定できる動画がありません";
    case "missing-name":
      return "コンテンツ名未設定";
    default:
      return "未分類";
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

function formatLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${y}-${m}-${day} (${wd})`;
}
