"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, Plus, Skull, Tag, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchPullDetailAction,
  type PullDetailDeath,
} from "@/lib/server/pull-detail-actions";
import {
  addPullNoteAction,
  deletePullNoteAction,
  fetchPullNotesAction,
} from "@/lib/server/pull-notes-actions";
import {
  PULL_NOTE_TAG_IDS,
  type PullNote,
  type PullNoteScope,
} from "@/lib/logs/pull-note-tags";
import { formatMs, jobAbbr } from "@/lib/fflogs-fight-detail";
import { useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

/**
 * pull の構造化リキャップ (UI-14、2026-09-08)。
 *
 * 行の「詳細」を開いたときだけ出る展開パネル。行そのものは L-6 で
 * 1 行に収めたばかりなので、**行に足さずに下へ展開する**。
 *
 * ## 何を出すか
 *
 * 保存済みの死亡イベント (W-1) を 1 件 = 1 行で並べる:
 * `0:42 P2 WHM ← 技名 (+3s)`。自由記述のメモを「技 + フェーズ + ジョブ」に
 * 寄せると集計できる、というのが UI-14 の狙いなので、**並べる順と粒度を
 * 崩さない** (時刻昇順、ジョブは略称、技名は日本語優先)。
 *
 * ⚠ **プレイヤー名は出ない。** `death_events` の保存形が名前を持たない
 * (W-1 の設計)。「誰が落ちたか」ではなく「どのジョブが何で落ちたか」。
 *
 * ## 取得は開いたときだけ
 *
 * 死亡イベントを一覧の payload に載せると `check-fights-payload.mjs` の
 * gzip 予算 (300 KB / 20,000 pull) を超える。展開時に 1 行だけ引く
 * (`fetchPullDetailAction`) ので、一覧の重さは変わらない。
 *
 * 一度取った結果は state に持つので、閉じて開き直しても再取得しない。
 *
 * ## ミス注釈 (W-7、2026-09-08)
 *
 * 同じパネルの下半分に、人が付ける「なぜ崩れたか」のタグを置く。
 * 死亡イベント (= 何が起きたか) の真下に並ぶので、**見ながら付けられる**。
 *
 * ⚠ 帰属の既定は**チーム**。`自分` を選んだときだけ本人のタグになり、
 * 相手は server が呼び出し本人で埋める (他人に付ける経路が無い)。
 * 詳細は `lib/logs/pull-note-tags.ts` と `server/pull-notes-actions.ts`。
 */
export function PullDetailPanel({
  reportCode,
  fightId,
  categoryId,
  /** 直前の死亡から N ms 以内を「まとめて落ちた」と見なす閾値。 */
  clusterMs = 10_000,
}: {
  reportCode: string;
  fightId: number;
  /** ミス注釈をコンテンツ単位で集計するための非正規化キー。 */
  categoryId: string | null;
  clusterMs?: number;
}) {
  const m = useMessages();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; reason: string }
    | { kind: "ready"; deaths: PullDetailDeath[]; missing: boolean }
  >({ kind: "loading" });

  const [notes, setNotes] = useState<{
    list: PullNote[];
    viewerId: string;
    isAdmin: boolean;
  } | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void fetchPullDetailAction(reportCode, fightId).then((r) => {
      if (!alive) return;
      if (!r.ok) setState({ kind: "error", reason: r.reason });
      else setState({ kind: "ready", deaths: r.deaths, missing: r.missing });
    });
    return () => {
      alive = false;
    };
  }, [reportCode, fightId]);

  const reloadNotes = useCallback(async () => {
    const r = await fetchPullNotesAction(reportCode, fightId);
    if (r.ok) {
      setNotes({ list: r.notes, viewerId: r.viewerId, isAdmin: r.isAdmin });
    }
  }, [reportCode, fightId]);

  useEffect(() => {
    let alive = true;
    void fetchPullNotesAction(reportCode, fightId).then((r) => {
      if (!alive || !r.ok) return;
      setNotes({ list: r.notes, viewerId: r.viewerId, isAdmin: r.isAdmin });
    });
    return () => {
      alive = false;
    };
  }, [reportCode, fightId]);

  return (
    <div className="w-full border-t border-border/30 pt-1.5">
      {state.kind === "loading" ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {m.common.loading}
        </span>
      ) : state.kind === "error" ? (
        <span className="text-[11px] text-destructive-foreground/90">
          {state.reason}
        </span>
      ) : state.deaths.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          {state.missing ? m.logs.pullDetailMissing : m.logs.pullDetailNoDeaths}
        </span>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {state.deaths.map((d, i) => {
            // まとめて落ちた 2 件目以降は薄くする (1 件目の連鎖なのか、
            // 別の場面での死亡なのかを目で分けられるようにする)。
            const chained = d.sincePrev !== null && d.sincePrev <= clusterMs;
            return (
              <li
                key={`${d.t}:${i}`}
                className={
                  "flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums " +
                  (chained ? "text-muted-foreground/70" : "text-foreground/90")
                }
              >
                <span className="w-10 shrink-0 text-right text-slate-400">
                  {formatMs(d.t)}
                </span>
                <span className="w-8 shrink-0 text-center text-indigo-300/90">
                  {d.phase !== null ? `P${d.phase}` : ""}
                </span>
                <span className="w-10 shrink-0 text-cyan-300/85">
                  {jobAbbr(d.job)}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Skull className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0">
                    {d.ability ?? m.logs.pullDetailUnknownAbility}
                  </span>
                </span>
                {chained && d.sincePrev !== null && (
                  <span className="text-muted-foreground/60">
                    {m.logs.pullDetailSincePrev(Math.round(d.sincePrev / 100) / 10)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* W-7 (2026-09-08): ミス注釈。死亡イベントの真下に置くので、
          何が起きたかを見ながら「なぜ崩れたか」を付けられる。 */}
      <PullNotesBlock
        m={m}
        notes={notes}
        busy={busy}
        onAdd={(tag, scope, note) =>
          startTransition(async () => {
            const r = await addPullNoteAction({
              reportCode,
              fightId,
              categoryId,
              tag,
              scope,
              note,
            });
            if (!r.ok) {
              toast.error(r.reason);
              return;
            }
            await reloadNotes();
          })
        }
        onDelete={(id) =>
          startTransition(async () => {
            const r = await deletePullNoteAction(id);
            if (!r.ok) {
              toast.error(r.reason);
              return;
            }
            await reloadNotes();
          })
        }
      />
    </div>
  );
}

/** タグ id → 表示ラベル (既知リスト外は id をそのまま出す)。 */
export function pullNoteTagLabel(m: Messages, tag: string): string {
  const dict = m.logs.pullNoteTags as Record<string, string | undefined>;
  return dict[tag] ?? tag;
}

/**
 * 注釈のチップ列 + 追加フォーム。
 *
 * 帰属の切替は「チーム / 自分」の 2 択で、**既定はチーム**。`自分` を
 * 選んでも相手は選べない (server が呼び出し本人で埋める) ので、
 * 他人に個人タグを付ける UI は存在しない。
 */
function PullNotesBlock({
  m,
  notes,
  busy,
  onAdd,
  onDelete,
}: {
  m: Messages;
  notes: { list: PullNote[]; viewerId: string; isAdmin: boolean } | null;
  busy: boolean;
  onAdd: (tag: string, scope: PullNoteScope, note: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState<string>(PULL_NOTE_TAG_IDS[0]);
  const [scope, setScope] = useState<PullNoteScope>("team");
  const [text, setText] = useState("");

  if (!notes) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-border/20 pt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <Tag
          className="h-2.5 w-2.5 shrink-0 text-muted-foreground/70"
          aria-hidden
        />
        {notes.list.length === 0 && !adding && (
          <span className="text-[11px] text-muted-foreground/70">
            {m.logs.pullNoteEmpty}
          </span>
        )}
        {notes.list.map((n) => {
          const canDelete = notes.isAdmin || n.createdById === notes.viewerId;
          const isSelf = n.scope === "self";
          return (
            <span
              key={n.id}
              className={
                "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] " +
                (isSelf
                  ? "border-[var(--neon-violet)]/45 bg-[var(--neon-violet)]/10 text-[var(--neon-violet)]"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200")
              }
              title={
                (isSelf ? m.logs.pullNoteScopeSelf : m.logs.pullNoteScopeTeam) +
                (n.note ? ` / ${n.note}` : "")
              }
            >
              {isSelf && <span aria-hidden>{m.logs.pullNoteSelfMark}</span>}
              {pullNoteTagLabel(m, n.tag)}
              {n.note ? (
                <span className="max-w-[12rem] truncate opacity-80">
                  {n.note}
                </span>
              ) : null}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(n.id)}
                  disabled={busy}
                  aria-label={m.logs.pullNoteDelete}
                  title={m.logs.pullNoteDelete}
                  className="opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" aria-hidden />
                </button>
              )}
            </span>
          );
        })}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-0.5 rounded-sm border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-200"
          >
            <Plus className="h-2.5 w-2.5" aria-hidden />
            {m.logs.pullNoteAdd}
          </button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={busy}
            aria-label={m.logs.pullNoteTagAria}
            className="h-6 rounded-sm border border-border/50 bg-background/60 px-1 text-[12px] text-foreground"
          >
            {PULL_NOTE_TAG_IDS.map((t) => (
              <option key={t} value={t}>
                {pullNoteTagLabel(m, t)}
              </option>
            ))}
          </select>
          <span className="inline-flex overflow-hidden rounded-sm border border-border/50">
            {(["team", "self"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setScope(sc)}
                disabled={busy}
                className={
                  "px-1.5 py-0.5 text-[11px] transition-colors " +
                  (scope === sc
                    ? "bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)]"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {sc === "team"
                  ? m.logs.pullNoteScopeTeam
                  : m.logs.pullNoteScopeSelf}
              </button>
            ))}
          </span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            disabled={busy}
            placeholder={m.logs.pullNotePlaceholder}
            aria-label={m.logs.pullNotePlaceholder}
            className="h-6 min-w-0 flex-1 rounded-sm border border-border/50 bg-background/60 px-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={() => {
              onAdd(tag, scope, text.trim() || null);
              setAdding(false);
              setText("");
            }}
            disabled={busy}
            className="inline-flex items-center gap-0.5 rounded-sm border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            {busy ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-2.5 w-2.5" aria-hidden />
            )}
            {m.common.add}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setText("");
            }}
            disabled={busy}
            className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {m.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
