"use client";

import { useState, useTransition } from "react";
import { Swords } from "lucide-react";
import { JOBS, jobLabel, roleOfJob } from "@/lib/jobs";
import { setMyJobAction } from "@/lib/server/my-profile-actions";
import { useLocale, useMessages } from "@/lib/i18n/client";

/**
 * 本人のジョブを選ぶ (L-8、2026-09-08)。
 *
 * 実機報告「ロール設定が非常に分かりにくい」への対応。ロールは
 * **設定ダイアログ → メンバー一覧**の奥にしか無く、しかも admin でないと
 * 触れなかった。ここでは:
 *
 * - **使う場所に置く** (軽減表タブの絞り込みの隣、と `/me`)
 * - **本人が保存できる** (`setMyJobAction` は自分の行だけを更新する)
 * - **ロールは選ばせない** — ジョブから決まる (`roleOfJob`)。選択肢が
 *   1 つ減り、しかも軽減表の列 (シートのジョブ名) に当たる
 *
 * ⚠ メンバー一覧に自分の行が無い固定では保存できない。そのときは
 * **何をすれば保存できるようになるか**を出す (黙って失敗させない)。
 */
export function MyJobPicker({
  job,
  registered,
  onChanged,
}: {
  job: string | null;
  registered: boolean;
  onChanged?: (job: string | null) => void;
}) {
  const m = useMessages();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const role = roleOfJob(job);

  const save = (next: string) => {
    const value = next === "" ? null : next;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setMyJobAction(value);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      onChanged?.(value);
      setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Swords className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {m.myJob.label}
        </label>
        <select
          value={job ?? ""}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
          aria-label={m.myJob.label}
          className="h-8 rounded-md border border-border/60 bg-background/60 px-2 text-[12px] text-foreground"
        >
          <option value="">{m.myJob.unset}</option>
          {(["tank", "healer", "dps"] as const).map((r) => (
            <optgroup key={r} label={m.nativeMembers.roleNames[r]}>
              {JOBS.filter((j) => j.role === r).map((j) => (
                <option key={j.key} value={j.key}>
                  {jobLabel(j.key, locale)} ({j.abbr})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {role && (
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            {m.myJob.roleIs(m.nativeMembers.roleNames[role])}
          </span>
        )}
        {saved && !pending && (
          <span className="text-[11px] text-emerald-300/85">{m.myJob.saved}</span>
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
