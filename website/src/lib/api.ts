// All API calls to the Subly backend

export const API_URL = (import.meta.env.VITE_API_URL as string) || 'https://subly-backend.railway.app';

// ── Types ─────────────────────────────────────────────────────────────────────

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

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getDictionary(token: string): Promise<DictionaryEntry[]> {
  const res = await fetch(`${API_URL}/api/dictionary`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`dictionary GET: ${res.status}`);
  return res.json() as Promise<DictionaryEntry[]>;
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
