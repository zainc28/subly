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
  })();

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

// ── Translation (MyMemory) ────────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang = 'en',
): Promise<string> {
  const cacheKey = `${sourceLang}|${targetLang}|${text}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey)!;

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as any;

    if (data.responseStatus === 200) {
      const translated = decodeHtmlEntities(data.responseData.translatedText as string);
      // MyMemory sometimes echoes the query when it can't translate
      if (translated && translated !== text) {
        translationCache.set(cacheKey, translated);
        return translated;
      }
    }
  } catch {
    // network / timeout — fall through to original
  }

  return text;
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
  const result: WordBreakdown[] = [];
  let charIndex = 0;

  const translationPromises = tokens.map(async (token: any) => {
    const word: string = token.surface_form;
    const startIndex = charIndex;
    const endIndex = charIndex + word.length;
    charIndex = endIndex;

    // Romanise this token
    let transliteration = '';
    try {
      transliteration = await romanizeJapanese(word, 'normal');
      transliteration = transliteration.trim();
    } catch {
      transliteration = word;
    }

    // Translate content words only
    let translation = '';
    const shouldTranslate = !SKIP_POS.some((pos) => token.pos?.startsWith(pos));
    if (shouldTranslate && word.trim().length > 0) {
      translation = await translateText(word, 'ja', 'en');
      // If translation equals original (untranslatable) just omit it
      if (translation === word) translation = '';
    }

    return { word, transliteration, translation, startIndex, endIndex };
  });

  // Translate all words concurrently
  const breakdown = await Promise.all(translationPromises);
  result.push(...breakdown);
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
  // For CJK-character languages, split into individual characters (each is a word unit)
  const tokens: string[] = CJK_CHAR_LANGS.has(sourceLang)
    ? Array.from(text).filter((c) => c.trim())      // every non-whitespace char
    : text.split(/\s+/).filter((w) => w.trim());     // space-delimited words

  const result: WordBreakdown[] = [];
  let charIndex = 0;

  // Find the start index of each token in the original text
  for (const token of tokens) {
    const startIndex = text.indexOf(token, charIndex);
    const endIndex = startIndex + token.length;
    charIndex = endIndex;

    // Translate (skip common function-word single chars to save API calls)
    const translation = await translateText(token, sourceLang, targetLang);
    result.push({
      word: token,
      transliteration: token, // no romanisation for generic paths
      translation: translation !== token ? translation : '',
      startIndex,
      endIndex,
    });
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

  // Full-sentence translation (always)
  const translationPromise = translateText(text, sourceLang, targetLang);

  // Romanisation
  let transliterationPromise: Promise<string>;
  if (sourceLang === 'ja') {
    transliterationPromise = romanizeJapanese(text).catch(() => text);
  } else {
    transliterationPromise = Promise.resolve(text);
  }

  // Word breakdown
  let wordBreakdownPromise: Promise<WordBreakdown[]>;
  if (sourceLang === 'ja') {
    wordBreakdownPromise = getJapaneseWordBreakdown(text).catch(() => []);
  } else {
    wordBreakdownPromise = getGenericWordBreakdown(text, sourceLang, targetLang).catch(() => []);
  }

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
