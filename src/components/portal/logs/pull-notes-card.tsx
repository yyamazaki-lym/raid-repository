"use client";

import { useTransition } from "react";
import { ClipboardCopy, Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  buildPullNotesDigest,
  countPullNoteTags,
  type PullNote,
} from "@/lib/logs/pull-note-tags";
import { useMessages } from "@/lib/i18n/client";
import { pullNoteTagLabel } from "./pull-detail-panel";

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
 * ## 読み込みは lazy
 *
 * 注釈が 1 件も無い固定では何も出さない (カードごと消す)。
 * 初期値は**サーバーで読んで props で渡す** (2026-09-09) — mount 後に
 * Server Action を投げると、開くたびに往復 1 本が余計に走る。
 */
export function PullNotesCard({
  categoryName,
  initial,
}: {
  categoryName: string;
  /**
   * サーバーで読んだ初期値 (2026-09-09)。⚠ 以前は mount 後に
   * `fetchCategoryPullNotesAction` を呼んでいたので、**注釈が 0 件の固定でも
   * 練習ログを開くたびに往復 1 本**走っていた (カードが自分で消えるのは
   * 応答が返ってから)。読み取りに失敗した場合だけ null。
   */
  initial: { notes: PullNote[]; truncated: boolean } | null;
}) {
  const m = useMessages();
  // ⚠ 状態を持たない — 初期値がそのまま表示。追加 / 削除は pull 行側で行い、
  // ページの再描画で新しい値が来る (カードは読むだけ)。
  const notes = initial ? initial.notes : null;
  const truncated = initial?.truncated ?? false;
  const [copying, startCopy] = useTransition();

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
            <li key={c.tag} className="flex items-center gap-2">
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
