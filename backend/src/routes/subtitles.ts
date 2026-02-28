import { Router } from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth';
import { enhanceSubtitle, detectLanguage } from '../services/translation';

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

export default router;
