import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';

const router = Router();

/** GET /api/user/subscription — return tier + usage */
router.get('/subscription', requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('tier, minutes_used_today, minutes_limit')
    .eq('id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    // Return defaults if no user row yet
    res.json({ tier: 'free', minutesUsedToday: 0, minutesLimit: 30 });
    return;
  }

  res.json({
    tier: data.tier ?? 'free',
    minutesUsedToday: data.minutes_used_today ?? 0,
    minutesLimit: data.minutes_limit ?? 30,
  });
});

export default router;
