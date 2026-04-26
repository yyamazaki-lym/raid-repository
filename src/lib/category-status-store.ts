"use client";

import { useSyncExternalStore } from "react";
import { isCategoryStatus, type CategoryStatus } from "./placeholder-categories";

/**
 * Phase 1: per-browser status overrides via localStorage.
 * Phase 3 will replace this with a Supabase write (single source of truth across devices).
 *
 * Notes:
 * - SSR snapshot returns an empty map so server output is stable and matches the first
 *   client render (no hydration mismatch). After hydration, useSyncExternalStore re-reads
 *   localStorage and triggers a re-render.
 * - We dispatch a custom event on writes so other tabs/components in the same tab update
 *   instantly. The native `storage` event covers cross-tab updates.
 */

const STORAGE_KEY = "raid-repo:category-status-overrides";
const CHANGE_EVENT = "raid-repo:category-status-changed";

type StatusMap = Record<string, CategoryStatus>;

function readMap(): StatusMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    // Migrate / sanitize values. We previously had "進行中" as a status; map any
    // legacy/unknown value to "練習中" (closest analog) and drop entries we
    // can't interpret. Persist the cleaned-up map back to storage so the
    // migration runs only once per browser.
    let mutated = false;
    const out: StatusMap = {};
    for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isCategoryStatus(value)) {
        out[slug] = value;
      } else if (value === "進行中") {
        out[slug] = "練習中";
        mutated = true;
      } else {
        // Drop unknown values — they'll fall back to defaults.
        mutated = true;
      }
    }
    if (mutated) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
      } catch {
        // Quota / storage disabled — read still returns the cleaned map.
      }
    }
    return out;
  } catch {
    return {};
  }
}

// useSyncExternalStore requires a stable snapshot reference between calls when
// nothing has changed — otherwise React thinks the store updated and re-renders
// every commit. We cache the latest map and only swap it on subscribe events.
let cached: StatusMap = {};
let cacheInitialized = false;

function getSnapshot(): StatusMap {
  if (!cacheInitialized && typeof window !== "undefined") {
    cached = readMap();
    cacheInitialized = true;
  }
  return cached;
}

const EMPTY: StatusMap = Object.freeze({}) as StatusMap;
function getServerSnapshot(): StatusMap {
  return EMPTY;
}

function subscribe(notify: () => void): () => void {
  const handler = () => {
    cached = readMap();
    notify();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) handler();
  });
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler as EventListener);
  };
}

/** Reactive map of `{ slug: status }`. Returns `{}` until hydration completes. */
export function useCategoryStatusMap(): StatusMap {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Write a new status for a category. Triggers re-render in all subscribers. */
export function setCategoryStatus(slug: string, status: CategoryStatus): void {
  if (typeof window === "undefined") return;
  const next = { ...readMap(), [slug]: status };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cached = next;
  cacheInitialized = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Remove the override for a slug, falling back to the placeholder default. */
export function resetCategoryStatus(slug: string): void {
  if (typeof window === "undefined") return;
  const map = readMap();
  delete map[slug];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  cached = map;
  cacheInitialized = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
