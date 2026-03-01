import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getDictionary, deleteWord, getSubscription } from '../lib/api';
import type { DictionaryEntry, UserSubscription } from '../lib/api';
import type { User } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────

type View = 'auth' | 'dashboard';
type AuthMode = 'signin' | 'signup';

// ── Stars background ─────────────────────────────────────────────────────────

function Stars() {
  return (
    <div className="stars" aria-hidden="true">
      {Array.from({ length: 60 }).map((_, i) => (
        <div
          key={i}
          className="star"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: `${Math.random() * 2 + 1}px`,
            height: `${Math.random() * 2 + 1}px`,
            animationDelay: `${Math.random() * 3}s`,
            animationDuration: `${Math.random() * 3 + 2}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Auth view ─────────────────────────────────────────────────────────────────

function AuthView({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.user) onAuth(data.user);
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user && !data.user.email_confirmed_at) {
          setSuccess('Check your email to confirm your account!');
        } else if (data.user) {
          onAuth(data.user);
        }
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="view auth-view">
      <div className="auth-logo">
        <div className="logo-mark">S</div>
        <div className="logo-text">
          <span className="logo-name">Subly</span>
          <span className="logo-tagline">Language learning, reimagined</span>
        </div>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="tab-row">
          <button
            type="button"
            className={`tab ${mode === 'signin' ? 'tab--active' : ''}`}
            onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`tab ${mode === 'signup' ? 'tab--active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
          >
            Sign Up
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            className="form-input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </div>

        {error && <div className="alert alert--error">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}

        <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}

// ── Dictionary definition lookup (Free Dictionary API, no key needed) ────────

async function fetchDefinition(englishWord: string): Promise<string> {
  // Only attempt single/double-word purely alphabetic translations
  const words = englishWord.trim().split(/\s+/);
  if (words.length > 3 || !/^[a-zA-Z\s''-]+$/.test(englishWord.trim())) return '';
  const lookup = words[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!lookup) return '';
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lookup)}`);
    if (!res.ok) return '';
    const data = await res.json() as Array<{ meanings: Array<{ definitions: Array<{ definition: string }> }> }>;
    return data[0]?.meanings?.[0]?.definitions?.[0]?.definition ?? '';
  } catch {
    return '';
  }
}

// ── Trash icon ────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden="true">
      <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66H14.5a.5.5 0 0 0 0-1H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5h9.916Zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 0 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────────

function DashboardView({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [isYouTube, setIsYouTube] = useState(false);
  const [words, setWords] = useState<DictionaryEntry[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [deleteError, setDeleteError] = useState('');
  const [definitions, setDefinitions] = useState<Record<string, string>>({});

  useEffect(() => {
    chrome.storage.local.get('subly_enabled', (r) => setEnabled(!!r.subly_enabled));

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url ?? '';
      setIsYouTube(url.includes('youtube.com'));
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      getSubscription(session.access_token)
        .then(setSubscription)
        .catch(() => null);
      getDictionary(session.access_token)
        .then((entries) => {
          const recent = entries.slice(0, 10);
          setWords(recent);
          // Fetch definitions for each word's English translation in parallel
          recent.forEach((entry) => {
            if (!entry.translation) return;
            fetchDefinition(entry.translation).then((def) => {
              if (def) setDefinitions((prev) => ({ ...prev, [entry.id]: def }));
            });
          });
        })
        .catch(() => null)
        .finally(() => setWordsLoading(false));
    });
  }, []);

  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    await chrome.storage.local.set({ subly_enabled: next });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'TOGGLE', enabled: next }).catch(() => {});
      }
    });
  }

  async function handleDelete(id: string) {
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await deleteWord(session.access_token, id);
      setWords((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setDeleteError('Failed to remove word');
    }
  }

  function openYouTube() {
    chrome.tabs.create({ url: 'https://www.youtube.com' });
  }

  function openFullDictionary() {
    chrome.tabs.create({ url: 'https://subly.app/dictionary' });
  }

  const usedPct =
    subscription
      ? Math.min(100, (subscription.minutesUsedToday / subscription.minutesLimit) * 100)
      : 0;

  return (
    <div className="view dashboard-view">
      <header className="dash-header">
        <div className="dash-logo">
          <div className="logo-mark logo-mark--sm">S</div>
          <span className="logo-name">Subly</span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className="user-badge">{user.email}</div>

      {/* Toggle */}
      <div className={`toggle-card ${isYouTube ? '' : 'toggle-card--disabled'}`}>
        <div className="toggle-info">
          <span className="toggle-label">
            {enabled && isYouTube ? '✦ Subly Active' : 'Enable Subly'}
          </span>
          {!isYouTube && (
            <span className="toggle-hint">Open YouTube to enable</span>
          )}
        </div>
        <button
          className={`toggle-switch ${enabled ? 'toggle-switch--on' : ''}`}
          onClick={toggleEnabled}
          disabled={!isYouTube}
          aria-label="Toggle Subly"
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {/* Usage meter */}
      {subscription && (
        <div className="usage-card">
          <div className="usage-header">
            <span className="usage-label">Today's usage</span>
            <span className="usage-count">
              {subscription.minutesUsedToday} / {subscription.minutesLimit} min
            </span>
          </div>
          <div className="usage-bar">
            <div
              className={`usage-fill ${usedPct > 80 ? 'usage-fill--warn' : ''}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          {subscription.tier === 'free' && (
            <p className="usage-tier">Free plan · {subscription.minutesLimit} min/day</p>
          )}
        </div>
      )}

      {/* Recent saved words */}
      <div className="recent-words">
        <div className="recent-words__header">
          <span className="recent-words__title">Recent Saves</span>
          <button className="recent-words__link" onClick={openFullDictionary}>
            View all →
          </button>
        </div>

        {deleteError && <div className="alert alert--error" style={{ fontSize: 12, padding: '6px 10px' }}>{deleteError}</div>}

        {wordsLoading ? (
          <div className="recent-words__empty">Loading…</div>
        ) : words.length === 0 ? (
          <div className="recent-words__empty">
            No words saved yet.{'\n'}Click any word while watching to save it!
          </div>
        ) : (
          <div className="recent-words__list">
            {words.map((entry) => (
              <div key={entry.id} className="word-card">
                <div className="word-card__header">
                  <span className="word-card__word">{entry.word}</span>
                  {entry.transliteration && entry.transliteration !== entry.word && (
                    <span className="word-card__romaji">{entry.transliteration}</span>
                  )}
                  {entry.translation && (
                    <span className="word-card__en">{entry.translation}</span>
                  )}
                </div>
                {definitions[entry.id] && (
                  <div className="word-card__definition">{definitions[entry.id]}</div>
                )}
                {entry.context_sentence && (
                  <div className="word-card__context">{entry.context_sentence}</div>
                )}
                <button
                  className="word-card__delete"
                  onClick={() => handleDelete(entry.id)}
                  title="Remove word"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isYouTube && (
        <button className="btn btn--primary btn--full" onClick={openYouTube}>
          ▶ Open YouTube
        </button>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setView('dashboard');
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setView('dashboard');
      } else {
        setUser(null);
        setView('auth');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = useCallback((u: User) => {
    setUser(u);
    setView('dashboard');
  }, []);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setView('auth');
    chrome.storage.local.set({ subly_enabled: false });
  }, []);

  if (loading) {
    return (
      <div className="app">
        <Stars />
        <div className="loading-state" style={{ marginTop: 120 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Stars />
      {view === 'auth' && <AuthView onAuth={handleAuth} />}
      {view === 'dashboard' && user && (
        <DashboardView
          user={user}
          onSignOut={handleSignOut}
        />
      )}
    </div>
  );
}
