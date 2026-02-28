import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getDictionary, deleteWord, getSubscription } from '../lib/api';
import type { DictionaryEntry, UserSubscription } from '../lib/api';
import type { User } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────

type View = 'auth' | 'dashboard' | 'dictionary';
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

// ── Dashboard view ────────────────────────────────────────────────────────────

function DashboardView({
  user,
  onSignOut,
  onOpenDictionary,
}: {
  user: User;
  onSignOut: () => void;
  onOpenDictionary: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [isYouTube, setIsYouTube] = useState(false);

  useEffect(() => {
    // Read toggle state
    chrome.storage.local.get('subly_enabled', (r) => setEnabled(!!r.subly_enabled));

    // Check if current tab is YouTube
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url ?? '';
      setIsYouTube(url.includes('youtube.com'));
    });

    // Load subscription
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        getSubscription(session.access_token)
          .then(setSubscription)
          .catch(() => null);
      }
    });
  }, []);

  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    await chrome.storage.local.set({ subly_enabled: next });

    // Notify content script on active YouTube tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'TOGGLE', enabled: next }).catch(() => {});
      }
    });
  }

  function openYouTube() {
    chrome.tabs.create({ url: 'https://www.youtube.com' });
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

      {/* Actions */}
      <div className="action-row">
        <button className="btn btn--secondary btn--full" onClick={onOpenDictionary}>
          📚 My Dictionary
        </button>
        {!isYouTube && (
          <button className="btn btn--primary btn--full" onClick={openYouTube}>
            ▶ Open YouTube
          </button>
        )}
      </div>
    </div>
  );
}

// ── Dictionary view ───────────────────────────────────────────────────────────

function DictionaryView({ onBack }: { onBack: () => void }) {
  const [words, setWords] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadWords();
  }, []);

  async function loadWords() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const entries = await getDictionary(session.access_token);
      setWords(entries);
    } catch {
      setError('Failed to load dictionary');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await deleteWord(session.access_token, id);
      setWords((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setError('Failed to delete word');
    }
  }

  const filtered = filter
    ? words.filter(
        (w) =>
          w.word.toLowerCase().includes(filter.toLowerCase()) ||
          w.translation.toLowerCase().includes(filter.toLowerCase()),
      )
    : words;

  return (
    <div className="view dictionary-view">
      <header className="dict-header">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          ← Back
        </button>
        <h2 className="dict-title">My Dictionary</h2>
        <span className="dict-count">{words.length} words</span>
      </header>

      <div className="dict-search">
        <input
          className="form-input"
          placeholder="Search words…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {filter ? 'No matches found' : 'No words saved yet.\nClick any word while watching to save it!'}
        </div>
      ) : (
        <div className="word-list">
          {filtered.map((entry) => (
            <div key={entry.id} className="word-card">
              <div className="word-card__main">
                <span className="word-card__word">{entry.word}</span>
                {entry.transliteration && entry.transliteration !== entry.word && (
                  <span className="word-card__romaji">{entry.transliteration}</span>
                )}
              </div>
              <div className="word-card__translation">{entry.translation}</div>
              {entry.context_sentence && (
                <div className="word-card__context">{entry.context_sentence}</div>
              )}
              <button
                className="word-card__delete"
                onClick={() => handleDelete(entry.id)}
                title="Remove word"
              >
                ×
              </button>
            </div>
          ))}
        </div>
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
    // Check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setView('dashboard');
      }
      setLoading(false);
    });

    // Listen for auth changes
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
    // Also disable Subly
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
          onOpenDictionary={() => setView('dictionary')}
        />
      )}
      {view === 'dictionary' && <DictionaryView onBack={() => setView('dashboard')} />}
    </div>
  );
}
