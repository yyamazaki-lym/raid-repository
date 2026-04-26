"use client";

/**
 * Client-side helpers for the schedule-source URL override.
 *
 * The override is stored as BOTH a cookie (so the server-rendered page sees
 * it on the next request) AND localStorage (so the settings UI can show the
 * current value without parsing cookies). Cookie is the source of truth for
 * server reads; localStorage just mirrors it for UX.
 *
 * Cookie name is duplicated as a string literal here because importing from
 * `./schedule/source-url.ts` (which uses `next/headers`) would pull server-only
 * code into the client bundle. Keep the name in sync if it ever changes.
 */

const COOKIE_NAME = "raid-repo-schedule-url";
const STORAGE_KEY = "raid-repo:schedule-url";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export function getScheduleUrlOverride(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length > 0) return stored;
  } catch {
    // localStorage may be disabled — fall through to cookie.
  }
  return readCookie(COOKIE_NAME);
}

export function setScheduleUrlOverride(rawUrl: string): { ok: boolean; reason?: string } {
  const url = rawUrl.trim();
  if (!url) return { ok: false, reason: "URLを入力してください" };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "http:// または https:// で始めてください" };
  }
  try {
    new URL(url);
  } catch {
    return { ok: false, reason: "URLの形式が正しくありません" };
  }

  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(url)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // ignore quota / disabled storage
  }
  return { ok: true };
}

export function clearScheduleUrlOverride(): void {
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${escaped}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return match[2] || null;
  }
}
