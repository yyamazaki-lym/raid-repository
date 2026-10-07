"use client";

import { useMemo, useTransition } from "react";
import { ClipboardCopy, Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  buildPullNotesDigest,
  countPullNoteTags,
  fitTooltipLines,
  pullNoteDetailsByTag,
  type PullNote,
  type PullNoteDetail,
} from "@/lib/logs/pull-note-tags";
import { useMessages } from "@/lib/i18n/client";
import { jstYmdString } from "@/lib/jst-date";
import { APP_TIME_ZONE } from "@/lib/app-timezone";
import { pullNoteTagLabel } from "./pull-detail-panel";

/** 1 行の hover に出す注釈の上限 (長すぎるツールチップは読めない)。 */
const HOVER_LIMIT = 15;
/**
 * hover 全体の文字数の予算。Windows の Chrome / Edge は `title` を 1024 文字で
 * 切る (`fitTooltipLines` の docstring) ので、少し余裕を見る。
 */
const HOVER_CHAR_BUDGET = 1000;
/** hover の 1 行に出す一言メモの上限 (全文は pull の展開行で見る)。 */
const HOVER_NOTE_MAX = 40;

/** 一言メモを hover 用に切る (サロゲートペアを割らないようコードポイントで数える)。 */
function clipNote(note: string | null): string | null {
  if (!note) return note;
  const chars = Array.from(note);
  return chars.length > HOVER_NOTE_MAX
    ? chars.slice(0, HOVER_NOTE_MAX).join("") + "…"
    : note;
}

/**
 * ミス注釈の傾向 + Discord 用の振り返り (W-7、2026-09-08)。
 *
 * 個々の注釈は pull の展開行で付ける。ここはその**集計**で、
 * 「どのギミックで一番崩れているか」を人の判断ベースで見る
 * (ワイプ原因カードが「致命技」ベースで同じ問いに答えているのと対)。
 *
 * ## 個人タグは集計に出さない
 *
 * 表に出すのは `scope='team'` だけ。件数は末尾に「個人メモ N 件」として
 * 添えるが、**中身は出さない** (本人が自分用に付けた印なので)。
 * Discord 用の本文も同じ規則 (`buildPullNotesDigest`)。
 *
 * ## 行の hover に注釈の明細 (2026-10-06)
 *
 * 実機要望「ミス注釈の傾向はマウスオーバーなりで見えるようにしてほしい」。
 * 各行の `title` に、そのタグの注釈を 1 件 1 行で出す (pull の日時・ティア
 * 通算の番号・一言メモ)。練習ログの他の hover (初討伐カード) と同じく
 * ブラウザの `title` で、書き方も `floorClearHover` に揃える。新しい pull
 * から `HOVER_LIMIT` 件まで出し、残りは件数だけ。⚠ Windows の Chrome / Edge
 * は `title` を 1024 文字で切るので、メモは `HOVER_NOTE_MAX` 字で切り、全体を
 * `HOVER_CHAR_BUDGET` 字に収める (出せなかった件数の行は必ず残す)。
 * 個人タグはここにも出さない (行が team だけの集計なので、明細も team だけ)。
 *
 * ## 読み込みは lazy
 *
 * 注釈が 1 件も無い固定では何も出さない (カードごと消す)。
 * 初期値は**サーバーで読んで props で渡す** (2026-09-09) — mount 後に
 * Server Action を投げると、開くたびに往復 1 本が余計に走る。
 */
export function PullNotesCard({
  categoryName,
  initial,
  fights,
  numberedFights,
  duplicateOf,
}: {
  categoryName: string;
  /**
   * サーバーで読んだ初期値 (2026-09-09)。⚠ 以前は mount 後に
   * `fetchCategoryPullNotesAction` を呼んでいたので、**注釈が 0 件の固定でも
   * 練習ログを開くたびに往復 1 本**走っていた (カードが自分で消えるのは
   * 応答が返ってから)。読み取りに失敗した場合だけ null。
   */
  initial: { notes: PullNote[]; truncated: boolean } | null;
  /** 練習ログの明細 (hover に pull の日時を出すのに使う)。 */
  fights: ReadonlyArray<{
    reportCode: string;
    fightId: number;
    sessionDate: string | null;
    startMs: number;
  }>;
  /**
   * ティア通算の番号を数える明細 (初討伐カードと同じ `tierFights`)。明細が
   * 打ち切られているときは null (古い pull が落ちて番号が過小になる)。
   */
  numberedFights: ReadonlyArray<{
    reportCode: string;
    fightId: number;
    startMs: number;
  }> | null;
  /**
   * 別のログと同じ pull → 数える側 (2026-10-07 C-3)。`numberedFights` は数える
   * pull だけなので、数えない側に付いた注釈の番号はこれで数える側に読み替える。
   */
  duplicateOf: ReadonlyMap<string, string>;
}) {
  const m = useMessages();
  // ⚠ 状態を持たない — 初期値がそのまま表示。追加 / 削除は pull 行側で行い、
  // ページの再描画で新しい値が来る (カードは読むだけ)。
  const notes = initial ? initial.notes : null;
  const truncated = initial?.truncated ?? false;
  const [copying, startCopy] = useTransition();
  const detailsByTag = useMemo(
    () =>
      pullNoteDetailsByTag(
        (notes ?? []).filter((n) => n.scope === "team"),
        fights,
        numberedFights,
        duplicateOf,
      ),
    [notes, fights, numberedFights, duplicateOf],
  );

  // 読み込み中と「0 件」は同じ見た目にしない — 0 件のときは使い方を出す。
  if (notes === null) return null;

  const team = notes.filter((n) => n.scope === "team");
  const counts = countPullNoteTags(team);
  const max = counts[0]?.count ?? 1;

  const onCopy = () =>
    startCopy(async () => {
      const text = buildPullNotesDigest({
        header: m.logs.pullNoteDigestHeader(categoryName),
        notes,
        labelOf: (t) => pullNoteTagLabel(m, t),
        selfLabel: (n) => m.logs.pullNoteDigestSelf(n),
        emptyLabel: m.logs.pullNoteDigestEmpty,
      });
      try {
        await navigator.clipboard.writeText(text);
        toast.success(m.logs.pullNoteDigestCopied);
      } catch {
        toast.error(m.recruitment.copyFailed);
      }
    });

  // 時刻は初討伐カード (`floor-clear-card.tsx`) と同じく JST 固定。日付は
  // セッションの日 (`session_date`) を優先する (深夜まで続いた日に翌日へ
  // ずれないように)。
  const hoverText = (details: ReadonlyArray<PullNoteDetail>) => {
    // 整形するのは出しうる行だけ (総数は total で渡す)。
    const lines = details.slice(0, HOVER_LIMIT).map((d) =>
      m.logs.pullNoteHoverLine(
        d.startMs === null ? null : (d.date ?? jstYmdString(new Date(d.startMs))),
        d.startMs === null
          ? null
          : new Date(d.startMs).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: APP_TIME_ZONE,
            }),
        d.overallPulls,
        clipNote(d.note),
      ),
    );
    return (
      fitTooltipLines(lines, {
        maxLines: HOVER_LIMIT,
        maxChars: HOVER_CHAR_BUDGET,
        more: (n) => m.logs.pullNoteHoverMore(n),
        total: details.length,
      }) || undefined
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag className="h-3 w-3 shrink-0 text-amber-300/80" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {m.logs.pullNoteTrendTitle}
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          {m.logs.pullNoteTrendSubtitle(team.length)}
          {truncated ? ` / ${m.logs.pullNoteTrendTruncated}` : ""}
        </span>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={onCopy}
            disabled={copying}
            className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-200"
          >
            {copying ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
            ) : (
              <ClipboardCopy className="h-2.5 w-2.5" aria-hidden />
            )}
            {m.logs.pullNoteDigestCopy}
          </button>
        )}
      </div>

      {counts.length === 0 ? (
        <span className="text-[12px] leading-snug text-muted-foreground">
          {m.logs.pullNoteTrendEmpty}
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {counts.map((c) => (
            <li
              key={c.tag}
              className="flex items-center gap-2"
              title={hoverText(detailsByTag.get(c.tag) ?? [])}
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
                {pullNoteTagLabel(m, c.tag)}
              </span>
              {/* 横棒は最多を 100% とした相対量。件数も併記するので、
                  棒だけで数を読ませない (ワイプ原因カードと同じ形)。 */}
              <span
                aria-hidden
                className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-secondary/60"
              >
                <span
                  className="block h-full rounded-full bg-amber-400/70"
                  style={{ width: `${Math.round((c.count / max) * 100)}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                ×{c.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
