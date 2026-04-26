import Link from "next/link";
import { Activity } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { SettingsDialog } from "./settings-dialog";

/**
 * App version for the header badge.
 *
 * Versioning convention:
 *   MAJOR.MINOR.PATCH (semver-ish)
 *     PATCH  — bug fixes, small UI tweaks (1.0.0 → 1.0.1)
 *     MINOR  — page-wide overhauls or notable new features (1.0.x → 1.1.0)
 *     MAJOR  — rare, breaking changes (1.x → 2.0.0)
 *
 * Stage tag (suffix):
 *     ALPHA — internal, rough — bumped to BETA once it's daily-driver usable
 *     BETA  — operational, but still actively bug-fixing (current)
 *     RC    — release candidate, only show-stoppers being fixed
 *     (none) — stable
 *
 * Keep this in sync with package.json's `version` field on every bump.
 */
const APP_VERSION = "1.0.0";
const APP_STAGE = "BETA";

export function SiteHeader() {
  return (
    <header className="glass-bar sticky top-0 z-30">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          aria-label="Raid Repository home"
        >
          <span className="relative grid h-8 w-8 place-items-center rounded-md border border-primary/40 bg-background/40 text-primary shadow-[0_0_18px_-4px_var(--neon-cyan)] transition-shadow group-hover:shadow-[0_0_22px_-2px_var(--neon-cyan)]">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col leading-none">
            <span className="font-display text-[13px] font-semibold tracking-[0.18em] text-foreground sm:text-sm">
              RAID REPOSITORY
            </span>
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground sm:text-[11px]">
              v{APP_VERSION} · {APP_STAGE}
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
          <span className="hidden font-mono text-[11px] tracking-widest text-muted-foreground sm:inline">
            ONLINE
          </span>
        </div>
      </div>
    </header>
  );
}
