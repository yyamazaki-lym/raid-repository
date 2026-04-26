"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-browser category ordering, stored as an array of slugs in localStorage.
 *
 * Phase 1 design: client-only, no DB. When Phase 3 brings Supabase, replace
 * with a server-side `categories.sort_order` column updated via Server Action.
 *
 * Slugs not present in the stored list keep their original DB order at the
 * tail (e.g. newly-added categories appear last).
 */

const STORAGE_KEY = "raid-repo:category-order";
const CHANGE_EVENT = "raid-repo:category-order-changed";

type Order = string[];

function readOrder(): Order {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

let cached: Order = [];
let cacheInitialized = false;

function getSnapshot(): Order {
  if (!cacheInitialized && typeof window !== "undefined") {
    cached = readOrder();
    cacheInitialized = true;
  }
  return cached;
}

const EMPTY: Order = Object.freeze([]) as unknown as Order;
function getServerSnapshot(): Order {
  return EMPTY;
}

function subscribe(notify: () => void): () => void {
  const handler = () => {
    cached = readOrder();
    notify();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) handler();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

/** Live ordering of slugs as set by drag-to-reorder. */
export function useCategoryOrder(): Order {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setCategoryOrder(order: Order): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore quota / disabled storage
  }
  cached = order;
  cacheInitialized = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Sort a list of items by the stored slug order. Items not in the order list
 * keep their original positions at the end.
 */
export function applyCategoryOrder<T extends { slug: string }>(
  items: T[],
  order: Order,
): T[] {
  if (order.length === 0) return items;
  const indexBySlug = new Map<string, number>();
  order.forEach((slug, i) => indexBySlug.set(slug, i));
  return [...items].sort((a, b) => {
    const ai = indexBySlug.get(a.slug);
    const bi = indexBySlug.get(b.slug);
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}
