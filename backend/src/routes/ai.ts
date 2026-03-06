import { Router } from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth';
import { getAIDefinition } from '../services/ai';

const router = Router();

/**
 * POST /api/ai/define
 * Body: { word, transliteration?, translation?, sourceLanguage?,
 *         recentSubtitles?, upcomingSubtitles?, videoTitle? }
 * Returns: { definition: string }
 *
 * Requires GROQ_API_KEY in environment — returns 503 if not set.
 * Uses optionalAuth so both free and signed-in users can access it.
 */
router.post('/define', optionalAuth, async (req: Request, res: Response) => {
  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({ error: 'AI feature not configured on this server' });
    return;
  }

  const {
    word,
    transliteration,
    translation,
    sourceLanguage,
    recentSubtitles,
    upcomingSubtitles,
    videoTitle,
  } = req.body as {
    word?: string;
    transliteration?: string;
    translation?: string;
    sourceLanguage?: string;
    recentSubtitles?: unknown;
    upcomingSubtitles?: unknown;
    videoTitle?: string;
  };

  if (!word || typeof word !== 'string' || !word.trim()) {
    res.status(400).json({ error: 'word is required' });
    return;
  }

  try {
    const definition = await getAIDefinition({
      word: word.trim(),
      transliteration: typeof transliteration === 'string' ? transliteration : word,
      translation: typeof translation === 'string' ? translation : '',
      sourceLanguage: typeof sourceLanguage === 'string' ? sourceLanguage : 'ja',
      recentSubtitles: Array.isArray(recentSubtitles)
        ? (recentSubtitles as unknown[]).filter((s) => typeof s === 'string').slice(0, 5) as string[]
        : [],
      upcomingSubtitles: Array.isArray(upcomingSubtitles)
        ? (upcomingSubtitles as unknown[]).filter((s) => typeof s === 'string').slice(0, 5) as string[]
        : [],
      videoTitle: typeof videoTitle === 'string' && videoTitle.trim() ? videoTitle.trim() : 'Unknown Video',
    });

    res.json({ definition });
  } catch (err) {
    console.error('[ai/define] error:', err);
    res.status(500).json({ error: 'AI definition failed' });
  }
});

export default router;
