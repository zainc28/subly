import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getDictionary, getSubscription } from '../lib/api';
import type { UserSubscription } from '../lib/api';

interface StatCardProps {
  value: string | number;
  label: string;
  icon: string;
  accent?: 'violet' | 'sky' | 'green';
}

function StatCard({ value, label, icon, accent = 'violet' }: StatCardProps) {
  const colors = {
    violet: { bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.25)', text: '#a78bfa' },
    sky:    { bg: 'rgba(14,165,233,0.1)',  border: 'rgba(14,165,233,0.22)',  text: '#38bdf8' },
    green:  { bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.22)', text: '#34d399' },
  }[accent];

  return (
    <div className="stat-card" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__value" style={{ color: colors.text }}>{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

interface FeatureCardProps {
  icon: string;
  title: string;
  desc: string;
}

function ComingSoonCard({ icon, title, desc }: FeatureCardProps) {
  return (
    <div className="feature-card">
      <div className="feature-card__lock">Soon</div>
      <div className="feature-card__icon">{icon}</div>
      <div className="feature-card__title">{title}</div>
      <div className="feature-card__desc">{desc}</div>
    </div>
  );
}

export default function LearningPage() {
  const [totalWords, setTotalWords] = useState<number | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      const token = session.access_token;

      getDictionary(token).then((entries) => {
        setTotalWords(entries.length);
        const langs = Array.from(new Set(entries.map((e) => e.source_language)));
        setLanguages(langs);
      }).catch(() => null);

      getSubscription(token).then(setSubscription).catch(() => null);
    });
  }, []);

  const LANG_FLAGS: Record<string, string> = {
    ja: '🇯🇵', ko: '🇰🇷', zh: '🇨🇳', ar: '🇸🇦',
    ru: '🇷🇺', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪',
  };

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Learning</h1>
          <p className="page__subtitle">Track your progress and study vocabulary</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <StatCard
          value={totalWords ?? '—'}
          label="Words saved"
          icon="📚"
          accent="violet"
        />
        <StatCard
          value={languages.length || '—'}
          label="Languages studied"
          icon="🌍"
          accent="sky"
        />
        <StatCard
          value={subscription ? `${subscription.minutesUsedToday}m` : '—'}
          label="Minutes today"
          icon="⏱️"
          accent="green"
        />
      </div>

      {/* Languages studied */}
      {languages.length > 0 && (
        <div className="learn-section">
          <h2 className="learn-section__title">Languages you're studying</h2>
          <div className="lang-chips">
            {languages.map((l) => (
              <div key={l} className="lang-chip">
                <span>{LANG_FLAGS[l] ?? '🌐'}</span>
                <span>{l.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coming soon features */}
      <div className="learn-section">
        <h2 className="learn-section__title">Coming soon</h2>
        <div className="features-grid">
          <ComingSoonCard
            icon="🃏"
            title="Flashcard Review"
            desc="Spaced repetition flashcards built from your saved words, optimised for long-term retention."
          />
          <ComingSoonCard
            icon="📈"
            title="Progress Tracking"
            desc="Visualise your vocabulary growth over time with streaks, milestones, and weekly stats."
          />
          <ComingSoonCard
            icon="🔁"
            title="Spaced Repetition"
            desc="Smart scheduling shows you words exactly when you're about to forget them."
          />
          <ComingSoonCard
            icon="🤖"
            title="AI Conversation"
            desc="Practice using your saved words in AI-powered conversations in your target language."
          />
        </div>
      </div>

      <style>{`
        .page {
          padding: 32px 36px;
          max-width: 1000px;
        }

        .page__header {
          margin-bottom: 28px;
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

        .stats-row {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 14px;
          margin-bottom: 32px;
        }

        .stat-card {
          border-radius: var(--radius-lg);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .stat-card__icon { font-size: 22px; margin-bottom: 2px; }
        .stat-card__value { font-size: 30px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
        .stat-card__label { font-size: 12px; color: var(--color-text-muted); font-weight: 500; }

        .learn-section { margin-bottom: 32px; }

        .learn-section__title {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 14px;
        }

        .lang-chips { display: flex; flex-wrap: wrap; gap: 8px; }

        .lang-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 99px;
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-2);
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 14px;
        }

        .feature-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          opacity: 0.7;
        }

        .feature-card__lock {
          position: absolute;
          top: 12px;
          right: 12px;
          font-size: 10px;
          font-weight: 700;
          color: var(--color-text-faint);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 4px;
          padding: 2px 6px;
          letter-spacing: 0.05em;
        }

        .feature-card__icon { font-size: 26px; }
        .feature-card__title { font-size: 15px; font-weight: 700; color: var(--color-text); }
        .feature-card__desc { font-size: 12px; color: var(--color-text-muted); line-height: 1.6; }
      `}</style>
    </div>
  );
}
