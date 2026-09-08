"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Command, Cog, Search, UserRound } from "lucide-react";
import type { Category } from "@/lib/supabase/types";
import type { ScheduleSourceMode } from "@/lib/schedule/source-mode";
import { getSubTabDefs } from "@/lib/sub-tab-defs";
import { requestOpenSettings } from "@/lib/portal-commands";
import { useLocale, useMessages } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";

/**
 * コマンドパレット (UI-8、2026-09-08)。
 *
 * 調査ノート第 4 回 8-3 UI-8 と、第 2 回 UI 監査の残課題 3
 * **「管理操作が設定ダイアログの奥にある」** への回答。`Cmd/Ctrl + K` で
 * 開き、コンテンツ間のジャンプと管理操作の呼び出しを 1 箇所に集める。
 *
 * ## 設計の判断
 *
 * - **既存の導線は 1 つも減らさない**。ノートのデメリット欄が
 *   「恩恵はデスクトップ中心。モバイルは既存ダイアログを残す」。パレットは
 *   追加の近道で、置き換えではない。
 * - **虫眼鏡ボタンも置く**。キーボード近道だけだと存在に気付けない
 *   (発見性の課題への回答が、発見できない機能では意味がない)。
 * - **絞り込みは部分一致**。ローマ字やあいまい検索は入れていない —
 *   候補が数十件の規模でファジー一致を入れると、狙った項目より
 *   前に別の項目が来る事故のほうが多い。
 * - **候補は props から組む** (DB を引かない)。layout が既に持っている
 *   カテゴリ一覧をそのまま使うので、パレットのために往復が増えない。
 *
 * ## キーボード
 *
 * `Cmd/Ctrl + K` で開閉、`↑ ↓` で移動、`Enter` で実行、`Esc` で閉じる。
 * ⚠ 単キー (`g` など) の割り当ては入れていない。入力欄にフォーカスが
 * 無い状態を条件にしても、popover やダイアログの中で誤爆する経路が多い。
 */

type CommandItem = {
  id: string;
  /** 画面に出る名前。 */
  label: string;
  /** 右側に薄く出す分類 (「ジャンプ」「設定」など)。 */
  group: string;
  /** 絞り込み用の追加キーワード (スラッグなど)。 */
  keywords?: string;
  icon?: ReactNode;
  run: () => void;
};

export function CommandPalette({
  categories,
  scheduleSourceMode,
}: {
  categories: Category[];
  scheduleSourceMode: ScheduleSourceMode;
}) {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(
    () => buildItems({ categories, scheduleSourceMode, router, m, locale }),
    [categories, scheduleSourceMode, router, m, locale],
  );

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter((it) =>
      normalize(`${it.label} ${it.group} ${it.keywords ?? ""}`).includes(q),
    );
  }, [items, query]);

  // 検索語とカーソルの初期化は **開閉のハンドラで** 行う。
  // ⚠ 「閉じたら effect で reset」にすると `react-hooks/set-state-in-effect`
  // の error になり CI が落ちる (実際に踏んだ)。開閉は必ずここを通す。
  const openPalette = useCallback(() => {
    setQuery("");
    setCursor(0);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  // Cmd/Ctrl + K でトグル。入力中でも効かせる (修飾キー付きなので誤爆しない)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette, closePalette]);

  // 開いたら入力欄へフォーカス (フォーカス移動は setState ではないので effect で可)。
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const clampedCursor = filtered.length === 0 ? 0 : Math.min(cursor, filtered.length - 1);

  const runAt = useCallback(
    (index: number) => {
      const item = filtered[index];
      if (!item) return;
      closePalette();
      item.run();
    },
    [filtered, closePalette],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) =>
        filtered.length === 0 ? 0 : (c - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(clampedCursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };

  // 選択が画面外に出たら追従させる (↓ の長押しで見えなくならないように)。
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${clampedCursor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, clampedCursor]);

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label={m.commandPalette.trigger}
        title={m.commandPalette.trigger}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-[var(--neon-cyan)]/60 hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[12svh] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={m.commandPalette.title}
          onMouseDown={(e) => {
            // 背景クリックで閉じる (中身のクリックは拾わない)。
            if (e.target === e.currentTarget) closePalette();
          }}
        >
          <div className="glass flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border/60 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
              <Search
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder={m.commandPalette.placeholder}
                aria-label={m.commandPalette.placeholder}
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              <span
                aria-hidden
                className="hidden shrink-0 items-center gap-0.5 rounded border border-border/50 px-1 py-0.5 font-mono text-[11px] text-muted-foreground/80 sm:inline-flex"
              >
                <Command className="h-3 w-3" aria-hidden />K
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                {m.commandPalette.empty}
              </div>
            ) : (
              <ul
                ref={listRef}
                className="max-h-[50svh] overflow-y-auto py-1"
                role="listbox"
              >
                {filtered.map((it, i) => (
                  <li key={it.id} data-index={i} role="option" aria-selected={i === clampedCursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => runAt(i)}
                      className={
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors " +
                        (i === clampedCursor
                          ? "bg-[var(--neon-cyan)]/12 text-foreground"
                          : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      <span className="grid h-4 w-4 shrink-0 place-items-center text-muted-foreground/80">
                        {it.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
                        {it.group}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** 全角英数の半角化 + 空白除去 + 小文字化 (絞り込みの比較キー)。 */
function normalize(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}

/**
 * 設定の節。id は `CollapsibleSection` の `id` と一致させること
 * (合わないとダイアログは開くが節が開かない)。
 */
const SETTINGS_SECTIONS: Array<{ id: string; key: keyof Messages["commandPalette"]["sections"] }> = [
  { id: "native-members", key: "members" },
  { id: "native-discord-notify", key: "discordNotify" },
  { id: "attendance-reminder", key: "attendanceReminder" },
  { id: "native-choice-values", key: "choiceValues" },
  { id: "native-cancelled-sessions", key: "cancelledSessions" },
  { id: "fflogs-sync", key: "fflogsSync" },
  { id: "logs-notify", key: "logsNotify" },
  { id: "loot-window", key: "lootWindow" },
  { id: "past-sessions", key: "pastSessions" },
  { id: "maintenance", key: "maintenance" },
  { id: "danger-zone", key: "dangerZone" },
];

function buildItems({
  categories,
  scheduleSourceMode,
  router,
  m,
  locale,
}: {
  categories: Category[];
  scheduleSourceMode: ScheduleSourceMode;
  router: ReturnType<typeof useRouter>;
  m: Messages;
  locale: Locale;
}): CommandItem[] {
  const out: CommandItem[] = [];
  const jump = m.commandPalette.groupJump;
  const settings = m.commandPalette.groupSettings;

  if (scheduleSourceMode !== "disabled") {
    out.push({
      id: "nav:schedule",
      label: m.nav.schedule,
      group: jump,
      keywords: "schedule / top",
      run: () => router.push("/"),
    });
  }
  // B-5 (2026-09-08): 個人ページ。ヘッダーにボタンを増やさず、パレットと
  // 出席サマリーからの導線に留める (常時見せるほどの頻度ではない)。
  out.push({
    id: "nav:me",
    label: m.mePage.title,
    group: jump,
    keywords: "me profile mypage",
    icon: <UserRound className="h-3.5 w-3.5" aria-hidden />,
    run: () => router.push("/me"),
  });
  out.push({
    id: "nav:categories",
    label: m.commandPalette.contents,
    group: jump,
    keywords: "category contents",
    run: () => router.push("/category"),
  });

  const tabs = getSubTabDefs(locale);
  for (const c of categories) {
    out.push({
      id: `nav:cat:${c.slug}`,
      label: c.name,
      group: jump,
      keywords: c.slug,
      run: () => router.push(`/category/${c.slug}`),
    });
    for (const t of tabs) {
      const cfg = c.tabConfig?.[t.id];
      // カテゴリ側で無効にしたタブは候補に出さない (開いても空の画面になる)。
      if (cfg?.enabled === false) continue;
      const label = cfg?.label?.trim() || t.label;
      out.push({
        id: `nav:cat:${c.slug}:${t.id}`,
        label: `${c.name} / ${label}`,
        group: jump,
        keywords: `${c.slug} ${t.id} ${t.segment}`,
        icon: <t.Icon className="h-3.5 w-3.5" aria-hidden />,
        run: () => router.push(`/category/${c.slug}/${t.segment}`),
      });
    }
  }

  out.push({
    id: "settings:open",
    label: m.commandPalette.openSettings,
    group: settings,
    keywords: "settings config",
    icon: <Cog className="h-3.5 w-3.5" aria-hidden />,
    run: () => requestOpenSettings(),
  });
  for (const s of SETTINGS_SECTIONS) {
    out.push({
      id: `settings:${s.id}`,
      label: `${m.commandPalette.openSettings} / ${m.commandPalette.sections[s.key]}`,
      group: settings,
      keywords: `settings ${s.id}`,
      icon: <Cog className="h-3.5 w-3.5" aria-hidden />,
      run: () => requestOpenSettings({ section: s.id }),
    });
  }

  return out;
}
