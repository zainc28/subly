import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';

// kuroshiro builds with Rollup and sets __esModule = true, so require() returns
// { default: Kuroshiro }. The fallback handles both ESM-wrapped and plain CJS exports.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _KuroshiroMod = require('kuroshiro');
const Kuroshiro = _KuroshiroMod.default ?? _KuroshiroMod;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _KuromojiMod = require('kuroshiro-analyzer-kuromoji');
const KuromojiAnalyzer = _KuromojiMod.default ?? _KuromojiMod;

export interface WordBreakdown {
  word: string;
  transliteration: string;
  translation: string;
  startIndex: number;
  endIndex: number;
}

export interface EnhancedSubtitle {
  original: string;
  transliteration: string;
  translation: string;
  wordBreakdown: WordBreakdown[];
  sourceLanguage: string;
}

// ── SHA-256 cache key ────────────────────────────────────────────────────────
// Produces a stable 64-char hex key for the Supabase translation_cache table.
// Normalise whitespace so "hello  world" and "hello world" share a cache entry.

function cacheHash(sourceLang: string, targetLang: string, text: string): string {
  const normalised = text.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${sourceLang}|${targetLang}|${normalised}`).digest('hex');
}

// ── Supabase L2 cache helpers ────────────────────────────────────────────────
// Lookup: called on in-memory miss. ~30-50ms vs Azure's ~300ms.
// Write: always fire-and-forget so it never blocks response time.

interface DbCacheRow {
  hash: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  translation: string;
  transliteration: string;
  word_breakdown: WordBreakdown[];
}

async function dbCacheLookup(hash: string): Promise<EnhancedSubtitle | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('translation_cache')
      .select('source_text,source_lang,translation,transliteration,word_breakdown')
      .eq('hash', hash)
      .maybeSingle();
    if (error || !data) return null;
    // Bump last_used_at in background (non-blocking)
    void Promise.resolve(
      supabaseAdmin
        .from('translation_cache')
        .update({ last_used_at: new Date().toISOString() })
        .eq('hash', hash),
    ).catch(() => {});
    return {
      original: data.source_text,
      translation: data.translation,
      transliteration: data.transliteration ?? data.source_text,
      wordBreakdown: (data.word_breakdown as WordBreakdown[]) ?? [],
      sourceLanguage: data.source_lang,
    };
  } catch {
    return null;
  }
}

function dbCacheWrite(hash: string, row: DbCacheRow): void {
  void Promise.resolve(
    supabaseAdmin
      .from('translation_cache')
      .upsert(
        {
          hash,
          source_lang: row.source_lang,
          target_lang: row.target_lang,
          source_text: row.source_text,
          translation: row.translation,
          transliteration: row.transliteration,
          word_breakdown: row.word_breakdown,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'hash' },
      ),
  ).catch(() => {});
}

// ── Startup cache warm ────────────────────────────────────────────────────────
// Load the most recently used entries from Supabase into the in-memory Maps so
// the first subtitle requests after a cold restart are served without a DB hit.

export async function warmCachesFromDB(): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('translation_cache')
      .select('hash,source_lang,target_lang,source_text,translation,transliteration,word_breakdown')
      .order('last_used_at', { ascending: false })
      .limit(300);

    if (!data) return;
    let count = 0;
    for (const row of data as DbCacheRow[]) {
      const key = `${row.source_lang}|${row.target_lang}|${row.source_text}`;
      if (!translationCache.has(key)) {
        translationCache.set(key, row.translation);
        count++;
      }
      const subKey = `${row.source_lang}|${row.target_lang}|${row.source_text}`;
      if (!subtitleCache.has(subKey)) {
        subtitleCache.set(subKey, {
          original: row.source_text,
          translation: row.translation,
          transliteration: row.transliteration ?? row.source_text,
          wordBreakdown: (row.word_breakdown as WordBreakdown[]) ?? [],
          sourceLanguage: row.source_lang,
        });
        count++;
      }
    }
    console.log(`[Subly] Warmed ${data.length} entries from Supabase cache`);
  } catch (err) {
    console.warn('[Subly] DB cache warm failed (non-fatal):', err);
  }
}

// ── Singletons ──────────────────────────────────────────────────────────────

let kuroshiroInstance: any = null;
let kuromojiAnalyzer: any = null;
let initPromise: Promise<void> | null = null;

export async function initKuroshiro(): Promise<void> {
  if (kuroshiroInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[Subly] Initializing Kuroshiro + Kuromoji (pre-warming)…');
    kuromojiAnalyzer = new KuromojiAnalyzer();
    kuroshiroInstance = new Kuroshiro();
    await kuroshiroInstance.init(kuromojiAnalyzer);
    console.log('[Subly] Kuroshiro ready.');
  })().catch((err) => {
    // Reset so the next call can retry rather than permanently failing
    initPromise = null;
    kuroshiroInstance = null;
    throw err;
  });

  return initPromise;
}

// ── Caches ───────────────────────────────────────────────────────────────────

const translationCache = new Map<string, string>();
const subtitleCache = new Map<string, EnhancedSubtitle>();

// ── Language detection ────────────────────────────────────────────────────────

export function detectLanguage(text: string): string {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // hiragana / katakana
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';              // hangul
  // Urdu check before Arabic — Urdu-specific characters: ں ے ھ ڈ ڑ ٹ
  if (/[\u06ba\u06d2\u06be\u0688\u0691\u0679]/.test(text)) return 'ur';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';              // arabic
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';              // cyrillic
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';              // CJK (chinese)
  return 'auto';
}

// ── Translation ───────────────────────────────────────────────────────────────
// Primary: unofficial Google Translate endpoint (fast, no key, high limits)
// Fallback: MyMemory (free, needs no key)

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

async function translateWithGoogle(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    // Response: [[["translated","source",...], ...], null, "ja", ...]
    const data = await res.json() as unknown[][];
    const segments = data[0] as Array<[string, ...unknown[]]>;
    if (!Array.isArray(segments)) return null;
    const translated = segments.map((s) => s[0] ?? '').join('').trim();
    return translated && translated !== text ? translated : null;
  } catch {
    return null;
  }
}

async function translateWithMyMemory(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { responseStatus: number; responseData: { translatedText: string } };
    if (data.responseStatus === 200) {
      const translated = decodeHtmlEntities(data.responseData.translatedText);
      return translated && translated !== text ? translated : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Azure Cognitive Services Translator ──────────────────────────────────────
// translateWithAzure: throws if key not set so caller can fall back.
// transliterateWithAzure: Arabic/Urdu/Chinese/Korean → Latin script.

function azureHeaders(): Record<string, string> {
  return {
    'Ocp-Apim-Subscription-Key': process.env.AZURE_TRANSLATOR_KEY!,
    'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION ?? 'eastus',
    'Content-Type': 'application/json',
  };
}

async function translateWithAzure(text: string, from: string, to: string): Promise<string> {
  if (!process.env.AZURE_TRANSLATOR_KEY) throw new Error('AZURE_TRANSLATOR_KEY not set');
  // Omit `from` when language is unknown — Azure auto-detects; `from=auto` is invalid and returns 400
  const fromParam = from !== 'auto' ? `&from=${from}` : '';
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0${fromParam}&to=${to}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Azure Translator HTTP ${res.status}`);
  const data = await res.json() as Array<{ translations: Array<{ text: string }> }>;
  const translated = data[0]?.translations[0]?.text;
  if (!translated || translated === text) throw new Error('Azure returned empty/same translation');
  return translated;
}

// Batch Azure translate: one HTTP call for up to 100 texts — avoids N parallel round-trips.
async function translateBatchWithAzure(
  texts: string[],
  from: string,
  to: string,
): Promise<(string | null)[]> {
  if (!process.env.AZURE_TRANSLATOR_KEY || texts.length === 0) return texts.map(() => null);
  const fromParam = from !== 'auto' ? `&from=${from}` : '';
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0${fromParam}&to=${to}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: azureHeaders(),
      body: JSON.stringify(texts.map((t) => ({ Text: t }))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return texts.map(() => null);
    const data = await res.json() as Array<{ translations: Array<{ text: string }> }>;
    return data.map((d, i) => {
      const t = d.translations[0]?.text;
      return t && t !== texts[i] ? t : null;
    });
  } catch {
    return texts.map(() => null);
  }
}

// Batch Azure transliterate: one HTTP call for up to 100 texts.
async function transliterateBatchWithAzure(
  texts: string[],
  lang: string,
): Promise<(string | null)[]> {
  const scripts = AZURE_TRANSLIT_SCRIPTS[lang];
  if (!scripts || !process.env.AZURE_TRANSLATOR_KEY || texts.length === 0) return texts.map(() => null);
  const url = `https://api.cognitive.microsofttranslator.com/transliterate?api-version=3.0&language=${lang}&fromScript=${scripts.fromScript}&toScript=${scripts.toScript}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: azureHeaders(),
      body: JSON.stringify(texts.map((t) => ({ Text: t }))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return texts.map(() => null);
    const data = await res.json() as Array<{ text: string }>;
    return data.map((d) => d.text ?? null);
  } catch {
    return texts.map(() => null);
  }
}

const AZURE_TRANSLIT_SCRIPTS: Record<string, { fromScript: string; toScript: string }> = {
  ar: { fromScript: 'Arab', toScript: 'Latn' },
  ur: { fromScript: 'Arab', toScript: 'Latn' },
  zh: { fromScript: 'Hans', toScript: 'Latn' },
  ko: { fromScript: 'Hang', toScript: 'Latn' },
};

async function transliterateWithAzure(text: string, lang: string): Promise<string> {
  const scripts = AZURE_TRANSLIT_SCRIPTS[lang];
  if (!scripts) throw new Error(`Azure transliteration not supported for ${lang}`);
  if (!process.env.AZURE_TRANSLATOR_KEY) throw new Error('AZURE_TRANSLATOR_KEY not set');
  const url = `https://api.cognitive.microsofttranslator.com/transliterate?api-version=3.0&language=${lang}&fromScript=${scripts.fromScript}&toScript=${scripts.toScript}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Azure Transliterate HTTP ${res.status}`);
  const data = await res.json() as Array<{ text: string }>;
  const result = data[0]?.text;
  if (!result) throw new Error('Azure returned empty transliteration');
  return result;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang = 'en',
): Promise<string> {
  const cacheKey = `${sourceLang}|${targetLang}|${text}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey)!;

  // Priority: Azure → Google → MyMemory
  const result =
    await translateWithAzure(text, sourceLang, targetLang).catch(() => null) ??
    (await translateWithGoogle(text, sourceLang, targetLang)) ??
    (await translateWithMyMemory(text, sourceLang, targetLang)) ??
    text;

  if (result !== text) translationCache.set(cacheKey, result);
  return result;
}

// ── Romanisation via Google Translate (Arabic / Urdu) ────────────────────────
// dt=rm asks Google to return the romanized (latin-script) form of the source.
// Response: [[["translation","source",...], ...], null, lang, ...]
// Romanization sits at data[0][i][3] for each segment.

async function getRomanization(text: string, sourceLang: string): Promise<string | null> {
  // Try Azure transliteration first (ar, ur, zh, ko); fall back to Google dt=rm
  try {
    return await transliterateWithAzure(text, sourceLang);
  } catch { /* fall through */ }
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json() as unknown[][];
    const segs = data[0] as Array<unknown[]>;
    if (!Array.isArray(segs)) return null;
    const parts = segs
      .map((s) => (Array.isArray(s) && s[3] != null ? String(s[3]) : ''))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(' ').trim() : null;
  } catch {
    return null;
  }
}

// ── Japanese romanisation ────────────────────────────────────────────────────

async function romanizeJapanese(text: string, mode = 'spaced'): Promise<string> {
  await initKuroshiro();
  return kuroshiroInstance.convert(text, { to: 'romaji', mode, romajiSystem: 'hepburn' });
}

// ── Japanese tokenisation + breakdown ────────────────────────────────────────

// Kuromoji POS tags for particles / auxiliaries / punctuation we don't need to translate
const SKIP_POS = ['助詞', '助動詞', '記号', '接続詞'];

async function getJapaneseWordBreakdown(text: string): Promise<WordBreakdown[]> {
  await initKuroshiro();

  const tokens: any[] = await kuromojiAnalyzer.parse(text);

  // Phase 1 — Romanize every token in parallel (Kuroshiro is local, very fast)
  const romajiForms = await Promise.all(
    tokens.map(async (token: any) => {
      try {
        return (await romanizeJapanese(token.surface_form, 'normal')).trim();
      } catch {
        return token.surface_form as string;
      }
    }),
  );

  // Phase 2 — Build result using only cached per-word translations (instant, no network wait)
  const result: WordBreakdown[] = [];
  const toFetch: string[] = [];
  let charIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const word: string = token.surface_form;
    const startIndex = charIndex;
    const endIndex = charIndex + word.length;
    charIndex = endIndex;

    const shouldTranslate =
      !SKIP_POS.some((pos) => token.pos?.startsWith(pos)) && word.trim().length > 0;

    let translation = '';
    if (shouldTranslate) {
      const cacheKey = `ja|en|${word}`;
      if (translationCache.has(cacheKey)) {
        translation = translationCache.get(cacheKey)!;
        if (translation === word) translation = '';
      } else {
        toFetch.push(word); // not cached yet — queue for background fetch
      }
    }

    result.push({ word, transliteration: romajiForms[i], translation, startIndex, endIndex });
  }

  // Phase 3 — Background-fetch uncached words to warm the cache for next time (fire-and-forget)
  if (toFetch.length > 0) {
    Promise.all(toFetch.map((w) => translateText(w, 'ja', 'en'))).catch(() => {});
  }

  return result;
}

// ── Generic word breakdown (space-separated or CJK character-split) ──────────

// CJK languages have no spaces between words — split into individual characters
// which are the smallest meaningful unit. Korean is syllable-block based but
// space-separated, so space-splitting works there.
const CJK_CHAR_LANGS = new Set(['zh', 'ja']); // ja fallback if kuromoji unavailable

async function getGenericWordBreakdown(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<WordBreakdown[]> {
  const tokens: string[] = CJK_CHAR_LANGS.has(sourceLang)
    ? Array.from(text).filter((c) => c.trim())
    : text.split(/\s+/).filter((w) => w.trim());

  const result: WordBreakdown[] = [];
  const toFetch: string[] = [];
  let charIndex = 0;

  for (const token of tokens) {
    const startIndex = text.indexOf(token, charIndex);
    const endIndex = startIndex + token.length;
    charIndex = endIndex;

    // Use cached translation if available; otherwise queue background fetch
    const cacheKey = `${sourceLang}|${targetLang}|${token}`;
    let translation = '';
    if (translationCache.has(cacheKey)) {
      const cached = translationCache.get(cacheKey)!;
      translation = cached !== token ? cached : '';
    } else {
      toFetch.push(token);
    }

    result.push({ word: token, transliteration: token, translation, startIndex, endIndex });
  }

  // Warm the cache in background — available on subsequent subtitle lines
  if (toFetch.length > 0) {
    Promise.all(toFetch.map((w) => translateText(w, sourceLang, targetLang))).catch(() => {});
  }

  return result;
}

// ── Main enhance function ────────────────────────────────────────────────────

export async function enhanceSubtitle(
  text: string,
  sourceLang: string,
  targetLang = 'en',
): Promise<EnhancedSubtitle> {
  const cacheKey = `${sourceLang}|${targetLang}|${text}`;
  if (subtitleCache.has(cacheKey)) return subtitleCache.get(cacheKey)!;

  // ── L2: Supabase persistent cache (~30ms vs Azure's ~300ms) ──────────────
  const hash = cacheHash(sourceLang, targetLang, text);
  const dbHit = await dbCacheLookup(hash);
  if (dbHit) {
    subtitleCache.set(cacheKey, dbHit);
    return dbHit;
  }

  // Romanisation — Kuroshiro for Japanese, Google Translate dt=rm for Arabic/Urdu
  const transliterationPromise: Promise<string> =
    sourceLang === 'ja'
      ? romanizeJapanese(text).catch(() => text)
      : (sourceLang === 'ar' || sourceLang === 'ur')
        ? getRomanization(text, sourceLang).then((r) => r ?? text).catch(() => text)
        : Promise.resolve(text);

  // Word breakdown (Kuromoji — local, fast)
  const wordBreakdownPromise: Promise<WordBreakdown[]> = sourceLang === 'ja'
    ? getJapaneseWordBreakdown(text).catch(() => [])
    : getGenericWordBreakdown(text, sourceLang, targetLang).catch(() => []);

  // Full-sentence translation (network — can be slower)
  // Race against a 4s deadline so transliteration+breakdown are never held hostage
  const translationPromise = Promise.race([
    translateText(text, sourceLang, targetLang),
    new Promise<string>((resolve) => setTimeout(() => resolve(text), 4000)),
  ]);

  const [translation, transliteration, wordBreakdown] = await Promise.all([
    translationPromise,
    transliterationPromise,
    wordBreakdownPromise,
  ]);

  const result: EnhancedSubtitle = {
    original: text,
    transliteration,
    translation,
    wordBreakdown,
    sourceLanguage: sourceLang,
  };

  subtitleCache.set(cacheKey, result);

  // ── Write to Supabase L2 cache (fire-and-forget, never blocks response) ──
  dbCacheWrite(hash, {
    hash,
    source_lang: sourceLang,
    target_lang: targetLang,
    source_text: text,
    translation,
    transliteration,
    word_breakdown: wordBreakdown,
  });

  // Limit cache size
  if (subtitleCache.size > 500) {
    const firstKey = subtitleCache.keys().next().value;
    if (firstKey) subtitleCache.delete(firstKey);
  }

  return result;
}

// ── Batch enhance ─────────────────────────────────────────────────────────────
// Optimised path for the preload endpoint.
// Uses ONE Azure translate call + ONE Azure transliterate call per language group
// instead of N parallel individual calls — reduces backend-to-Azure round-trips
// from 2N to 2 per language, cutting preload time by ~5x for large batches.

export async function enhanceBatch(
  entries: Array<{ text: string; sourceLang: string }>,
  targetLang = 'en',
): Promise<EnhancedSubtitle[]> {
  const results: (EnhancedSubtitle | null)[] = new Array(entries.length).fill(null);

  // ── L1: in-memory cache ──────────────────────────────────────────────────
  const misses: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const { text, sourceLang } = entries[i];
    const key = `${sourceLang}|${targetLang}|${text}`;
    const hit = subtitleCache.get(key);
    if (hit) results[i] = hit;
    else misses.push(i);
  }

  if (misses.length === 0) return results as EnhancedSubtitle[];

  // ── L2: Supabase cache (parallel lookups for all misses) ─────────────────
  await Promise.all(
    misses.map(async (i) => {
      const { text, sourceLang } = entries[i];
      const hash = cacheHash(sourceLang, targetLang, text);
      const hit = await dbCacheLookup(hash);
      if (hit) {
        subtitleCache.set(`${sourceLang}|${targetLang}|${text}`, hit);
        results[i] = hit;
      }
    }),
  );

  const apiMisses = misses.filter((i) => !results[i]);
  if (apiMisses.length === 0) return results as EnhancedSubtitle[];

  // ── L3: Azure batch API — group misses by source language ────────────────
  const byLang = new Map<string, number[]>();
  for (const i of apiMisses) {
    const lang = entries[i].sourceLang;
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(i);
  }

  await Promise.all(
    Array.from(byLang.entries()).map(async ([lang, indices]) => {
      const texts = indices.map((i) => entries[i].text);

      // ONE translate call + ONE transliterate call + word breakdowns, all parallel
      const needsTranslit = lang in AZURE_TRANSLIT_SCRIPTS;
      const [translations, transliterations, wordBreakdowns] = await Promise.all([
        // Translate: Azure batch (1 call for all texts in this language)
        translateBatchWithAzure(texts, lang, targetLang).catch(() => texts.map(() => null)),

        // Transliterate: Azure batch OR Kuroshiro per-text (Japanese)
        needsTranslit
          ? transliterateBatchWithAzure(texts, lang).catch(() => texts.map(() => null))
          : lang === 'ja'
            ? Promise.all(texts.map((t) => romanizeJapanese(t).catch(() => null)))
            : Promise.resolve(texts.map(() => null)),

        // Word breakdown: run in parallel (Kuromoji local; generic uses cached per-word)
        Promise.all(
          texts.map((t) =>
            lang === 'ja'
              ? getJapaneseWordBreakdown(t).catch(() => [])
              : getGenericWordBreakdown(t, lang, targetLang).catch(() => []),
          ),
        ),
      ]);

      // Assemble + cache each result
      indices.forEach((globalIdx, j) => {
        const text = texts[j];
        const translation = translations[j] ?? text;
        const transliteration = transliterations[j] ?? text;
        const wordBreakdown = wordBreakdowns[j];

        const result: EnhancedSubtitle = {
          original: text,
          translation,
          transliteration,
          wordBreakdown,
          sourceLanguage: lang,
        };

        results[globalIdx] = result;

        const key = `${lang}|${targetLang}|${text}`;
        subtitleCache.set(key, result);
        translationCache.set(key, translation);

        const hash = cacheHash(lang, targetLang, text);
        dbCacheWrite(hash, {
          hash,
          source_lang: lang,
          target_lang: targetLang,
          source_text: text,
          translation,
          transliteration,
          word_breakdown: wordBreakdown,
        });
      });
    }),
  );

  // Fallback for any remaining nulls
  return entries.map(({ text, sourceLang }, i) => {
    return (results[i] as EnhancedSubtitle) ?? {
      original: text,
      translation: text,
      transliteration: text,
      wordBreakdown: [],
      sourceLanguage: sourceLang,
    };
  });
}
