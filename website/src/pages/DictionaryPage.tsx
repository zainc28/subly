import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getDictionary, deleteWord } from '../lib/api';
import type { DictionaryEntry } from '../lib/api';

// ── Language display names ────────────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
  ru: 'Russian', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese',
};

function langName(code: string) {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

// ── Trash icon ────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66H14.5a.5.5 0 0 0 0-1H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916Z" />
    </svg>
  );
}

// ── Word card ─────────────────────────────────────────────────────────────────

interface WordCardProps {
  entry: DictionaryEntry;
  onDelete: (id: string) => void;
}

function WordCard({ entry, onDelete }: WordCardProps) {
  const date = new Date(entry.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });

  return (
    <div className="dict-card">
      <div className="dict-card__top">
        <span className="dict-card__word">{entry.word}</span>
        <span className={`badge badge--${entry.source_language === 'ja' ? 'violet' : entry.source_language === 'ko' ? 'sky' : 'neutral'}`}>
          {langName(entry.source_language)}
        </span>
      </div>
      {entry.transliteration && entry.transliteration !== entry.word && (
        <div className="dict-card__romaji">{entry.transliteration}</div>
      )}
      {entry.translation && (
        <div className="dict-card__translation">{entry.translation}</div>
      )}
      {entry.context_sentence && (
        <div className="dict-card__context">"{entry.context_sentence}"</div>
      )}
      <div className="dict-card__footer">
        <span className="dict-card__date">{date}</span>
        {entry.video_url && (
          <a
            href={entry.video_url}
            target="_blank"
            rel="noreferrer"
            className="dict-card__source-link"
          >
            ▶ Source video
          </a>
        )}
        <button
          className="btn btn--danger dict-card__delete"
          onClick={() => onDelete(entry.id)}
          title="Remove word"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ── Dictionary Page ───────────────────────────────────────────────────────────

export default function DictionaryPage() {
  const [words, setWords] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState('all');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) { setLoading(false); return; }
      getDictionary(session.access_token)
        .then(setWords)
        .catch(() => setError('Failed to load dictionary'))
        .finally(() => setLoading(false));
    });
  }, []);

  async function handleDelete(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await deleteWord(session.access_token, id);
      setWords((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setError('Failed to remove word');
    }
  }

  const languages = useMemo(() => {
    const set = new Set(words.map((w) => w.source_language));
    return Array.from(set);
  }, [words]);

  const filtered = useMemo(() => {
    return words.filter((w) => {
      const matchLang = langFilter === 'all' || w.source_language === langFilter;
      const q = search.toLowerCase();
      const matchSearch = !q || w.word.toLowerCase().includes(q) || w.translation.toLowerCase().includes(q) || w.transliteration.toLowerCase().includes(q);
      return matchLang && matchSearch;
    });
  }, [words, search, langFilter]);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Dictionary</h1>
          <p className="page__subtitle">
            {words.length} word{words.length !== 1 ? 's' : ''} saved across {languages.length} language{languages.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="dict-controls">
        <input
          className="form-input dict-search"
          type="search"
          placeholder="Search words, translations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-input dict-lang-select"
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
        >
          <option value="all">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>{langName(l)}</option>
          ))}
        </select>
      </div>

      {error && <div className="alert alert--error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="empty-state">
          <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading your dictionary…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📖</div>
          <div className="empty-state__title">
            {words.length === 0 ? 'No words saved yet' : 'No results found'}
          </div>
          <div className="empty-state__desc">
            {words.length === 0
              ? 'Install the Subly extension and click any word while watching YouTube to save it here.'
              : 'Try adjusting your search or language filter.'}
          </div>
        </div>
      ) : (
        <div className="dict-grid">
          {filtered.map((entry) => (
            <WordCard key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <style>{`
        .page {
          padding: 32px 36px;
          max-width: 1100px;
        }

        .page__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 24px;
          gap: 16px;
        }

        .page__title {
          font-size: 26px;
          font-weight: 800;
          color: var(--color-text);
          letter-spacing: -0.4px;
          margin-bottom: 4px;
        }

        .page__subtitle {
          font-size: 13px;
          color: var(--color-text-muted);
        }

        .dict-controls {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .dict-search {
          flex: 1;
          min-width: 200px;
        }

        .dict-lang-select {
          width: auto;
          min-width: 160px;
          background: rgba(255,255,255,0.05);
          cursor: pointer;
        }

        .dict-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 14px;
        }

        .dict-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-left: 3px solid transparent;
          border-radius: var(--radius-lg);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
        }

        .dict-card:hover {
          border-left-color: var(--color-primary);
          border-color: rgba(124, 58, 237, 0.25);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
          transform: translateY(-1px);
        }

        .dict-card__top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }

        .dict-card__word {
          font-size: 20px;
          font-weight: 800;
          color: var(--color-primary-lit);
          letter-spacing: -0.2px;
          line-height: 1.2;
        }

        .dict-card__romaji {
          font-size: 13px;
          color: var(--color-sky-lit);
          font-style: italic;
        }

        .dict-card__translation {
          font-size: 14px;
          color: var(--color-text-2);
          font-weight: 500;
        }

        .dict-card__context {
          font-size: 12px;
          color: var(--color-text-muted);
          font-style: italic;
          line-height: 1.5;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .dict-card__footer {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }

        .dict-card__date {
          font-size: 11px;
          color: var(--color-text-faint);
          font-variant-numeric: tabular-nums;
        }

        .dict-card__source-link {
          font-size: 11px;
          color: var(--color-primary);
          font-weight: 500;
          transition: color 0.15s;
          text-decoration: none;
        }

        .dict-card__source-link:hover { color: var(--color-primary-lit); }

        .dict-card__delete {
          margin-left: auto;
          padding: 5px 8px;
        }
      `}</style>
    </div>
  );
}
