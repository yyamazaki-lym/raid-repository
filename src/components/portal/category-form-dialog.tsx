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
    else toast.error("除外 URL 取得失敗: " + r.reason);
  };
  const onRemoveBlocklist = async (id: string) => {
    const r = await removeDiscordLinkBlocklist(id);
    if (!r.ok) {
      toast.error("解除失敗: " + r.reason);
      return;
    }
    setBlocklist((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    toast.success("除外を解除しました（次回取り込みから対象に戻ります）");
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
    <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-3 py-1.5 text-[11px] tracking-normal text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground">
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
                ? "コンテンツの情報・URL・ロール制限・クリア記録などを編集"
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
            <Label htmlFor="category-description" className="text-xs text-foreground/80">
              説明文（任意）
            </Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 絶アレキサンダー討滅戦 — 2024 年から練習開始"
              rows={2}
              className="text-sm"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              コンテンツ詳細ページ上部に表示されます。空欄なら非表示。
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
                    "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] tracking-normal transition-colors",
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

          {/* Phase 17 (2026-05-13): タブ設定。カテゴリカードから飛ぶ既定タブと、
              各 SubTab の表示 ON/OFF + ラベル上書き。details で折りたためる。 */}
          <details className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <summary className="cursor-pointer select-none text-xs text-foreground/80">
              タブ設定（既定タブ・表示 ON/OFF・名前変更）
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-foreground/80">
                  カテゴリカードから最初に開くタブ
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_TAB_IDS.map((id) => {
                    const labelOverride = tabSettings[id].label.trim();
                    const label = labelOverride
                      ? labelOverride
                      : DEFAULT_SUB_TAB_LABELS[id];
                    const disabled = tabSettings[id].enabled === false;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDefaultTab(id)}
                        disabled={disabled}
                        title={
                          disabled
                            ? "このタブは非表示に設定されています"
                            : undefined
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
                  カテゴリカードをクリックしたときの遷移先。非表示タブを既定にすると、
                  保存時に表示されているタブの先頭にフォールバックします。
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs text-foreground/80">
                  各タブの表示 ON/OFF と名前
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
                            {DEFAULT_SUB_TAB_LABELS[id]}
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
                          placeholder={`名前を変更（空欄＝既定「${DEFAULT_SUB_TAB_LABELS[id]}」）`}
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
              htmlFor="discord-strategy-filter"
              className="text-xs text-foreground/80"
            >
              攻略 取り込みフィルタワード（任意）
            </Label>
            <Input
              id="discord-strategy-filter"
              value={strategyFilterInput}
              onChange={(e) => setStrategyFilterInput(e.target.value)}
              placeholder="例: 軽減, ロット, 動き"
              className="text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              カンマ区切りで複数指定可。いずれかがメッセージ本文または URL に含まれる投稿だけを取り込みます。空欄なら全件取り込み（従来通り）。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video"
              className="text-xs text-foreground/80"
            >
              Discord 動画チャンネルID（任意）
            </Label>
            {/* 動画ch だけ、フィルタワード説明にタイトル判定の有効化を明記 */}
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

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="discord-video-filter"
              className="text-xs text-foreground/80"
            >
              動画 取り込みフィルタワード（任意）
            </Label>
            <Input
              id="discord-video-filter"
              value={videoFilterInput}
              onChange={(e) => setVideoFilterInput(e.target.value)}
              placeholder="例: クリア, 軽減, 解説"
              className="text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              カンマ区切りで複数指定可。いずれかが「メッセージ本文 / URL / 動画タイトル」のいずれかに含まれる投稿だけを取り込みます。URL のみのメッセージでもタイトル経由でマッチします。空欄なら全件取り込み（従来通り）。
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
                取り込み除外 URL{blocklist ? `（${blocklist.length}）` : ""}
              </summary>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                登録した URL は Discord 自動取り込みで今後取り込まれません。動画 /
                攻略の ⋮ メニュー「今後取り込まない」で登録されます。「解除」で
                再び取り込み対象に戻ります。
              </p>
              {blocklistLoading ? (
                <p className="text-muted-foreground mt-2 text-[11px]">
                  読み込み中…
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
                        解除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : blocklist ? (
                <p className="text-muted-foreground mt-2 text-[11px]">
                  除外 URL はありません
                </p>
              ) : null}
            </details>
          )}

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
                className="shrink-0 gap-1.5 text-[10px] tracking-normal"
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
                  className="shrink-0 text-[10px] tracking-normal"
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
                  className="relative mt-1 h-20 w-full overflow-hidden rounded-md border border-border/40"
                >
                  <Image
                    src={backgroundImageUrl.trim()}
                    alt=""
                    fill
                    sizes="100vw"
                    unoptimized={
                      !isOptimizableImageHost(backgroundImageUrl.trim())
                    }
                    className="object-cover object-center"
                  />
                </div>
              )}
          </div>

          {/* 2.1 (2026-04-29): 閲覧可能ロールは大きい UI なので初期状態で
              折りたたむ。`<details>` (open 属性なし) で素直な native 折り
              たたみ。選択済みロールがある場合は要素数バッジを summary に
              出して「設定中ですよ」のヒントを残す。 */}
          <details className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground/80 list-none [&::-webkit-details-marker]:hidden">
              <Shield className="h-3 w-3" aria-hidden />
              閲覧可能ロール（任意）
              {selectedRoleIds.length > 0 && (
                <span className="inline-flex items-center rounded-sm border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 px-1.5 py-px text-[9px] tracking-normal text-[var(--neon-cyan)]">
                  {selectedRoleIds.length} 選択中
                </span>
              )}
              <span className="ml-auto text-[10px] tracking-normal text-muted-foreground">
                クリックで展開
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
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
                  className="self-start text-[10px] tracking-normal text-muted-foreground hover:text-foreground"
                >
                  選択をクリア
                </button>
              )}
            </div>
          </details>

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
                  className="text-[10px] tracking-normal"
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

          {/* TODO #25 (2.1, 2026-04-29): 手動クリア時間 (累計練習時間) 入力欄。
              空欄 / 0 のままなら自動計算 (動画 duration 集計) を優先表示。 */}
          <div className="flex flex-col gap-1.5 border-t border-border/30 pt-4">
            <Label className="flex items-center gap-1.5 text-xs text-foreground/80">
              <Hourglass className="h-3 w-3" aria-hidden />
              クリアまでの累計時間（任意・手動上書き）
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
              <span className="text-xs text-muted-foreground">時間</span>
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
              <span className="text-xs text-muted-foreground">分</span>
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
                  クリア
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              YouTube から duration が取得できない動画 (限定公開等) があると
              自動計算が欠落するため、手動値を入れるとそちらが優先表示されます。
              空欄なら自動集計を使用。
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
              FFLogs マッチワード（任意）
            </Label>
            <Textarea
              id="fflogs-match-keywords"
              value={matchKeywordsInput}
              onChange={(e) => setMatchKeywordsInput(e.target.value)}
              placeholder="例: 絶アレキサンダー, リットアティン強襲戦, M4S"
              className="min-h-[2.4rem] text-[12px] leading-relaxed"
              autoComplete="off"
              spellCheck={false}
              rows={2}
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              カンマ区切りで複数指定可。コンテンツ名 (例: 「絶アレキサンダー」
              「リットアティン強襲戦」) や層指定 (例: 「M4S」) を入れておくと、
              レポートの zone / タイトルにそれらが部分一致 (大小文字無視) した
              ときに自動紐づけでこのカテゴリのものとして採用されます。
              標準キーワードでマッチしない独自命名レポートの救済用途。
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
            className="text-[11px] tracking-normal"
          >
            キャンセル
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
            {busy ? "保存中..." : isEdit ? "更新" : "追加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
