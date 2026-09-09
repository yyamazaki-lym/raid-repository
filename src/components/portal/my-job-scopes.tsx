"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { MyJobPicker } from "./my-job-picker";
import { setMyJobsAction } from "@/lib/server/my-profile-actions";
import { useMessages } from "@/lib/i18n/client";

/**
 * ジョブの範囲ごとの設定 (`/me` 用、L-10 2026-09-09)。
 *
 * 実機報告「ロールは複数変わることもあるので、コンテンツごとに変更できたり
 * 複数指定できるようにしたい」。ここが**全体像を出す 1 箇所**で、
 *
 * - 既定 (どのコンテンツでも使う) の複数指定
 * - 上書きがあるコンテンツの一覧と、その中身
 * - 上書きの追加 / 削除
 *
 * を並べる。軽減表タブ側は「今開いているコンテンツ 1 つ」しか出さないので、
 * 全部を見比べたいときはこのページに来る形にした。
 *
 * ⚠ **上書きがあるコンテンツは既定を使わない** (合併しない)。この規則は
 * `lib/jobs.ts` の `jobsForCategory` が正で、ここは表示だけ。
 */
export function MyJobScopes({
  defaults,
  byCategory,
  categories,
  registered,
}: {
  defaults: string[];
  byCategory: Record<string, string[]>;
  categories: { id: string; name: string }[];
  registered: boolean;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  // 「上書きを足した直後 (まだジョブ 0 件)」も画面に残したいので、
  // 表示する範囲は props とは別に持つ。
  const [openIds, setOpenIds] = useState<string[]>(() =>
    categories.filter((c) => (byCategory[c.id]?.length ?? 0) > 0).map((c) => c.id),
  );

  const openCategories = useMemo(
    () => categories.filter((c) => openIds.includes(c.id)),
    [categories, openIds],
  );
  const addable = useMemo(
    () => categories.filter((c) => !openIds.includes(c.id)),
    [categories, openIds],
  );

  const clear = (categoryId: string) => {
    startTransition(async () => {
      // 空で保存する = その範囲の行を消す = 既定に戻る。
      await setMyJobsAction({ categoryId, jobs: [] });
      setOpenIds((prev) => prev.filter((id) => id !== categoryId));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <MyJobPicker
        jobs={defaults}
        categoryId={null}
        registered={registered}
        label={m.myJob.scopeDefault}
      />
      <p className="text-[11px] leading-snug text-muted-foreground/85">
        {m.myJob.multiHint}
      </p>

      <div className="flex flex-col gap-2 border-t border-border/40 pt-2.5">
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {m.myJob.perCategoryTitle}
        </span>
        {openCategories.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.myJob.perCategoryEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {openCategories.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <MyJobPicker
                  jobs={byCategory[c.id] ?? []}
                  categoryId={c.id}
                  registered={registered}
                  label={m.myJob.scopeCategory(c.name)}
                />
                <button
                  type="button"
                  onClick={() => clear(c.id)}
                  disabled={pending}
                  className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  {m.myJob.clearOverride}
                </button>
              </li>
            ))}
          </ul>
        )}

        {addable.length > 0 && (
          <select
            value=""
            disabled={pending || !registered}
            onChange={(e) => {
              const id = e.target.value;
              if (id) setOpenIds((prev) => [...prev, id]);
            }}
            aria-label={m.myJob.addOverride}
            className="h-8 w-fit rounded-md border border-border/60 bg-background/60 px-2 text-[12px] text-foreground"
          >
            <option value="">{m.myJob.addOverride}</option>
            {addable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
