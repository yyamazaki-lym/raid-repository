"use client";

import { useState, useTransition } from "react";
import { Check, Eye, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/lib/i18n/client";
import {
  LINK_TAG_MAX_LENGTH,
  linkTagToneClass,
  sameLinkTag,
  suggestLinkTags,
} from "@/lib/link-tags";
import type { LinkReadState } from "@/lib/supabase/category-link-reads";
import {
  addCategoryLinkTagAction,
  removeCategoryLinkTagAction,
  setCategoryLinkReadAction,
} from "@/lib/server/category-link-actions";

/**
 * 攻略リンクカードの下段: 既読 (W-27) + タグ (B-1)。2026-09-07。
 *
 * ## 既読 (W-27)
 *
 * 「共有した攻略情報が読まれない」への対応。出すのは
 *   - 自分の既読トグル
 *   - 「未読 n 人」
 *   - admin だけ hover で未読メンバーの名前
 * の 3 つだけ。誰が読んだかの一覧は**出さない** — 監視感を避けるためで、
 * データの出口 (`fetchCategoryLinkReads`) でも生データを落としている。
 *
 * ## タグ (B-1)
 *
 * チップはクリックで絞り込み (誰でも)。付け外しは admin のみ。追加時は
 * タイトル / URL から `suggestLinkTags()` が出した候補をワンタップで
 * 入れられる (候補止まりで、自動では付けない)。
 *
 * 楽観更新はしない。既読も タグも server の値を単一の真実にして
 * `router.refresh()` 相当 (Server Action の `revalidatePath`) を待つ —
 * 「未読 n 人」は他人の状態を含む集計なので、client 側で正しく先読み
 * できない (自分の分だけ引いても admin 向けの名前一覧が合わなくなる)。
 */
export function LinkCardFooter({
  linkId,
  title,
  url,
  tags,
  readState,
  canEdit,
  selectedTags,
  onToggleTagFilter,
}: {
  linkId: string;
  title: string;
  url: string;
  /** このリンクに付いているタグ (label 昇順)。 */
  tags: ReadonlyArray<string>;
  /** 既読状態。null = 取得できなかった (メンバー表未設定など)。 */
  readState: LinkReadState | null;
  canEdit: boolean;
  /** 絞り込みで選択中のタグ (チップの見た目に反映)。 */
  selectedTags: ReadonlyArray<string>;
  onToggleTagFilter: (label: string) => void;
}) {
  const m = useMessages();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const suggestions = adding ? suggestLinkTags(title, url, tags) : [];

  const setRead = (next: boolean) => {
    startTransition(async () => {
      const result = await setCategoryLinkReadAction(linkId, next);
      if (!result.ok) toast.error(m.linkCard.readFailed(result.reason));
    });
  };

  const addTag = (label: string) => {
    const value = label.trim();
    if (!value) return;
    setDraft("");
    setAdding(false);
    startTransition(async () => {
      const result = await addCategoryLinkTagAction(linkId, value);
      if (!result.ok) toast.error(m.linkCard.tagFailed(result.reason));
    });
  };

  const removeTag = (label: string) => {
    startTransition(async () => {
      const result = await removeCategoryLinkTagAction(linkId, label);
      if (!result.ok) toast.error(m.linkCard.tagFailed(result.reason));
    });
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((label) => {
          const active = selectedTags.some((s) => sameLinkTag(s, label));
          return (
            <span
              key={label}
              className={
                "inline-flex items-center gap-0.5 rounded-sm border font-mono text-[10px] whitespace-nowrap " +
                linkTagToneClass(label) +
                (active ? " ring-1 ring-[var(--neon-cyan)]/70" : "")
              }
            >
              <button
                type="button"
                onClick={() => onToggleTagFilter(label)}
                title={m.linkCard.filterByTagTitle(label)}
                className="px-1.5 py-0.5 transition-opacity hover:opacity-80"
              >
                {label}
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeTag(label)}
                  disabled={pending}
                  aria-label={m.linkCard.removeTagAria(label)}
                  className="pr-1 opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
                >
                  <X className="h-2.5 w-2.5" aria-hidden />
                </button>
              )}
            </span>
          );
        })}
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            title={m.linkCard.addTagTitle}
            className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/45 hover:text-foreground"
          >
            <Tag className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {m.linkCard.addTag}
          </button>
        )}
      </div>

      {canEdit && adding && (
        <div className="flex flex-col gap-1 rounded-sm border border-border/50 bg-secondary/20 p-1.5">
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={draft}
              maxLength={LINK_TAG_MAX_LENGTH}
              aria-label={m.linkCard.tagInputLabel}
              placeholder={m.linkCard.tagPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(draft);
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              className="h-7 text-xs"
            />
            <button
              type="button"
              onClick={() => addTag(draft)}
              disabled={pending || !draft.trim()}
              aria-label={m.linkCard.addTag}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              aria-label={m.common.cancel}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {/* 候補はワンタップで入る。自動では付けない (タイトルの書き方に
              依存するので、外れたタグが溜まると絞り込みが使えなくなる)。 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
              {m.linkCard.tagSuggestions}
            </span>
            {suggestions.length === 0 ? (
              <span className="text-[10px] text-muted-foreground/70">
                {m.linkCard.tagNoSuggestions}
              </span>
            ) : (
              suggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => addTag(label)}
                  disabled={pending}
                  className={
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-40 " +
                    linkTagToneClass(label)
                  }
                >
                  + {label}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {readState && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRead(!readState.read)}
            disabled={pending}
            title={readState.read ? m.linkCard.unreadTitle : m.linkCard.markReadTitle}
            className={
              "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-colors disabled:opacity-50 " +
              (readState.read
                ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                : "border-border/60 text-muted-foreground hover:border-emerald-400/40 hover:text-emerald-200")
            }
          >
            {readState.read ? (
              <Check className="h-2.5 w-2.5 shrink-0" aria-hidden />
            ) : (
              <Eye className="h-2.5 w-2.5 shrink-0" aria-hidden />
            )}
            {readState.read ? m.linkCard.read : m.linkCard.markRead}
          </button>
          {/* メンバー表が未設定 (members=0) のときは人数を出さない —
              母数が無いので「未読 0 人」が「全員読んだ」と誤読される。 */}
          {readState.members > 0 &&
            (readState.unread === 0 ? (
              <span className="font-mono text-[10px] whitespace-nowrap text-emerald-200/70">
                {m.linkCard.allRead}
              </span>
            ) : (
              <span
                className="font-mono text-[10px] whitespace-nowrap text-amber-200/80"
                title={
                  readState.unreadNames && readState.unreadNames.length > 0
                    ? m.linkCard.unreadNamesTitle(readState.unreadNames.join(", "))
                    : m.linkCard.unreadCountTitle
                }
              >
                {m.linkCard.unreadCount(readState.unread)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
