import React from 'react';

interface ExerciseCardProps {
  icon: string;
  title: string;
  desc: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  locked: boolean;
}

const DIFFICULTY_COLORS = {
  Beginner:     { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.25)',  text: '#34d399' },
  Intermediate: { bg: 'rgba(14,165,233,0.12)',  border: 'rgba(14,165,233,0.25)',  text: '#38bdf8' },
  Advanced:     { bg: 'rgba(124,58,237,0.14)',  border: 'rgba(124,58,237,0.3)',   text: '#a78bfa' },
};

function ExerciseCard({ icon, title, desc, difficulty, locked }: ExerciseCardProps) {
  const dc = DIFFICULTY_COLORS[difficulty];

  return (
    <div className={`exercise-card ${locked ? 'exercise-card--locked' : ''}`}>
      {locked && <div className="exercise-card__soon">Soon</div>}
      <div className="exercise-card__icon">{icon}</div>
      <div className="exercise-card__body">
        <div className="exercise-card__title">{title}</div>
        <div className="exercise-card__desc">{desc}</div>
      </div>
      <div className="exercise-card__footer">
        <span
          className="badge"
          style={{ background: dc.bg, border: `1px solid ${dc.border}`, color: dc.text }}
        >
          {difficulty}
        </span>
        {!locked && (
          <button className="btn btn--primary btn--sm" style={{ padding: '6px 16px' }}>
            Start
          </button>
        )}
      </div>
    </div>
  );
}

const EXERCISES: ExerciseCardProps[] = [
  {
    icon: '✏️',
    title: 'Fill in the Blank',
    desc: 'Complete sentences using your saved vocabulary. Great for building active recall.',
    difficulty: 'Beginner',
    locked: true,
  },
  {
    icon: '🔄',
    title: 'Translation Quiz',
    desc: 'Translate words from your dictionary between native and target language.',
    difficulty: 'Beginner',
    locked: true,
  },
  {
    icon: '👂',
    title: 'Listening Exercise',
    desc: 'Hear native pronunciation and transcribe what you hear using saved words as hints.',
    difficulty: 'Intermediate',
    locked: true,
  },
  {
    icon: '🎯',
    title: 'Word Matching',
    desc: 'Match words to their meanings and transliterations against the clock.',
    difficulty: 'Beginner',
    locked: true,
  },
  {
    icon: '✍️',
    title: 'Writing Practice',
    desc: 'Practice writing characters for CJK and other script-based languages.',
    difficulty: 'Advanced',
    locked: true,
  },
  {
    icon: '🗣️',
    title: 'Pronunciation Check',
    desc: 'Record yourself and compare pronunciation against native reference audio.',
    difficulty: 'Intermediate',
    locked: true,
  },
];

export default function ExercisesPage() {
  const byDifficulty: Record<string, ExerciseCardProps[]> = {};
  for (const ex of EXERCISES) {
    if (!byDifficulty[ex.difficulty]) byDifficulty[ex.difficulty] = [];
    byDifficulty[ex.difficulty].push(ex);
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Exercises</h1>
          <p className="page__subtitle">Practice and reinforce your saved vocabulary</p>
        </div>
      </div>

      <div className="exercises-banner">
        <div className="exercises-banner__icon">⚡</div>
        <div>
          <div className="exercises-banner__title">Exercises coming soon</div>
          <div className="exercises-banner__desc">
            We're building a full exercise system tailored to your saved words.
            Save words from YouTube now — they'll power every exercise below.
          </div>
        </div>
      </div>

      {(Object.entries(byDifficulty) as [string, ExerciseCardProps[]][]).map(([diff, items]) => (
        <div key={diff} className="exercises-section">
          <h2 className="exercises-section__title">{diff}</h2>
          <div className="exercises-list">
            {items.map((ex) => (
              <ExerciseCard key={ex.title} {...ex} />
            ))}
          </div>
        </div>
      ))}

      <style>{`
        .page {
          padding: 32px 36px;
          max-width: 900px;
        }

        .page__header {
          margin-bottom: 24px;
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

        .exercises-banner {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          background: rgba(124,58,237,0.1);
          border: 1px solid rgba(124,58,237,0.22);
          border-radius: var(--radius-lg);
          padding: 20px;
          margin-bottom: 32px;
        }

        .exercises-banner__icon {
          font-size: 28px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .exercises-banner__title {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-primary-lit);
          margin-bottom: 6px;
        }

        .exercises-banner__desc {
          font-size: 13px;
          color: var(--color-text-2);
          line-height: 1.6;
        }

        .exercises-section {
          margin-bottom: 28px;
        }

        .exercises-section__title {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 12px;
        }

        .exercises-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .exercise-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          position: relative;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .exercise-card:not(.exercise-card--locked):hover {
          border-color: rgba(124,58,237,0.35);
          box-shadow: 0 4px 20px rgba(0,0,0,0.18);
        }

        .exercise-card--locked {
          opacity: 0.6;
        }

        .exercise-card__soon {
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

        .exercise-card__icon {
          font-size: 28px;
          flex-shrink: 0;
          width: 44px;
          text-align: center;
        }

        .exercise-card__body {
          flex: 1;
          min-width: 0;
        }

        .exercise-card__title {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-text);
          margin-bottom: 4px;
          letter-spacing: -0.1px;
        }

        .exercise-card__desc {
          font-size: 12px;
          color: var(--color-text-muted);
          line-height: 1.5;
        }

        .exercise-card__footer {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
