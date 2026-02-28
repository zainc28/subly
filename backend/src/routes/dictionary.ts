import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';

const router = Router();

/** GET /api/dictionary — list saved words for authenticated user */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('user_dictionaries')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[dictionary/GET]', error);
    res.status(500).json({ error: 'Failed to fetch dictionary' });
    return;
  }

  res.json(data);
});

/** POST /api/dictionary — save a word */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const { word, transliteration, translation, context_sentence, source_language, video_url } =
    req.body as {
      word?: string;
      transliteration?: string;
      translation?: string;
      context_sentence?: string;
      source_language?: string;
      video_url?: string;
    };

  if (!word || !translation) {
    res.status(400).json({ error: 'word and translation are required' });
    return;
  }

  // Duplicate check
  const { data: existing } = await supabaseAdmin
    .from('user_dictionaries')
    .select('id')
    .eq('user_id', req.user!.id)
    .eq('word', word)
    .maybeSingle();

  if (existing) {
    res.status(409).json({ error: 'already_saved', id: existing.id });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('user_dictionaries')
    .insert({
      user_id: req.user!.id,
      word,
      transliteration: transliteration ?? '',
      translation,
      context_sentence: context_sentence ?? '',
      source_language: source_language ?? 'unknown',
      video_url: video_url ?? '',
    })
    .select()
    .single();

  if (error) {
    console.error('[dictionary/POST]', error);
    res.status(500).json({ error: 'Failed to save word' });
    return;
  }

  res.status(201).json(data);
});

/** DELETE /api/dictionary/:id — delete a saved word */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('user_dictionaries')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user!.id); // ensure ownership

  if (error) {
    console.error('[dictionary/DELETE]', error);
    res.status(500).json({ error: 'Failed to delete word' });
    return;
  }

  res.status(204).send();
});

export default router;
