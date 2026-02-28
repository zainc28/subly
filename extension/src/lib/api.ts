// Single place to change the backend URL (localhost for dev, Railway/Render URL for prod)
export const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

// ── Types (mirrors shared/types.ts) ──────────────────────────────────────────

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

export interface DictionaryEntry {
  id: string;
  user_id: string;
  word: string;
  transliteration: string;
  translation: string;
  context_sentence: string;
  source_language: string;
  video_url: string;
  created_at: string;
}

export interface UserSubscription {
  tier: 'free' | 'pro';
  minutesUsedToday: number;
  minutesLimit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function enhanceSubtitle(
  text: string,
  sourceLang: string,
  token: string | null = null,
): Promise<EnhancedSubtitle> {
  const res = await fetch(`${API_URL}/api/subtitles/enhance`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ text, source_language: sourceLang, target_language: 'en' }),
  });

  if (!res.ok) throw new Error(`enhance: ${res.status}`);
  return res.json() as Promise<EnhancedSubtitle>;
}

export async function getDictionary(token: string): Promise<DictionaryEntry[]> {
  const res = await fetch(`${API_URL}/api/dictionary`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`dictionary GET: ${res.status}`);
  return res.json() as Promise<DictionaryEntry[]>;
}

export async function saveWord(
  token: string,
  entry: {
    word: string;
    transliteration: string;
    translation: string;
    context_sentence: string;
    source_language: string;
    video_url: string;
  },
): Promise<{ alreadySaved?: boolean; entry?: DictionaryEntry }> {
  const res = await fetch(`${API_URL}/api/dictionary`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(entry),
  });

  if (res.status === 409) return { alreadySaved: true };
  if (!res.ok) throw new Error(`dictionary POST: ${res.status}`);
  return { entry: (await res.json()) as DictionaryEntry };
}

export async function deleteWord(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/dictionary/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`dictionary DELETE: ${res.status}`);
}

export async function getSubscription(token: string): Promise<UserSubscription> {
  const res = await fetch(`${API_URL}/api/user/subscription`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`subscription: ${res.status}`);
  return res.json() as Promise<UserSubscription>;
}
