import { Router } from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth';
import { enhanceSubtitle, enhanceBatch, detectLanguage } from '../services/translation';
import type { EnhancedSubtitle } from '../services/translation';

const router = Router();

/**
 * POST /api/subtitles/enhance
 * Body: { text, source_language, target_language?, video_id?, timestamp? }
 * Returns: EnhancedSubtitle
 *
 * Uses optionalAuth so unauthenticated users still get translations.
 */
router.post('/enhance', optionalAuth, async (req: Request, res: Response) => {
  const { text, source_language, target_language = 'en' } = req.body as {
    text?: string;
    source_language?: string;
    target_language?: string;
    video_id?: string;
    timestamp?: number;
  };

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const trimmed = text.trim();
  const sourceLang = source_language || detectLanguage(trimmed);

  console.log(`[enhance] lang=${sourceLang} text="${trimmed.slice(0, 40)}"`);

  try {
    const result = await enhanceSubtitle(trimmed, sourceLang, target_language);
    res.json(result);
  } catch (err) {
    console.error('[subtitles/enhance] error:', err);
    // Fallback — never leave the client blank
    res.json({
      original: trimmed,
      transliteration: trimmed,
      translation: trimmed,
      wordBreakdown: [],
      sourceLanguage: sourceLang,
    });
  }
});

/**
 * POST /api/subtitles/enhance-batch
 * Body: { entries: Array<{ text, source_language? }> }
 * Returns: EnhancedSubtitle[]  (same order, failed entries get a passthrough fallback)
 *
 * Processes up to 20 subtitles in parallel — one HTTP round-trip for the whole
 * preload window instead of one per subtitle.
 */
router.post('/enhance-batch', optionalAuth, async (req: Request, res: Response) => {
  const { entries } = req.body as {
    entries?: Array<{ text?: string; source_language?: string }>;
  };

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: 'entries array required' });
    return;
  }

  // Normalise + deduplicate entries before passing to enhanceBatch
  const seen = new Map<string, { text: string; sourceLang: string }>();
  for (const { text, source_language } of entries.slice(0, 20)) {
    const trimmed = text?.trim() ?? '';
    if (!trimmed) continue;
    const lang = source_language || detectLanguage(trimmed);
    const key = `${lang}|${trimmed}`;
    if (!seen.has(key)) seen.set(key, { text: trimmed, sourceLang: lang });
  }

  const deduped = Array.from(seen.values());
  const batchResults = await enhanceBatch(deduped).catch(() => [] as EnhancedSubtitle[]);

  // Re-index: map original (potentially duplicated) entries back to results
  const resultMap = new Map<string, EnhancedSubtitle>();
  deduped.forEach(({ text, sourceLang }, i) => {
    if (batchResults[i]) resultMap.set(`${sourceLang}|${text}`, batchResults[i]);
  });

  res.json(
    entries.slice(0, 20).map(({ text, source_language }) => {
      const trimmed = text?.trim() ?? '';
      const lang = source_language || detectLanguage(trimmed);
      return (
        resultMap.get(`${lang}|${trimmed}`) ?? {
          original: trimmed,
          transliteration: trimmed,
          translation: trimmed,
          wordBreakdown: [],
          sourceLanguage: lang,
        }
      );
    }),
  );
});

export default router;
