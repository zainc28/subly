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

export interface EnhanceRequest {
  text: string;
  source_language: string;
  target_language?: string;
  video_id?: string;
  timestamp?: number;
}

export interface SaveWordRequest {
  word: string;
  transliteration: string;
  translation: string;
  context_sentence: string;
  source_language: string;
  video_url: string;
}
