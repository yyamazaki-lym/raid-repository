import Link from "next/link";
import { Activity } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { SettingsDialog } from "./settings-dialog";
import packageJson from "../../../package.json";
import { RELEASES } from "@/lib/changelog";

/**
 * App version for the header badge.
 *
 * Single source of truth:
 *   - `RELEASES[0].version` — the current MAJOR.MINOR (under new scheme)
 *   - `RELEASES[0].date` — the date suffix
 *   `package.json#version` is left at the final pre-scheme value
 *   (`1.9.38`) as a historical marker; bump it only on major/minor bumps
 *   if you also want it to reflect the new scheme.
 *
 * Versioning convention (from v1.9, 2026-04-28):
 *   `MAJOR.MINOR (YYYY-MM-DD)` — patch dropped.
 *     MINOR — notable feature additions / reworks (1.9 → 1.10)
 *     MAJOR — breaking / sweeping changes (1.x → 2.0)
 *     date  — pulled from the latest changelog entry; multiple days of
 *             small fixes share the same MAJOR.MINOR and only the date
 *             updates.
 *   Pre-scheme history used MAJOR.MINOR.PATCH; see `src/lib/changelog.ts`.
 *
 * Stage tag is deliberately kept inline since it changes rarely:
 *     ALPHA — internal, rough — bumped to BETA once it's daily-driver usable
 *     BETA  — operational, but still actively bug-fixing (current)
 *     RC    — release candidate, only show-stoppers being fixed
 *     (none) — stable
 */
const APP_VERSION = RELEASES[0]?.version ?? packageJson.version;
const APP_DATE = RELEASES[0]?.date ?? null;
const APP_STAGE = "BETA";

export function SiteHeader() {
  return (
    <header className="glass-bar sticky top-0 z-30">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="Raid Repository home"
        >
          <span className="relative grid h-8 w-8 place-items-center rounded-md border border-primary/40 bg-background/40 text-primary shadow-[0_0_18px_-4px_var(--neon-cyan)] transition-shadow group-hover:shadow-[0_0_22px_-2px_var(--neon-cyan)]">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-display text-[13px] font-semibold tracking-[0.2em] text-foreground sm:text-sm">
              RAID REPOSITORY
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums tracking-[0.16em] text-muted-foreground sm:text-[11px]">
              <span>
                v{APP_VERSION}
                {APP_DATE ? ` (${APP_DATE})` : ""}
              </span>
              <span aria-hidden className="opacity-50">·</span>
              <span className="tracking-[0.22em]">{APP_STAGE}</span>
            </span>
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />
          <SettingsDialog />
          <span
            aria-hidden
            className="hidden h-2 w-2 animate-pulse rounded-full bg-[var(--neon-cyan)] shadow-[0_0_10px_var(--neon-cyan)] sm:inline-block"
          />
          <span className="hidden font-mono text-[11px] tracking-[0.22em] text-muted-foreground sm:inline">
            ONLINE
          </span>
        </div>
      </div>
    </header>
  );
}
