"use client";

import { useMemo, useState, useTransition } from "react";
import { Swords, X } from "lucide-react";
import { JOBS, jobLabel, rolesOfJobs } from "@/lib/jobs";
import { setMyJobsAction } from "@/lib/server/my-profile-actions";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * 本人のジョブを選ぶ (L-8 2026-09-08 / L-10 2026-09-09)。
 *
 * 実機報告 L-8「ロール設定が非常に分かりにくい」への対応。ロールは
 * **設定ダイアログ → メンバー一覧**の奥にしか無く、しかも admin でないと
 * 触れなかった。ここでは:
 *
 * - **使う場所に置く** (軽減表タブの絞り込みの隣、と `/me`)
 * - **本人が保存できる** (`setMyJobsAction` は自分の行だけを更新する)
 * - **ロールは選ばせない** — ジョブから決まる (`rolesOfJobs`)
 *
 * ## L-10: 複数指定
 *
 * 実機報告「ロールは複数変わることもある」。1 つの `<select>` を
 * 「追加」専用にして、選んだジョブは**チップ**で並べ、× で外す。
 *
 * ⚠ **22 ジョブをトグルのチップで並べない。** 常時 22 個のボタンが出ると
 * 軽減表の絞り込みの隣に置けない (この UI が置かれる場所が狭いことが
 * L-8 の出発点だった)。「追加の select + 選んだぶんだけチップ」なら
 * 未設定時の高さが 1 行で済む。
 *
 * ⚠ この部品が編集するのは **1 つの範囲だけ** (既定、または 1 コンテンツ)。
 * 範囲の切り替えと一覧は `MyJobScopes` (/me 用) と軽減表タブ側が持つ。
 */
export function MyJobPicker({
  jobs,
  categoryId = null,
  registered,
  label,
  onChanged,
}: {
  /** この範囲に今入っているジョブ。 */
  jobs: string[];
  /** null = 既定 (どのコンテンツでも)。 */
  categoryId?: string | null;
  /** メンバー一覧に本人の行があるか (無いと保存できない)。 */
  registered: boolean;
  /** 見出し (既定なら「自分のジョブ」)。 */
  label?: string;
  onChanged?: (jobs: string[]) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 保存に失敗したら元へ戻すので、表示は draft を優先する。
  const [draft, setDraft] = useState<string[] | null>(null);
  const current = draft ?? jobs;

  const roles = useMemo(() => rolesOfJobs(current), [current]);

  const save = (next: string[]) => {
    const before = current;
    setError(null);
    setSaved(false);
    setDraft(next);
    startTransition(async () => {
      const res = await setMyJobsAction({ categoryId, jobs: next });
      if (!res.ok) {
        setDraft(before);
        setError(res.reason);
        return;
      }
      onChanged?.(next);
      setSaved(true);
    });
  };

  const add = (key: string) => {
    if (!key || current.includes(key)) return;
    save([...current, key]);
  };
  const remove = (key: string) => save(current.filter((j) => j !== key));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Swords className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {label ?? m.myJob.label}
        </span>

        {current.length === 0 ? (
          <span className="text-[12px] text-muted-foreground/85">
            {m.myJob.none}
          </span>
        ) : (
          <ul className="flex flex-wrap items-center gap-1">
            {current.map((key) => (
              <li key={key}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 py-0.5 pr-1 pl-2 text-[11px] text-foreground",
                    pending && "opacity-70",
                  )}
                >
                  {jobLabel(key, locale) ?? key}
                  <button
                    type="button"
                    onClick={() => remove(key)}
                    disabled={pending}
                    aria-label={m.myJob.remove(jobLabel(key, locale) ?? key)}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-rose-300"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* 追加専用の select。value を空に戻すので「選ぶ = 追加」になる。 */}
        <select
          value=""
          disabled={pending}
          onChange={(e) => add(e.target.value)}
          aria-label={m.myJob.add}
          className="h-8 rounded-md border border-border/60 bg-background/60 px-2 text-[12px] text-foreground"
        >
          <option value="">{m.myJob.add}</option>
          {(["tank", "healer", "dps"] as const).map((r) => (
            <optgroup key={r} label={m.nativeMembers.roleNames[r]}>
              {JOBS.filter((j) => j.role === r && !current.includes(j.key)).map(
                (j) => (
                  <option key={j.key} value={j.key}>
                    {jobLabel(j.key, locale)} ({j.abbr})
                  </option>
                ),
              )}
            </optgroup>
          ))}
        </select>

        {roles.length > 0 && (
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            {m.myJob.rolesAre(
              roles.map((r) => m.nativeMembers.roleNames[r]).join(" / "),
            )}
          </span>
        )}
        {saved && !pending && (
          <span className="text-[11px] text-emerald-300/85">
            {m.myJob.saved}
          </span>
        )}
      </div>
      {!registered && (
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {m.myJob.notRegistered}
        </p>
      )}
      {error && (
        <p className="text-[11px] leading-snug text-rose-300/90">{error}</p>
      )}
    </div>
  );
}
