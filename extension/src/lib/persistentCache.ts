// Persistent subtitle cache backed by chrome.storage.local.
//
// Strategy:
//  - bulkLoadFromStorage: called once after caption entries are fetched, pre-warms the
//    in-memory subtitleCache Map in a single IPC call so all subsequent lookups are
//    synchronous (0ms) — achieving true zero-latency for previously-seen subtitles.
//  - readFromStorage: single-entry fallback used by processSubtitleText before showing
//    the loading state, covers captions that weren't in the pre-warm set.
//  - writeToStorage: fire-and-forget writes after every API response.
//  - LRU eviction kicks in when chrome.storage.local quota is approached.

import type { EnhancedSubtitle } from './api';

const PREFIX = 'sc_'; // "subtitle cache" — avoids collisions with other extension keys
const MAX_ENTRIES = 4000;

interface StoredEntry {
  r: EnhancedSubtitle; // result
  t: number;           // last-used timestamp (ms) for LRU eviction
}

// ── Synchronous djb2 hash ─────────────────────────────────────────────────────
// Fast, no async needed, collision-resistant enough for subtitle-length strings.
// Produces a short base-36 string for use as a storage key suffix.

function djb2(lang: string, text: string): string {
  const s = `${lang}\x00${text.trim()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function makeStorageKey(lang: string, text: string): string {
  return PREFIX + djb2(lang, text);
}

// ── Bulk pre-warm ─────────────────────────────────────────────────────────────
// Pass every caption entry for the current video. Returns a Map of
// originalText → EnhancedSubtitle for entries already in persistent storage.
// The caller merges this into the in-memory subtitleCache Map.
//
// Uses a single chrome.storage.local.get() call (one IPC round-trip).

export function bulkLoadFromStorage(
  entries: Array<{ text: string; lang: string }>,
): Promise<Map<string, EnhancedSubtitle>> {
  if (entries.length === 0) return Promise.resolve(new Map());

  // Build key→originalText mapping so we can return original text in the result Map
  const keyToText = new Map<string, string>();
  for (const { text, lang } of entries) {
    const t = text.trim();
    if (t) keyToText.set(makeStorageKey(lang, t), t);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(Array.from(keyToText.keys()), (result) => {
      if (chrome.runtime.lastError) { resolve(new Map()); return; }
      const out = new Map<string, EnhancedSubtitle>();
      keyToText.forEach((originalText, key) => {
        const entry = result[key] as StoredEntry | undefined;
        if (entry?.r) out.set(originalText, entry.r);
      });
      resolve(out);
    });
  });
}

// ── Single read ───────────────────────────────────────────────────────────────
// Fallback lookup used in processSubtitleText before the loading state is shown.
// Covers subtitles that weren't included in the pre-warm (e.g. observer-captured).

export function readFromStorage(lang: string, text: string): Promise<EnhancedSubtitle | null> {
  const key = makeStorageKey(lang, text.trim());
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      const entry = result[key] as StoredEntry | undefined;
      resolve(entry?.r ?? null);
    });
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
// Always call without await — never block the render path.

export function writeToStorage(lang: string, text: string, result: EnhancedSubtitle): void {
  const key = makeStorageKey(lang, text.trim());
  const entry: StoredEntry = { r: result, t: Date.now() };
  chrome.storage.local.set({ [key]: entry }, () => {
    if (chrome.runtime.lastError) {
      // Quota likely exceeded — evict oldest quarter then retry once
      evictOldEntries().then(() => {
        chrome.storage.local.set({ [key]: entry }, () => {});
      });
    }
  });
}

// ── LRU eviction ─────────────────────────────────────────────────────────────
// Remove the oldest 25% of subtitle cache entries when quota is exceeded.

function evictOldEntries(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (all) => {
      if (chrome.runtime.lastError) { resolve(); return; }
      const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
      if (keys.length <= MAX_ENTRIES) { resolve(); return; }
      const sorted = keys.sort(
        (a, b) => ((all[a] as StoredEntry).t ?? 0) - ((all[b] as StoredEntry).t ?? 0),
      );
      chrome.storage.local.remove(sorted.slice(0, Math.ceil(sorted.length * 0.25)), () => resolve());
    });
  });
}
