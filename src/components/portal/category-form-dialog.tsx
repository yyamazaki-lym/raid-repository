"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, AlertTriangle, Pencil, Upload, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
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
import {
  ALL_STATUSES,
  type Category,
  type CategoryStatus,
} from "@/lib/supabase/types";
import {
  createCategory,
  updateCategory,
} from "@/lib/categories-client";
import { fetchAvailableGuildRoles } from "@/lib/server/categories-actions";
import type { DiscordGuildRole } from "@/lib/server/discord-roles";
import { cn } from "@/lib/utils";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]?$/;

/**
 * Format an ISO timestamp as `YYYY-MM-DD` for `<input type="date">`,
 * using the user's local timezone. Returns "" for null/invalid input.
 */
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Use local components — `<input type="date">` works in local TZ.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Convert a `<input type="date">` value (`YYYY-MM-DD`) to an ISO timestamp
 * at midnight local time, or null if empty. The timezone offset comes from
 * `Date(...)` so the round-trip with `isoToDateInput` is stable.
 */
function dateInputToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  // Construct as local midnight, not UTC, so the displayed date matches.
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

type Props = {
  /** Existing category for edit mode; omit for create. */
  category?: Category;
  /** Custom trigger (e.g. menu item). Defaults to "+コンテンツ追加" button.
   *  Ignored in controlled mode. */
  trigger?: React.ReactNode;
  /** Controlled-mode open state. When provided, the dialog skips rendering
   *  its own trigger — useful for wiring open/close from outside (e.g. a
   *  dropdown menu item that needs to close the menu before the dialog
   *  opens, avoiding the focus collision that auto-closes the dialog). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CategoryFormDialog({
  category,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const router = useRouter();
  const isEdit = !!category;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [status, setStatus] = useState<CategoryStatus>(
    category?.status ?? "未着手",
  );
  const [mitigationUrl, setMitigationUrl] = useState(
    category?.mitigationSheetUrl ?? "",
  );
  const [lootUrl, setLootUrl] = useState(category?.lootSheetUrl ?? "");
  const [discordStrategy, setDiscordStrategy] = useState(
    category?.discordStrategyChannelId ?? "",
  );
  const [discordVideo, setDiscordVideo] = useState(
    category?.discordVideoChannelId ?? "",
  );
  const [discordEnabled, setDiscordEnabled] = useState(
    category?.discordImportEnabled ?? true,
  );
  // Manual override for the first-clear date. Stored on `categories` as
  // `timestamptz`. UI is `<input type="date">` so the user only deals with
  // a calendar; we serialize the date as midnight local time.
  const [firstClearDate, setFirstClearDate] = useState(
    isoToDateInput(category?.firstClearAt ?? null),
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    category?.backgroundImageUrl ?? "",
  );
  const [uploadingBg, setUploadingBg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO #19: role gating. `selectedRoleIds` is the working set; on save
  // it's persisted as `required_role_ids`. Empty array = open to all
  // guild members. `availableRoles` is fetched from Discord on open via
  // a Server Action (bot-token-backed) — failure leaves an empty list
  // and the section degrades to "ロール一覧を取得できません" hint.
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(
    category?.requiredRoleIds ?? [],
  );
  const [availableRoles, setAvailableRoles] = useState<DiscordGuildRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  const onPickBackgroundFile = () => {
    fileInputRef.current?.click();
  };

  const onBackgroundFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選択してください");
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError("画像サイズは 5MB 以内にしてください");
      return;
    }

    setError(null);
    setUploadingBg(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 8) || "bin";
      const path = `${slug.trim() || "untagged"}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("category-backgrounds")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        setError(`アップロード失敗: ${upErr.message}`);
        return;
      }
      const { data } = supabase.storage
        .from("category-backgrounds")
        .getPublicUrl(path);
      setBackgroundImageUrl(data.publicUrl);
      toast.success("画像をアップロードしました");
    } finally {
      setUploadingBg(false);
    }
  };

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setSlug(category?.slug ?? "");
      setStatus(category?.status ?? "未着手");
      setMitigationUrl(category?.mitigationSheetUrl ?? "");
      setLootUrl(category?.lootSheetUrl ?? "");
      setDiscordStrategy(category?.discordStrategyChannelId ?? "");
      setDiscordVideo(category?.discordVideoChannelId ?? "");
      setDiscordEnabled(category?.discordImportEnabled ?? true);
      setFirstClearDate(isoToDateInput(category?.firstClearAt ?? null));
      setBackgroundImageUrl(category?.backgroundImageUrl ?? "");
      setSelectedRoleIds(category?.requiredRoleIds ?? []);
      setError(null);
    }
  }, [open, category]);

  // Fetch the Discord guild role list once per dialog open. Server Action
  // re-validates auth so we can call it from a client component without
  // exposing the bot token. Failures (missing env, Discord 403/5xx) are
  // swallowed to an empty array — the UI handles that case below.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRolesLoading(true);
    fetchAvailableGuildRoles()
      .then((roles) => {
        if (cancelled) return;
        setAvailableRoles(roles);
      })
      .catch((e) => {
        console.warn("[category-form] fetch roles failed", e);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleRole = (id: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const validateUrl = (raw: string): string | null => {
    if (!raw.trim()) return null;
    if (!/^https?:\/\//i.test(raw))
      return "http:// または https:// で始めてください";
    try {
      new URL(raw);
      return null;
    } catch {
      return "URLの形式が正しくありません";
    }
  };

  const onSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    const trimmedMitigation = mitigationUrl.trim();
    const trimmedLoot = lootUrl.trim();
    const trimmedDiscordStrategy = discordStrategy.trim();
    const trimmedDiscordVideo = discordVideo.trim();
    const trimmedBackgroundImage = backgroundImageUrl.trim();

    if (!trimmedName) return setError("名前を入力してください");
    if (!trimmedSlug || !SLUG_RE.test(trimmedSlug)) {
      return setError(
        "URL識別子は半角英数字とハイフン (a-z 0-9 -) で、3〜42文字で入力してください",
      );
    }
    const mitigationErr = validateUrl(trimmedMitigation);
    if (mitigationErr) return setError("軽減表URL: " + mitigationErr);
    const lootErr = validateUrl(trimmedLoot);
    if (lootErr) return setError("ロット管理URL: " + lootErr);
    const bgImageErr = validateUrl(trimmedBackgroundImage);
    if (bgImageErr) return setError("背景画像URL: " + bgImageErr);

    // Discord channel IDs are 17–20 digit snowflakes.
    const SNOWFLAKE_RE = /^\d{17,20}$/;
    if (trimmedDiscordStrategy && !SNOWFLAKE_RE.test(trimmedDiscordStrategy)) {
      return setError("攻略チャンネルIDは17〜20桁の数字です");
    }
    if (trimmedDiscordVideo && !SNOWFLAKE_RE.test(trimmedDiscordVideo)) {
      return setError("動画チャンネルIDは17〜20桁の数字です");
    }

    setBusy(true);
    const firstClearIso = dateInputToIso(firstClearDate);
    const patch = {
      name: trimmedName,
      slug: trimmedSlug,
      status,
      mitigation_sheet_url: trimmedMitigation || null,
      loot_sheet_url: trimmedLoot || null,
      discord_strategy_channel_id: trimmedDiscordStrategy || null,
      discord_video_channel_id: trimmedDiscordVideo || null,
      discord_import_enabled: discordEnabled,
      first_clear_at: firstClearIso,
      background_image_url: trimmedBackgroundImage || null,
      required_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : null,
    };

    const result = isEdit
      ? await updateCategory(category!.id, patch)
      : await createCategory({
          slug: trimmedSlug,
          name: trimmedName,
          status,
        }).then(async (r) => {
          // After create, set the URLs (and first_clear_at if specified) in
          // a follow-up update so the existing create helper stays focused
          // on the minimal required columns.
          if (!r.ok) return r;
          const followUp: Parameters<typeof updateCategory>[1] = {};
          if (trimmedMitigation) followUp.mitigation_sheet_url = trimmedMitigation;
          if (trimmedLoot) followUp.loot_sheet_url = trimmedLoot;
          if (firstClearIso) followUp.first_clear_at = firstClearIso;
          if (trimmedBackgroundImage)
            followUp.background_image_url = trimmedBackgroundImage;
          if (selectedRoleIds.length > 0)
            followUp.required_role_ids = selectedRoleIds;
          if (Object.keys(followUp).length > 0) {
            await updateCategory(r.category.id, followUp);
          }
          return { ok: true } as const;
        });
    setBusy(false);

    if (!result.ok) {
      setError(
        result.reason.includes("duplicate")
          ? "このURL識別子は既に使用されています"
          : `保存失敗: ${result.reason}`,
      );
      return;
    }

    toast.success(isEdit ? "更新しました" : `「${trimmedName}」を追加しました`);
    setOpen(false);
    // 2.1 (2026-04-29) hot-fix: realtime ハンドラだけだと server-rendered
    // RSC が再実行されないため、ロール制限の追加/解除が UI に即時反映
    // されない事象があった。明示的に server side cache を再評価。
    router.refresh();
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <Plus className="h-3.5 w-3.5" aria-hidden />
      コンテンツ追加
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Skip trigger render entirely in controlled mode — caller owns the
          state, presumably driven by a menu item or other affordance that
          doesn't need a Base UI Trigger wrapper. */}
      {!isControlled &&
        (trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : (
          defaultTrigger
        ))}

      <DialogContent className="glass top-[8svh] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 p-0 sm:top-20 sm:max-w-xl">
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
              {isEdit ? "Edit" : "New"} Category
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isEdit
                ? "コンテンツ情報・スプレッドシートURLを編集"
                : "新しいレイドコンテンツを追加します"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name" className="text-xs text-foreground/80">
              名前
            </Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: アルカディア:ライトヘビー級"
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-slug" className="text-xs text-foreground/80">
              URL識別子
            </Label>
            <Input
              id="category-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="例: arc-lightheavy"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              disabled={isEdit}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              URLパスに使われます — 半角英数字とハイフンのみ。
              {isEdit && "（編集不可）"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-foreground/80">ステータス</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors",
                    status === s
                      ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-foreground"
                      : "border-border bg-background/30 text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label htmlFor="mitigation-url" className="text-xs text-foreground/80">
              軽減表URL（任意）
            </Label>
            <Input
              id="mitigation-url"
              type="url"
              inputMode="url"
              value={mitigationUrl}
              onChange={(e) => setMitigationUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../pubhtml"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              軽減表サブタブで iframe 埋め込み表示されます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loot-url" className="text-xs text-foreground/80">
              ロット管理URL（任意）
            </Label>
            <Input
              id="loot-url"
              type="url"
              inputMode="url"
              value={lootUrl}
              onChange={(e) => setLootUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../pubhtml"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              ロット管理サブタブで iframe 埋め込み表示されます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="discord-strategy"
              className="text-xs text-foreground/80"
            >
              Discord 攻略チャンネルID（任意）
            </Label>
            <Input
              id="discord-strategy"
              inputMode="numeric"
              value={discordStrategy}
              onChange={(e) => setDiscordStrategy(e.target.value)}
              placeholder="例: 1234567890123456789"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              設定すると、毎日1回このチャンネルから URL を自動で攻略情報タブに取り込みます。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video"
              className="text-xs text-foreground/80"
            >
              Discord 動画チャンネルID（任意）
            </Label>
            <Input
              id="discord-video"
              inputMode="numeric"
              value={discordVideo}
              onChange={(e) => setDiscordVideo(e.target.value)}
              placeholder="例: 1234567890123456789"
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              設定すると、毎日1回このチャンネルから URL を自動で動画タブに取り込みます。
              Discord の開発者モードを ON にして、チャンネル名右クリック → IDコピーで取得できます。
            </p>
          </div>

          <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-md border border-border/40 bg-secondary/20 px-3 py-2.5">
            <input
              type="checkbox"
              checked={discordEnabled}
              onChange={(e) => setDiscordEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--neon-cyan)]"
            />
            <div className="flex-1">
              <span className="block text-xs text-foreground/90">
                Discord 取り込みを有効化
              </span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                OFF にすると、このコンテンツは毎日の自動取り込みをスキップします。
                チャンネルID は保存されたままなので、再 ON で即再開可能。
              </p>
            </div>
          </label>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="background-image-url"
              className="text-xs text-foreground/80"
            >
              背景画像（任意）
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="background-image-url"
                type="url"
                inputMode="url"
                value={backgroundImageUrl}
                onChange={(e) => setBackgroundImageUrl(e.target.value)}
                placeholder="https://example.com/path/to/image.jpg"
                className="font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
                disabled={uploadingBg}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onBackgroundFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPickBackgroundFile}
                disabled={uploadingBg}
                className="shrink-0 gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase"
              >
                {uploadingBg ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                {uploadingBg ? "送信中" : "アップロード"}
              </Button>
              {backgroundImageUrl && !uploadingBg && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setBackgroundImageUrl("")}
                  className="shrink-0 font-mono text-[10px] tracking-[0.18em] uppercase"
                >
                  クリア
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              URL を直接指定するか、ローカル画像をアップロード（最大 5MB）。
              コンテンツ一覧のカード背景に表示されます。空欄で無効。
            </p>
            {backgroundImageUrl.trim() &&
              /^https?:\/\//i.test(backgroundImageUrl.trim()) && (
                <div
                  aria-hidden
                  className="mt-1 h-20 w-full overflow-hidden rounded-md border border-border/40 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${backgroundImageUrl.trim()})`,
                  }}
                />
              )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label className="flex items-center gap-1.5 text-xs text-foreground/80">
              <Shield className="h-3 w-3" aria-hidden />
              閲覧可能ロール（任意）
            </Label>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              選択したロールのいずれか 1 つを持つ Discord メンバーのみが、このコンテンツのページを開けます。
              何も選択しなければ全メンバーが閲覧可能です。
            </p>
            {rolesLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ロール一覧を読み込み中…
              </div>
            ) : availableRoles.length === 0 ? (
              <div className="rounded-md border border-border/30 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
                ロール一覧を取得できませんでした
                <span className="opacity-60">
                  （DISCORD_BOT_TOKEN / DISCORD_GUILD_ID 未設定 or bot 権限不足）
                </span>
              </div>
            ) : (
              <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/30 bg-secondary/10 p-1">
                {availableRoles.map((role) => {
                  const checked = selectedRoleIds.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-secondary/30",
                        checked && "bg-[var(--neon-cyan)]/10",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole(role.id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[var(--neon-cyan)]"
                      />
                      {role.color > 0 && (
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/40"
                          style={{
                            backgroundColor: `#${role.color
                              .toString(16)
                              .padStart(6, "0")}`,
                          }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{role.name}</span>
                      {role.managed && (
                        <span className="shrink-0 rounded border border-border/40 px-1 text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                          managed
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {selectedRoleIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedRoleIds([])}
                className="self-start font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase hover:text-foreground"
              >
                選択をクリア
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label htmlFor="first-clear" className="text-xs text-foreground/80">
              初クリア日（任意）
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="first-clear"
                type="date"
                value={firstClearDate}
                onChange={(e) => setFirstClearDate(e.target.value)}
                className="font-mono text-[12px]"
              />
              {firstClearDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFirstClearDate("")}
                  className="font-mono text-[10px] tracking-[0.18em] uppercase"
                >
                  クリア
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              手動入力 or 動画タイトルに「クリア / Clear」が初めて現れた時点で自動登録。
              一度設定された後は自動上書きされません。
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
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
            className="font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={busy}
            className="gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {busy ? "保存中..." : isEdit ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
