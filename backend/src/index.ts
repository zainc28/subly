import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import { initKuroshiro } from './services/translation';
import subtitlesRouter from './routes/subtitles';
import dictionaryRouter from './routes/dictionary';
import userRouter from './routes/user';
import aiRouter from './routes/ai';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://www.youtube.com',
  'http://localhost:5173',
  'http://localhost:3000',
];

// Chrome's "Private Network Access" spec blocks HTTPS pages (YouTube) from
// fetching http://localhost unless the server opts in via this header.
// This MUST come before the cors() middleware so it's included in preflight replies.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) return callback(null, true);
      // Allow any chrome-extension origin
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/subtitles', subtitlesRouter);
app.use('/api/dictionary', dictionaryRouter);
app.use('/api/user', userRouter);
app.use('/api/ai', aiRouter);

// ── Start ──────────────────────────────────────────────────────────────────────

async function main() {
  // Pre-warm Kuroshiro so first subtitle request isn't slow
  initKuroshiro().catch((err) => {
    console.error('[Subly] Kuroshiro init failed — Japanese romanisation unavailable:', err);
  });

  app.listen(PORT, () => {
    console.log(`[Subly] Backend running on http://localhost:${PORT}`);
  });
}

main();
