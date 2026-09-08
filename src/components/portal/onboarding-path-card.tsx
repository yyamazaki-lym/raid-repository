"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check, GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  buildOnboardingProgress,
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_SEGMENT,
  type OnboardingStepId,
} from "@/lib/onboarding-steps";
import {
  fetchOnboardingStateAction,
  setOnboardingStepAction,
} from "@/lib/server/onboarding-actions";
import { useMessages } from "@/lib/i18n/client";

/**
 * 新規メンバーの学習パス (B-3、2026-09-08)。
 *
 * 「何から見ればいいか」を順番で示すチェックリスト。順番は
 * **動画 → 散開図 → マクロ → 軽減表** に固定してある
 * (理由は `lib/onboarding-steps.ts` の docstring)。
 *
 * ## 全部済んだら畳む
 *
 * ⚠ 済んだ人にとってこのカードは**ただの邪魔**なので、全部済んだら
 * 1 行に縮める。新規メンバーだけに効く機能を、全員の画面に常時出さない。
 *
 * ## 中身が無い手順は出さない
 *
 * 動画 0 本のコンテンツで「動画を見る」を促さない (押しても空の画面)。
 * 分母からも外すので「1/4 しか終わっていない」に見えない。
 *
 * ## 誰が終わっていないかは出さない
 *
 * 幹部には人数だけ出す。名前を出すと新規メンバーを追いかける形に
 * なりやすい (詳細は `server/onboarding-actions.ts`)。
 */
export function OnboardingPathCard({
  categoryId,
  categorySlug,
  availability,
}: {
  categoryId: string;
  categorySlug: string;
  /** 手順 → 中身があるか (無い手順は出さない)。 */
  availability: Partial<Record<OnboardingStepId, boolean>>;
}) {
  const m = useMessages();
  const [state, setState] = useState<{
    mine: string[];
    counts: Record<string, number>;
    isAdmin: boolean;
  } | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void fetchOnboardingStateAction(categoryId).then((r) => {
      if (!alive || !r.ok) return;
      setState({ mine: r.mine, counts: r.counts, isAdmin: r.isAdmin });
    });
    return () => {
      alive = false;
    };
  }, [categoryId]);

  if (!state) return null;
  const progress = buildOnboardingProgress({
    doneIds: state.mine,
    availability,
  });
  // 中身が 1 つも無いコンテンツでは出さない (促すものが無い)。
  if (progress.total === 0) return null;

  const allDone = progress.next === null;

  const toggle = (id: OnboardingStepId, done: boolean) =>
    startTransition(async () => {
      const r = await setOnboardingStepAction({
        categoryId,
        step: id,
        done,
      });
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      const again = await fetchOnboardingStateAction(categoryId);
      if (again.ok) {
        setState({
          mine: again.mine,
          counts: again.counts,
          isAdmin: again.isAdmin,
        });
      }
    });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-secondary/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap
          className="h-3 w-3 shrink-0 text-emerald-300/80"
          aria-hidden
        />
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {m.onboardingPath.title}
        </span>
        <span
          className={
            "text-[11px] " +
            (allDone ? "text-emerald-200/90" : "text-muted-foreground/80")
          }
        >
          {allDone
            ? m.onboardingPath.allDone
            : m.onboardingPath.progress(progress.done, progress.total)}
        </span>
      </div>

      {/* ⚠ 全部済んだら 1 行で終わり (済んだ人には邪魔なだけ)。 */}
      {!allDone && (
        <ol className="flex flex-col gap-1">
          {progress.steps
            .filter((s) => s.available)
            .map((s, i) => {
              const isNext = progress.next === s.id;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(s.id, !s.done)}
                    disabled={busy}
                    aria-pressed={s.done}
                    aria-label={m.onboardingPath.toggleAria(
                      m.onboardingPath.steps[s.id],
                      s.done,
                    )}
                    className={
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors " +
                      (s.done
                        ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-200"
                        : "border-border/50 text-transparent hover:border-emerald-400/50")
                    }
                  >
                    {busy ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-2.5 w-2.5" aria-hidden />
                    )}
                  </button>
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                    {i + 1}
                  </span>
                  <Link
                    href={`/category/${categorySlug}/${ONBOARDING_STEP_SEGMENT[s.id]}`}
                    prefetch={false}
                    className={
                      "min-w-0 flex-1 truncate text-[12px] transition-colors hover:text-[var(--neon-cyan)] " +
                      (s.done
                        ? "text-muted-foreground/70 line-through"
                        : isNext
                          ? "font-medium text-foreground"
                          : "text-foreground/85")
                    }
                  >
                    {m.onboardingPath.steps[s.id]}
                  </Link>
                  {isNext && (
                    <span className="shrink-0 rounded-sm bg-[var(--neon-cyan)]/15 px-1 py-[0.5px] text-[11px] text-[var(--neon-cyan)]">
                      {m.onboardingPath.nextBadge}
                    </span>
                  )}
                  {/* 幹部には人数だけ。誰が終わっていないかは出さない。 */}
                  {state.isAdmin && (state.counts[s.id] ?? 0) > 0 && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                      {m.onboardingPath.doneCount(state.counts[s.id] ?? 0)}
                    </span>
                  )}
                </li>
              );
            })}
        </ol>
      )}

      {!allDone && (
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {m.onboardingPath.note}
        </p>
      )}
    </div>
  );
}

/** 手順の並び (UI から参照する用の再 export)。 */
export { ONBOARDING_STEP_IDS };
