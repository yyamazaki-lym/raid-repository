"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from "./themes";

const CHANGE_EVENT = "raid-repo:theme-changed";

function readId(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    // localStorage disabled — fall through.
  }
  return DEFAULT_THEME_ID;
}

let cached: ThemeId = DEFAULT_THEME_ID;
let cacheInitialized = false;

function getSnapshot(): ThemeId {
  if (!cacheInitialized && typeof window !== "undefined") {
    cached = readId();
    cacheInitialized = true;
  }
  return cached;
}

function getServerSnapshot(): ThemeId {
  // SSR returns the default; the pre-hydration script in <head> already
  // applied the user's chosen theme class to <html>, so what the server
  // renders for *components* doesn't need to match the actual theme — only
  // the structure does. Returning the default keeps hydration stable.
  return DEFAULT_THEME_ID;
}

function subscribe(notify: () => void): () => void {
  const handler = () => {
    cached = readId();
    notify();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) handler();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

/** Live value of the currently-applied theme. */
export function useThemeId(): ThemeId {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Persist + apply a new theme. Updates `<html class="...">` immediately. */
export function setThemeId(id: ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore quota / disabled storage
  }
  applyThemeClass(id);
  cached = id;
  cacheInitialized = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Swap the theme class on `<html>`. Pure DOM mutation, no React involved. */
export function applyThemeClass(id: ThemeId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Remove any existing theme-* class.
  for (const cls of Array.from(root.classList)) {
    if (cls.startsWith("theme-")) root.classList.remove(cls);
  }
  root.classList.add(`theme-${id}`);
}

/**
 * Inline script source — runs synchronously in <head> before React hydrates,
 * so the theme class is on <html> from the very first paint (no FOUC).
 */
export const PRE_HYDRATION_THEME_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    var valid = ['evercold','dawntrail','endwalker','shadowbringers','stormblood','heavensward','arr'];
    var picked = valid.indexOf(t) >= 0 ? t : '${DEFAULT_THEME_ID}';
    document.documentElement.classList.add('theme-' + picked);
  } catch(e) {
    document.documentElement.classList.add('theme-${DEFAULT_THEME_ID}');
  }
})();
`.trim();
