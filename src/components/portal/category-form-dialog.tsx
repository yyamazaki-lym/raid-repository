"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Plus,
  Save,
  AlertTriangle,
  Pencil,
  Upload,
  Loader2,
  Shield,
  Hourglass,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_STATUSES,
  CATEGORY_TAB_IDS,
  clampPercent,
  isCategoryTabId,
  type Category,
  type CategoryStatus,
  type CategoryTabId,
} from "@/lib/supabase/types";
import { DEFAULT_SUB_TAB_LABELS } from "@/components/portal/sub-tabs";
import {
  createCategory,
  updateCategory,
} from "@/lib/categories-client";
import {
  fetchDiscordLinkBlocklist,
  removeDiscordLinkBlocklist,
  type CategoryDiscordBlocklistRow,
} from "@/lib/category-links-client";
import { fetchAvailableGuildRoles } from "@/lib/server/categories-actions";
import type { DiscordGuildRole } from "@/lib/server/discord-roles";
import { isOptimizableImageHost } from "@/lib/url-safe";
import { jstMidnightIso, jstYmdString } from "@/lib/jst-date";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/i18n/client";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]?$/;

/**
 * Format an ISO timestamp as `YYYY-MM-DD` for `<input type="date">`.
 * 閲覧者の壁時計ではなく JST 暦日で組み立てる — first_clear_at は JST 暦日
 * 基準で扱う (動画のクリア日ジャンプ等と統一)。Returns "" for null/invalid.
 */
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return jstYmdString(d);
}

/**
 * Convert a `<input type="date">` value (`YYYY-MM-DD`) to an ISO timestamp
 * at **JST midnight**, or null if empty. JST 暦日基準なので `isoToDateInput`
 * との round-trip が閲覧者の TZ に依存せず安定する。
 */
function dateInputToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  return jstMidnightIso(y, m, d);
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
  const m = useMessages();
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
  // 2026-09-03 実機要望「カードに映す位置を指定できないか」。カードは横長で
  // 画像は object-cover で切り取られるため、中央固定だと出したい部分が
  // 切れる。焦点 (object-position の %) を持たせる。50/50 = 中央 = 従来。
  const [bgPos, setBgPos] = useState({
    x: category?.backgroundPosX ?? 50,
    y: category?.backgroundPosY ?? 50,
  });
  const [uploadingBg, setUploadingBg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-06-15: Discord 取り込み除外 URL の管理 (編集時のみ)。<details> を開いた
  // ときに lazy fetch する。null = 未取得。
  const [blocklist, setBlocklist] = useState<
    CategoryDiscordBlocklistRow[] | null
  >(null);
  const [blocklistLoading, setBlocklistLoading] = useState(false);
  const loadBlocklist = async () => {
    if (!category) return;
    setBlocklistLoading(true);
    const r = await fetchDiscordLinkBlocklist(category.id);
    setBlocklistLoading(false);
    if (r.ok) setBlocklist(r.items);
    else toast.error(m.categoryForm.blocklistFetchFailed(r.reason));
  };
  const onRemoveBlocklist = async (id: string) => {
    const r = await removeDiscordLinkBlocklist(id);
    if (!r.ok) {
      toast.error(m.categoryForm.unblockFailed(r.reason));
      return;
    }
    setBlocklist((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    toast.success(m.categoryForm.unblocked);
  };

  // TODO #26 (2.1, 2026-04-29): 自由記述の説明文。空欄なら DB 保存時 null。
  const [description, setDescription] = useState(category?.description ?? "");

  // TODO #25 (2.1, 2026-04-29): クリアまでの累計時間 (秒) の手動入力。
  // UI は時間/分の 2 入力で扱い、秒換算で保存。両方 0/空 → null として
  // 保存し、自動計算 (動画 duration 集計) を優先させる。
  const initialManualHours = category?.manualTimeToClearSeconds
    ? Math.floor(category.manualTimeToClearSeconds / 3600)
    : 0;
  const initialManualMinutes = category?.manualTimeToClearSeconds
    ? Math.floor((category.manualTimeToClearSeconds % 3600) / 60)
    : 0;
  const [manualHours, setManualHours] = useState<string>(
    initialManualHours > 0 ? String(initialManualHours) : "",
  );
  const [manualMinutes, setManualMinutes] = useState<string>(
    initialManualMinutes > 0 ? String(initialManualMinutes) : "",
  );

  // TODO #45 (2.1, 2026-04-29): FFLogs auto-link 用カスタムマッチワード。
  // カンマ区切りで textarea に表示、保存時に分割 + trim + 重複除去。
  // 空文字なら null として保存し従来挙動に戻す。
  const matchKeywordsToString = (kws: string[] | null | undefined) =>
    (kws ?? []).join(", ");
  const [matchKeywordsInput, setMatchKeywordsInput] = useState<string>(
    matchKeywordsToString(category?.fflogsMatchKeywords),
  );

  // Phase 13 (2.1, 2026-05-13): Discord 取り込みフィルタワード (kind 別)。
  // カンマ区切り入力 → string[] (trim+空除去+重複排除) で保存。空 → DB は NULL
  // (= フィルタ無効 = 従来通り全件取り込み)。文字列 ↔ 配列の変換は
  // `matchKeywordsToString` (fflogs と同形) を流用。
  const [videoFilterInput, setVideoFilterInput] = useState<string>(
    matchKeywordsToString(category?.discordVideoFilterKeywords),
  );
  const [strategyFilterInput, setStrategyFilterInput] = useState<string>(
    matchKeywordsToString(category?.discordStrategyFilterKeywords),
  );


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

  // Phase 17 (2026-05-13): カテゴリカードから飛ぶ既定タブと、SubTabs 表示
  // 設定 (ON/OFF + ラベル上書き)。tabSettings は UI 内部用の Record。
  type TabSetting = { enabled: boolean; label: string };
  const buildInitialTabSettings = (
    cfg: Category["tabConfig"] | undefined,
  ): Record<CategoryTabId, TabSetting> => {
    const out = {} as Record<CategoryTabId, TabSetting>;
    for (const id of CATEGORY_TAB_IDS) {
      const c = cfg?.[id];
      out[id] = {
        enabled: c?.enabled !== false,
        label: typeof c?.label === "string" ? c.label : "",
      };
    }
    return out;
  };
  const [defaultTab, setDefaultTab] = useState<CategoryTabId>(
    category?.defaultTab && isCategoryTabId(category.defaultTab)
      ? category.defaultTab
      : "mitigation",
  );
  const [tabSettings, setTabSettings] = useState<
    Record<CategoryTabId, TabSetting>
  >(buildInitialTabSettings(category?.tabConfig));

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
      setError(m.upload.selectImageFile);
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError(m.upload.maxSize);
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
        setError(m.upload.failed(upErr.message));
        return;
      }
      const { data } = supabase.storage
        .from("category-backgrounds")
        .getPublicUrl(path);
      setBackgroundImageUrl(data.publicUrl);
      toast.success(m.upload.done);
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
      setBgPos({
        x: category?.backgroundPosX ?? 50,
        y: category?.backgroundPosY ?? 50,
      });
      setSelectedRoleIds(category?.requiredRoleIds ?? []);
      setDescription(category?.description ?? "");
      const ih = category?.manualTimeToClearSeconds
        ? Math.floor(category.manualTimeToClearSeconds / 3600)
        : 0;
      const im = category?.manualTimeToClearSeconds
        ? Math.floor((category.manualTimeToClearSeconds % 3600) / 60)
        : 0;
      setManualHours(ih > 0 ? String(ih) : "");
      setManualMinutes(im > 0 ? String(im) : "");
      setMatchKeywordsInput(
        matchKeywordsToString(category?.fflogsMatchKeywords),
      );
      setVideoFilterInput(
        matchKeywordsToString(category?.discordVideoFilterKeywords),
      );
      setStrategyFilterInput(
        matchKeywordsToString(category?.discordStrategyFilterKeywords),
      );
      setDefaultTab(
        category?.defaultTab && isCategoryTabId(category.defaultTab)
          ? category.defaultTab
          : "mitigation",
      );
      setTabSettings(buildInitialTabSettings(category?.tabConfig));
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
    if (!/^https?:\/\//i.test(raw)) return m.categoryForm.urlScheme;
    try {
      new URL(raw);
      return null;
    } catch {
      return m.crud.invalidUrl;
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

    if (!trimmedName) return setError(m.categoryForm.enterName);
    if (!trimmedSlug || !SLUG_RE.test(trimmedSlug)) {
      return setError(m.categoryForm.slugInvalid);
    }
    const mitigationErr = validateUrl(trimmedMitigation);
    if (mitigationErr)
      return setError(m.categoryForm.mitigationUrlPrefix + mitigationErr);
    const lootErr = validateUrl(trimmedLoot);
    if (lootErr) return setError(m.categoryForm.lootUrlPrefix + lootErr);
    const bgImageErr = validateUrl(trimmedBackgroundImage);
    if (bgImageErr) return setError(m.categoryForm.bgUrlPrefix + bgImageErr);

    // Discord channel IDs are 17–20 digit snowflakes.
    const SNOWFLAKE_RE = /^\d{17,20}$/;
    if (trimmedDiscordStrategy && !SNOWFLAKE_RE.test(trimmedDiscordStrategy)) {
      return setError(m.categoryForm.strategyChannelInvalid);
    }
    if (trimmedDiscordVideo && !SNOWFLAKE_RE.test(trimmedDiscordVideo)) {
      return setError(m.categoryForm.videoChannelInvalid);
    }

    setBusy(true);
    const firstClearIso = dateInputToIso(firstClearDate);
    // TODO #25: 手動クリア時間。両方とも空 (or 0) のときは null として保存し、
    // 自動計算側を優先させる。負値 / 非数値は 0 扱い。
    const hourNum = Number.parseInt(manualHours.trim() || "0", 10);
    const minuteNum = Number.parseInt(manualMinutes.trim() || "0", 10);
    const safeHour = Number.isFinite(hourNum) && hourNum >= 0 ? hourNum : 0;
    const safeMinute =
      Number.isFinite(minuteNum) && minuteNum >= 0 ? minuteNum : 0;
    const manualSeconds = safeHour * 3600 + safeMinute * 60;
    const trimmedDescription = description.trim();
    // TODO #45 (2.1): カンマ区切り文字列 → string[] 変換。trim、空除去、重複除去。
    const parseCsvKeywords = (raw: string): string[] =>
      Array.from(
        new Set(
          raw.split(/[,、，\n]/).map((s) => s.trim()).filter((s) => s.length > 0),
        ),
      );
    const parsedKeywords = parseCsvKeywords(matchKeywordsInput);
    // Phase 13 (2.1, 2026-05-13): Discord 取り込みフィルタ (kind 別) も同じパース。
    const parsedVideoFilter = parseCsvKeywords(videoFilterInput);
    const parsedStrategyFilter = parseCsvKeywords(strategyFilterInput);

    // Phase 17 (2026-05-13): tab_config を patch 用に組み立てる。デフォルト
    // 状態 (enabled=true, label 空) のキーは jsonb に残しても害はないが、
    // 「設定されたタブだけ」を残す方が読み取り側でデフォルトとの差分を
    // 見つけやすいので、デフォルト状態の key は省いて保存する。
    const tabConfigPatch: Record<
      string,
      { enabled?: boolean; label?: string | null }
    > = {};
    for (const id of CATEGORY_TAB_IDS) {
      const s = tabSettings[id];
      const trimmedLabel = s.label.trim();
      const isDefault = s.enabled && !trimmedLabel;
      if (isDefault) continue;
      tabConfigPatch[id] = {
        enabled: s.enabled,
        label: trimmedLabel ? trimmedLabel : null,
      };
    }
    // defaultTab が disabled になっている場合は最初の enabled タブに
    // フォールバック。それも無ければ mitigation。
    const defaultTabValid =
      tabSettings[defaultTab]?.enabled !== false ? defaultTab : null;
    const firstEnabled = (CATEGORY_TAB_IDS.find(
      (id) => tabSettings[id].enabled !== false,
    ) ?? "mitigation") as CategoryTabId;
    const effectiveDefaultTab: CategoryTabId =
      defaultTabValid ?? firstEnabled;

    // 背景画像の焦点。0-100 の整数にクランプし、中央は NULL に落とす。
    const bgPosPatch = {
      x: clampPercent(bgPos.x) === 50 ? null : clampPercent(bgPos.x),
      y: clampPercent(bgPos.y) === 50 ? null : clampPercent(bgPos.y),
    };

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
      // 中央 (50/50) は「未設定」と同義なので NULL で保存して行を汚さない。
      background_pos_x: bgPosPatch.x,
      background_pos_y: bgPosPatch.y,
      required_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : null,
      description: trimmedDescription || null,
      manual_time_to_clear_seconds: manualSeconds > 0 ? manualSeconds : null,
      fflogs_match_keywords: parsedKeywords.length > 0 ? parsedKeywords : null,
      discord_video_filter_keywords:
        parsedVideoFilter.length > 0 ? parsedVideoFilter : null,
      discord_strategy_filter_keywords:
        parsedStrategyFilter.length > 0 ? parsedStrategyFilter : null,
      default_tab: effectiveDefaultTab,
      tab_config: tabConfigPatch,
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
          if (bgPosPatch.x !== null) followUp.background_pos_x = bgPosPatch.x;
          if (bgPosPatch.y !== null) followUp.background_pos_y = bgPosPatch.y;
          if (selectedRoleIds.length > 0)
            followUp.required_role_ids = selectedRoleIds;
          if (trimmedDescription) followUp.description = trimmedDescription;
          if (manualSeconds > 0)
            followUp.manual_time_to_clear_seconds = manualSeconds;
          if (parsedKeywords.length > 0)
            followUp.fflogs_match_keywords = parsedKeywords;
          if (parsedVideoFilter.length > 0)
            followUp.discord_video_filter_keywords = parsedVideoFilter;
          if (parsedStrategyFilter.length > 0)
            followUp.discord_strategy_filter_keywords = parsedStrategyFilter;
          if (Object.keys(followUp).length > 0) {
            await updateCategory(r.category.id, followUp);
          }
          return { ok: true } as const;
        });
    setBusy(false);

    if (!result.ok) {
      setError(
        result.reason.includes("duplicate")
          ? m.categoryForm.slugDuplicate
          : m.crud.saveFailed(result.reason),
      );
      return;
    }

    toast.success(
      isEdit ? m.crud.updated : m.categoryForm.created(trimmedName),
    );
    setOpen(false);
    // 2.1 (2026-04-29) hot-fix: realtime ハンドラだけだと server-rendered
    // RSC が再実行されないため、ロール制限の追加/解除が UI に即時反映
    // されない事象があった。明示的に server side cache を再評価。
    router.refresh();
  };

  const defaultTrigger = (
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {m.categoryForm.addTrigger}
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
              {isEdit ? m.categoryForm.descEdit : m.categoryForm.descNew}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70svh] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name" className="text-xs text-foreground/80">
              {m.categoryForm.nameLabel}
            </Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.categoryForm.namePlaceholder}
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-slug" className="text-xs text-foreground/80">
              {m.categoryForm.slugLabel}
            </Label>
            <Input
              id="category-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={m.categoryForm.slugPlaceholder}
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              disabled={isEdit}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.slugHelp}
              {isEdit && m.categoryForm.slugReadOnly}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-description" className="text-xs text-foreground/80">
              {m.categoryForm.descriptionLabel}
            </Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={m.categoryForm.descriptionPlaceholder}
              rows={2}
              className="text-sm"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.descriptionHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-foreground/80">
              {m.categoryForm.statusHeading}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] tracking-normal transition-colors",
                    status === s
                      ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-foreground"
                      : "border-border bg-background/30 text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {m.categoryForm.statusLabel(s)}
                </button>
              ))}
            </div>
          </div>

          {/* Phase 17 (2026-05-13): タブ設定。カテゴリカードから飛ぶ既定タブと、
              各 SubTab の表示 ON/OFF + ラベル上書き。details で折りたためる。 */}
          <details className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <summary className="cursor-pointer select-none text-xs text-foreground/80">
              {m.categoryForm.tabSettingsSummary}
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-foreground/80">
                  {m.categoryForm.defaultTabLabel}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_TAB_IDS.map((id) => {
                    const labelOverride = tabSettings[id].label.trim();
                    const label = labelOverride
                      ? labelOverride
                      : (m.categories.tabs[id] ?? DEFAULT_SUB_TAB_LABELS[id]);
                    const disabled = tabSettings[id].enabled === false;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={defaultTab === id}
                        onClick={() => setDefaultTab(id)}
                        disabled={disabled}
                        title={
                          disabled ? m.categoryForm.tabHiddenTitle : undefined
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] tracking-normal transition-colors",
                          defaultTab === id
                            ? "border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-foreground"
                            : "border-border bg-background/30 text-muted-foreground hover:text-foreground/80",
                          disabled && "opacity-40",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {m.categoryForm.defaultTabHelp}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs text-foreground/80">
                  {m.categoryForm.tabVisibilityLabel}
                </Label>
                <ul className="flex flex-col gap-2">
                  {CATEGORY_TAB_IDS.map((id) => {
                    const s = tabSettings[id];
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-sm border border-border/40 bg-background/30 p-2"
                      >
                        <label className="inline-flex items-center gap-1.5 text-[11px] tracking-normal">
                          <input
                            type="checkbox"
                            checked={s.enabled}
                            onChange={(e) =>
                              setTabSettings((prev) => ({
                                ...prev,
                                [id]: { ...prev[id], enabled: e.target.checked },
                              }))
                            }
                            className="h-3.5 w-3.5 cursor-pointer accent-[var(--neon-cyan)]"
                          />
                          <span className="w-16 text-muted-foreground">
                            {m.categories.tabs[id] ?? DEFAULT_SUB_TAB_LABELS[id]}
                          </span>
                        </label>
                        <Input
                          type="text"
                          value={s.label}
                          onChange={(e) =>
                            setTabSettings((prev) => ({
                              ...prev,
                              [id]: { ...prev[id], label: e.target.value },
                            }))
                          }
                          placeholder={m.categoryForm.tabRenamePlaceholder(
                            m.categories.tabs[id] ?? DEFAULT_SUB_TAB_LABELS[id],
                          )}
                          className="text-[11px] tracking-normal"
                          disabled={!s.enabled}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </details>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label htmlFor="mitigation-url" className="text-xs text-foreground/80">
              {m.categoryForm.mitigationUrlLabel}
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
              {m.categoryForm.mitigationUrlHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loot-url" className="text-xs text-foreground/80">
              {m.categoryForm.lootUrlLabel}
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
              {m.categoryForm.lootUrlHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="discord-strategy"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.strategyChannelLabel}
            </Label>
            <Input
              id="discord-strategy"
              inputMode="numeric"
              value={discordStrategy}
              onChange={(e) => setDiscordStrategy(e.target.value)}
              placeholder={m.categoryForm.channelPlaceholder}
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.strategyChannelHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-strategy-filter"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.strategyFilterLabel}
            </Label>
            <Input
              id="discord-strategy-filter"
              value={strategyFilterInput}
              onChange={(e) => setStrategyFilterInput(e.target.value)}
              placeholder={m.categoryForm.strategyFilterPlaceholder}
              className="text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.strategyFilterHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.videoChannelLabel}
            </Label>
            {/* 動画ch だけ、フィルタワード説明にタイトル判定の有効化を明記 */}
            <Input
              id="discord-video"
              inputMode="numeric"
              value={discordVideo}
              onChange={(e) => setDiscordVideo(e.target.value)}
              placeholder={m.categoryForm.channelPlaceholder}
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.videoChannelHelp}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video-filter"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.videoFilterLabel}
            </Label>
            <Input
              id="discord-video-filter"
              value={videoFilterInput}
              onChange={(e) => setVideoFilterInput(e.target.value)}
              placeholder={m.categoryForm.videoFilterPlaceholder}
              className="text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.videoFilterHelp}
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
                {m.categoryForm.discordEnabledLabel}
              </span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                {m.categoryForm.discordEnabledHelp}
              </p>
            </div>
          </label>

          {isEdit && (
            <details
              className="rounded-md border border-border/40 bg-secondary/15 px-3 py-2"
              onToggle={(e) => {
                if (
                  (e.currentTarget as HTMLDetailsElement).open &&
                  blocklist === null
                ) {
                  void loadBlocklist();
                }
              }}
            >
              <summary className="cursor-pointer text-xs text-foreground/80">
                {m.categoryForm.blocklistSummary}
                {blocklist ? `（${blocklist.length}）` : ""}
              </summary>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                {m.categoryForm.blocklistHelp}
              </p>
              {blocklistLoading ? (
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {m.common.loading}
                </p>
              ) : blocklist && blocklist.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {blocklist.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-2 rounded-sm border border-border/40 bg-background/30 px-2 py-1"
                    >
                      <span
                        className="flex-1 truncate font-mono text-[11px] text-foreground/80"
                        title={b.url}
                      >
                        {b.url}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveBlocklist(b.id)}
                        className="shrink-0 rounded-md border border-border/50 px-2 py-0.5 text-[10px] tracking-normal text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                      >
                        {m.categoryForm.unblock}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : blocklist ? (
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {m.categoryForm.blocklistEmpty}
                </p>
              ) : null}
            </details>
          )}

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="background-image-url"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.bgLabel}
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
                className="shrink-0 gap-1.5 text-[10px] tracking-normal"
              >
                {uploadingBg ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                {uploadingBg ? m.upload.sending : m.upload.button}
              </Button>
              {backgroundImageUrl && !uploadingBg && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setBackgroundImageUrl("")}
                  className="shrink-0 text-[10px] tracking-normal"
                >
                  {m.common.clear}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.bgHelp}
            </p>
            {backgroundImageUrl.trim() &&
              /^https?:\/\//i.test(backgroundImageUrl.trim()) && (
                <BackgroundFocalPicker
                  url={backgroundImageUrl.trim()}
                  pos={bgPos}
                  onChange={setBgPos}
                />
              )}
          </div>

          {/* 2.1 (2026-04-29): 閲覧可能ロールは大きい UI なので初期状態で
              折りたたむ。`<details>` (open 属性なし) で素直な native 折り
              たたみ。選択済みロールがある場合は要素数バッジを summary に
              出して「設定中ですよ」のヒントを残す。 */}
          <details className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground/80 list-none [&::-webkit-details-marker]:hidden">
              <Shield className="h-3 w-3" aria-hidden />
              {m.categoryForm.rolesSummary}
              {selectedRoleIds.length > 0 && (
                <span className="inline-flex items-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 px-1.5 py-px text-[9px] tracking-normal text-[var(--neon-cyan)]">
                  {m.categoryForm.rolesSelected(selectedRoleIds.length)}
                </span>
              )}
              <span className="ml-auto text-[10px] tracking-normal text-muted-foreground">
                {m.categoryForm.clickToExpand}
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                {m.categoryForm.rolesHelp}
              </p>
              {rolesLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {m.categoryForm.rolesLoading}
                </div>
              ) : availableRoles.length === 0 ? (
                <div className="rounded-md border border-border/30 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
                  {m.categoryForm.rolesUnavailable}
                  <span className="opacity-60">
                    {m.categoryForm.rolesUnavailableHint}
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
                  className="self-start text-[10px] tracking-normal text-muted-foreground hover:text-foreground"
                >
                  {m.categoryForm.clearSelection}
                </button>
              )}
            </div>
          </details>

          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label htmlFor="first-clear" className="text-xs text-foreground/80">
              {m.categoryForm.firstClearLabel}
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
                  className="text-[10px] tracking-normal"
                >
                  {m.common.clear}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.firstClearHelp}
            </p>
          </div>

          {/* TODO #25 (2.1, 2026-04-29): 手動クリア時間 (累計練習時間) 入力欄。
              空欄 / 0 のままなら自動計算 (動画 duration 集計) を優先表示。 */}
          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label className="flex items-center gap-1.5 text-xs text-foreground/80">
              <Hourglass className="h-3 w-3" aria-hidden />
              {m.categoryForm.manualClearLabel}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="manual-clear-hours"
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                value={manualHours}
                onChange={(e) => setManualHours(e.target.value)}
                placeholder="0"
                className="w-20 font-mono text-[12px]"
                autoComplete="off"
              />
              <span className="text-xs text-muted-foreground">
                {m.categoryForm.hours}
              </span>
              <Input
                id="manual-clear-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={manualMinutes}
                onChange={(e) => setManualMinutes(e.target.value)}
                placeholder="0"
                className="w-20 font-mono text-[12px]"
                autoComplete="off"
              />
              <span className="text-xs text-muted-foreground">
                {m.categoryForm.minutes}
              </span>
              {(manualHours.trim() || manualMinutes.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setManualHours("");
                    setManualMinutes("");
                  }}
                  className="text-[10px] tracking-normal"
                >
                  {m.common.clear}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.manualClearHelp}
            </p>
          </div>

          {/* TODO #45 (2.1, 2026-04-29): FFLogs auto-link カスタムマッチ
              ワード。標準キーワード (CONTENT_GROUPS) で分類できないユーザー
              独自の report 命名 (例: 「4 層しょーか」「LH しょか」) を
              紐づくよう救済する escape hatch。空欄なら従来挙動。 */}
          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label
              htmlFor="fflogs-match-keywords"
              className="text-xs text-foreground/80"
            >
              {m.categoryForm.fflogsKeywordsLabel}
            </Label>
            <Textarea
              id="fflogs-match-keywords"
              value={matchKeywordsInput}
              onChange={(e) => setMatchKeywordsInput(e.target.value)}
              placeholder={m.categoryForm.fflogsKeywordsPlaceholder}
              className="min-h-[2.4rem] text-[12px] leading-relaxed"
              autoComplete="off"
              spellCheck={false}
              rows={2}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {m.categoryForm.fflogsKeywordsHelp}
            </p>
          </div>

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

/**
 * 背景画像の焦点ピッカー (2026-09-03 実機要望「カードに映す位置を
 * 指定できないか」)。
 *
 * カードは横長 (おおよそ 5:2) で、背景画像は `object-cover` で切り取られる。
 * 既定は中央固定なので、縦長の画像だと出したい部分 (顔など) が切れていた。
 *
 * 操作は **カードと同じ比率のプレビューを直接クリック / ドラッグ** して
 * 表示を寄せる方式にした。「どこが映るか」を見ながら決められるのが要点。
 * 値は CSS の `object-position` そのままなので、意味は「画像の X%/Y% の点を
 * カードの X%/Y% の位置に合わせる」= 上をクリックすれば画像の上の方が出る
 * (クリックした点が中心に来るわけではない)。
 * キーボード操作と微調整のために横/縦のスライダーも併置する
 * (プレビューの div 自体はポインタ専用なので、スライダー側が
 * アクセシブルな入口になる)。
 */
function BackgroundFocalPicker({
  url,
  pos,
  onChange,
}: {
  url: string;
  pos: { x: number; y: number };
  onChange: (pos: { x: number; y: number }) => void;
}) {
  const m = useMessages();
  const isCenter = pos.x === 50 && pos.y === 50;

  const setFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onChange({
      x: clampPercent(((e.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((e.clientY - rect.top) / rect.height) * 100),
    });
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {/* aspect-[5/2] = コンテンツ一覧のカードのおおよその形。完全一致では
          ないので「目安」と明記する (カードの高さは中身で伸縮する)。 */}
      <div
        className="relative aspect-[5/2] w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-border/40"
        title={m.categoryForm.focalTitle}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e);
        }}
      >
        <Image
          src={url}
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          unoptimized={!isOptimizableImageHost(url)}
          className="pointer-events-none object-cover"
          style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
        />
        {/* 焦点マーカー。画像の明暗どちらでも見えるよう白リング + 影。 */}
        <span
          aria-hidden
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
        />
      </div>
      <div className="flex flex-col gap-1">
        {(
          [
            { axis: "x" as const, label: m.categoryForm.focalX },
            { axis: "y" as const, label: m.categoryForm.focalY },
          ]
        ).map(({ axis, label }) => (
          <div key={axis} className="flex items-center gap-2">
            <Label
              htmlFor={`bg-pos-${axis}`}
              className="w-12 shrink-0 text-[11px] text-muted-foreground"
            >
              {label}
            </Label>
            <input
              id={`bg-pos-${axis}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={pos[axis]}
              onChange={(e) =>
                onChange({ ...pos, [axis]: clampPercent(e.target.value) })
              }
              className="h-1.5 min-w-0 flex-1 accent-[var(--neon-cyan)]"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[11px] text-foreground/75 tabular-nums">
              {pos[axis]}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {m.categoryForm.focalHelp}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isCenter}
          onClick={() => onChange({ x: 50, y: 50 })}
          className="shrink-0 text-[10px] tracking-normal"
        >
          {m.categoryForm.focalReset}
        </Button>
      </div>
    </div>
  );
}
