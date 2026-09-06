"use client";

import { useEffect, useState } from "react";
import { Plus, Save, AlertTriangle, Pencil, Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCategoryLink,
  updateCategoryLink,
} from "@/lib/category-links-client";
import { httpUrlError } from "@/lib/url-validation";
import type {
  CategoryLink,
  CategoryLinkKind,
} from "@/lib/supabase/types";
import { useLocale, useMessages } from "@/lib/i18n/client";

// Phase 15: kind=image は ImageFormDialog 担当。LinkFormDialog は
// 従来通り strategy / video のみを扱う (Props 型で image / gphoto を除外)。
type Props = {
  categoryId: string;
  kind: Exclude<CategoryLinkKind, "image" | "gphoto">;
  /** Provide an existing link to edit; omit for create mode. */
  link?: CategoryLink;
  /** Custom trigger element (e.g. menu item). Defaults to a primary "追加" button. */
  trigger?: React.ReactNode;
  /** Controlled-mode open state — see CategoryFormDialog for rationale. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Phase 15: kind=image は別 dialog (ImageFormDialog) が扱うので、ここでは
// strategy / video のみ。Exclude で他種別を型から除外し、Record の網羅性
// 警告を回避。Phase 16 で gphoto も除外。
// Phase 17 (2026-05-13): 攻略タブの「攻略リンク追加」ボタンを「リンク追加」に
// 短縮 (Images / Google フォトと並ぶ Action ボタン群で表記を統一)。動画タブ側は
// そのまま「動画」のままで OK (動画ボタンの所在からも自明)。
// ラベルの実体は辞書 `linkForm.kindLabel` (表示言語で切り替わる)。

export function LinkFormDialog({
  categoryId,
  kind,
  link,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const m = useMessages();
  const locale = useLocale();
  const kindLabel = m.linkForm.kindLabel[kind];
  const isEdit = !!link;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  // FFLogs / secondary URL — currently only surfaced for the "video" kind
  // but stored on every CategoryLink row uniformly.
  const [logsUrl, setLogsUrl] = useState(link?.logsUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // onBlur 即時バリデーション (TODO #51 P2-6)。submit を待たずに形式エラー
  // を input 直下 + aria-invalid (赤 border) で知らせる。入力し直しで消す。
  const [urlFieldError, setUrlFieldError] = useState<string | null>(null);
  const [logsFieldError, setLogsFieldError] = useState<string | null>(null);

  // Reset form when opening (handles consecutive opens with stale state).
  useEffect(() => {
    if (open) {
      setTitle(link?.title ?? "");
      setUrl(link?.url ?? "");
      setDescription(link?.description ?? "");
      setLogsUrl(link?.logsUrl ?? "");
      setError(null);
      setUrlFieldError(null);
      setLogsFieldError(null);
    }
  }, [open, link]);

  const onFetchTitle = async () => {
    const u = url.trim();
    if (!u) {
      setError(m.linkForm.enterUrlFirst);
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      setError(m.crud.urlScheme);
      return;
    }
    setError(null);
    setFetchingTitle(true);
    try {
      const res = await fetch(
        "/api/page-title?url=" + encodeURIComponent(u),
      );
      const data = (await res.json()) as { title?: string; error?: string };
      if (!res.ok || !data.title) {
        toast.error(m.linkForm.titleFetchFailed(data.error ?? "no title"));
        return;
      }
      setTitle(data.title);
      toast.success(m.linkForm.titleFetched);
    } catch (e) {
      toast.error(m.linkForm.titleFetchFailed(String(e)));
    } finally {
      setFetchingTitle(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    let t = title.trim();
    const u = url.trim();
    // URL バリデーションを先に通す: タイトル空時の自動取得は URL が valid な前提
    if (!u) return setError(m.linkForm.enterUrl);
    const uErr = httpUrlError(u, locale);
    if (uErr) {
      setUrlFieldError(uErr);
      return setError(m.linkForm.urlPrefix + uErr);
    }

    // Validate optional logs URL.
    const trimmedLogs = logsUrl.trim();
    const logsErr = httpUrlError(trimmedLogs, locale);
    if (logsErr) {
      setLogsFieldError(logsErr);
      return setError(m.linkForm.logsUrlPrefix + logsErr);
    }

    // 2.x: 新規追加でタイトル空なら /api/page-title で自動補完 (kind 不問)。
    // UX 目的: 「URLから取得」ボタンを手動で押す手間を省く。失敗時は
    // 手動入力を促すエラーへフォールバック (編集モードは従来通り空タイトル禁止)。
    if (!t && !isEdit) {
      setFetchingTitle(true);
      try {
        const res = await fetch(
          "/api/page-title?url=" + encodeURIComponent(u),
        );
        const data = (await res.json()) as { title?: string; error?: string };
        if (!res.ok || !data.title) {
          setFetchingTitle(false);
          return setError(m.linkForm.titleFetchFailedManual);
        }
        setTitle(data.title);
        t = data.title.trim();
      } catch (e) {
        setFetchingTitle(false);
        return setError(m.linkForm.titleFetchFailed(String(e)));
      }
      setFetchingTitle(false);
    } else if (!t) {
      return setError(m.linkForm.enterTitle);
    }

    setBusy(true);
    const desc = description.trim() ? description.trim() : null;
    const logs = trimmedLogs || null;
    const result = isEdit
      ? await updateCategoryLink(link!.id, {
          title: t,
          url: u,
          description: desc,
          logs_url: logs,
        })
      : await createCategoryLink({
          categoryId,
          kind,
          title: t,
          url: u,
          description: desc ?? undefined,
          logsUrl: logs,
        });
    setBusy(false);

    if (!result.ok) {
      setError(m.crud.saveFailed(result.reason));
      return;
    }

    toast.success(isEdit ? m.crud.updated : m.linkForm.added(kindLabel));
    setOpen(false);
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 text-[11px] tracking-normal whitespace-nowrap text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {m.linkForm.addTrigger(kindLabel)}
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled &&
        (trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : (
          defaultTrigger
        ))}

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-lg">
        <DialogHeader className="flex-row items-start gap-3 border-b border-border/40 p-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            {isEdit ? (
              <Pencil className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="font-display text-base tracking-[0.16em] uppercase">
              {isEdit ? "Edit" : "Add"} {kind === "video" ? "Video" : "Link"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {kind === "video" ? m.linkForm.descVideo : m.linkForm.descLink}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5">
          {/* URL input first — title fetcher reads it. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-url" className="text-xs text-foreground/80">
              URL
            </Label>
            <Input
              id="link-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlFieldError) setUrlFieldError(null);
              }}
              onBlur={() => setUrlFieldError(httpUrlError(url, locale))}
              aria-invalid={urlFieldError ? true : undefined}
              aria-describedby={urlFieldError ? "link-url-error" : undefined}
              placeholder={
                kind === "video"
                  ? "https://www.youtube.com/watch?v=..."
                  : "https://..."
              }
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {urlFieldError && (
              <p
                id="link-url-error"
                role="alert"
                className="text-destructive text-[11px] leading-relaxed"
              >
                {urlFieldError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="link-title" className="text-xs text-foreground/80">
                {m.linkForm.titleLabel}
              </Label>
              <button
                type="button"
                onClick={onFetchTitle}
                disabled={fetchingTitle || !url.trim()}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/8 px-2 py-0.5 text-[10px] tracking-normal text-[var(--neon-cyan)] transition-colors hover:bg-[var(--neon-cyan)]/15 disabled:opacity-40"
                aria-label={m.linkForm.fetchTitleAria}
              >
                <Wand2 className="h-3 w-3" aria-hidden />
                {fetchingTitle ? m.linkForm.fetching : m.linkForm.fetchFromUrl}
              </button>
            </div>
            <Input
              id="link-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "video"
                  ? m.linkForm.titlePlaceholderVideo
                  : m.linkForm.titlePlaceholderLink
              }
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="link-desc"
              className="text-xs text-foreground/80"
            >
              {m.linkForm.memoLabel}
            </Label>
            <Textarea
              id="link-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === "video"
                  ? m.linkForm.memoPlaceholderVideo
                  : m.linkForm.memoPlaceholderLink
              }
              rows={3}
              className="text-[13px] leading-relaxed"
            />
          </div>

          {kind === "video" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-logs" className="text-xs text-foreground/80">
                {m.linkForm.logsLabel}
              </Label>
              <Input
                id="link-logs"
                type="url"
                inputMode="url"
                value={logsUrl}
                onChange={(e) => {
                  setLogsUrl(e.target.value);
                  if (logsFieldError) setLogsFieldError(null);
                }}
                onBlur={() => setLogsFieldError(httpUrlError(logsUrl, locale))}
                aria-invalid={logsFieldError ? true : undefined}
                aria-describedby={
                  (logsFieldError ? "link-logs-error " : "") + "link-logs-help"
                }
                placeholder="https://www.fflogs.com/reports/..."
                className="font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
              />
              {logsFieldError && (
                <p
                  id="link-logs-error"
                  role="alert"
                  className="text-destructive text-[11px] leading-relaxed"
                >
                  {logsFieldError}
                </p>
              )}
              <p
                id="link-logs-help"
                className="text-muted-foreground text-[11px] leading-relaxed"
              >
                {m.linkForm.logsHelp}
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90"
            >
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                aria-hidden
              />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="-mx-0 -mb-0 mt-0 flex-row items-center justify-end gap-2 rounded-b-xl border-t border-border/40 bg-secondary/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-[11px] tracking-normal"
          >
            {m.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? m.common.saving : isEdit ? m.crud.update : m.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
