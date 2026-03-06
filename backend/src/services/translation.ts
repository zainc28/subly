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

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang = 'en',
): Promise<string> {
  const cacheKey = `${sourceLang}|${targetLang}|${text}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey)!;

  const result =
    (await translateWithGoogle(text, sourceLang, targetLang)) ??
    (await translateWithMyMemory(text, sourceLang, targetLang)) ??
    text;

  if (result !== text) translationCache.set(cacheKey, result);
  return result;
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

  // Romanisation (Kuroshiro — local, fast)
  const transliterationPromise: Promise<string> = sourceLang === 'ja'
    ? romanizeJapanese(text).catch(() => text)
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

  // Limit cache size
  if (subtitleCache.size > 500) {
    const firstKey = subtitleCache.keys().next().value;
    if (firstKey) subtitleCache.delete(firstKey);
  }

  return result;
}
