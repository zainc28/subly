// ── Groq API — free tier: llama-3.1-8b-instant ───────────────────────────────
// Sign up at https://console.groq.com and add GROQ_API_KEY to backend/.env

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const LANG_LABELS: Record<string, string> = {
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
  ru: 'Russian',
};

export interface AIDefineParams {
  word: string;
  transliteration: string;
  translation: string;
  sourceLanguage: string;
  recentSubtitles: string[];
  upcomingSubtitles: string[];
  videoTitle: string;
}

function buildPrompt(p: AIDefineParams): string {
  const lang = LANG_LABELS[p.sourceLanguage] ?? 'foreign language';
  const romajiPart =
    p.transliteration && p.transliteration !== p.word ? ` (${p.transliteration})` : '';
  const translationPart = p.translation ? `, literally "${p.translation}"` : '';

  const contextParts: string[] = [];
  if (p.recentSubtitles.length) {
    contextParts.push(`Recent dialogue:\n${p.recentSubtitles.map((s) => `  "${s}"`).join('\n')}`);
  }
  if (p.upcomingSubtitles.length) {
    contextParts.push(
      `Upcoming dialogue:\n${p.upcomingSubtitles.map((s) => `  "${s}"`).join('\n')}`,
    );
  }

  return `You are a helpful language learning assistant. A student is watching a ${lang} video called "${p.videoTitle}".

They want to understand the word "${p.word}"${romajiPart}${translationPart}.

${contextParts.join('\n\n')}

In 1-2 sentences, explain what "${p.word}" means in THIS specific context. Include any nuance, tone, or cultural note that would help a language learner. Be concise and practical.`;
}

export async function getAIDefinition(params: AIDefineParams): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const prompt = buildPrompt(params);

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? 'No definition available.';
}
