import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../services/supabase';
import type { User } from '@supabase/supabase-js';

// Extend Express Request to carry the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Hard auth — returns 401 if no valid token. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.user = data.user;
  next();
}

/** Soft auth — attaches user if token present, continues either way. */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (token) {
    try {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) req.user = data.user;
    } catch {
      // Silently ignore — unauthenticated path still works
    }
  }

  next();
}
