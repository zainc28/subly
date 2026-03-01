import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

interface AuthPageProps {
  onAuth: (user: User) => void;
}

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Detect password reset token in URL hash (from Supabase email link)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('type=signup')) {
      // Supabase will handle the session from the hash automatically
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user && hash.includes('type=recovery')) {
          setMode('reset');
        } else if (session?.user) {
          onAuth(session.user);
        }
      });
    }
  }, [onAuth]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError('');
    setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (err) throw err;
        setSuccess('Reset link sent — check your email.');

      } else if (mode === 'reset') {
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        setSuccess('Password updated! Signing you in…');
        setTimeout(async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) onAuth(session.user);
        }, 1500);

      } else if (mode === 'signin') {
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const isResetMode = mode === 'reset';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__logo">
          <div className="logo-mark" style={{ width: 48, height: 48, fontSize: 24, borderRadius: 14 }}>S</div>
          <div>
            <div className="logo-name" style={{ fontSize: 26 }}>Subly</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Language learning, reimagined
            </div>
          </div>
        </div>

        {!isResetMode && (
          <div className="auth-card__tabs">
            <button
              className={`auth-tab ${mode === 'signin' ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('signin')}
              type="button"
            >
              Sign In
            </button>
            <button
              className={`auth-tab ${mode === 'signup' ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('signup')}
              type="button"
            >
              Sign Up
            </button>
          </div>
        )}

        {mode === 'forgot' && (
          <div className="auth-card__forgot-header">
            <button type="button" className="auth-back-link" onClick={() => switchMode('signin')}>
              ← Back to Sign In
            </button>
            <h2 className="auth-card__title">Reset Password</h2>
            <p className="auth-card__desc">
              Enter your email and we'll send you a link to reset your password.
            </p>
          </div>
        )}

        {isResetMode && (
          <div className="auth-card__forgot-header">
            <h2 className="auth-card__title">Set New Password</h2>
            <p className="auth-card__desc">Choose a strong password for your account.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-card__form">
          {!isResetMode && (
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
          )}

          {mode !== 'forgot' && (
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">
                  {isResetMode ? 'New Password' : 'Password'}
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    className="auth-forgot-link"
                    onClick={() => switchMode('forgot')}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
              />
            </div>
          )}

          {isResetMode && (
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
              />
            </div>
          )}

          {error && <div className="alert alert--error">{error}</div>}
          {success && <div className="alert alert--success">{success}</div>}

          <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
            {loading ? (
              <span className="spinner" />
            ) : mode === 'signin' ? (
              'Sign In'
            ) : mode === 'signup' ? (
              'Create Account'
            ) : mode === 'forgot' ? (
              'Send Reset Link'
            ) : (
              'Update Password'
            )}
          </button>
        </form>
      </div>

      <style>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(ellipse 70% 50% at 50% 0%, rgba(124, 58, 237, 0.15) 0%, transparent 65%),
            var(--color-bg);
          padding: 24px;
        }

        .auth-card {
          width: 100%;
          max-width: 400px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-xl);
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(20px);
        }

        .auth-card__logo {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .auth-card__tabs {
          display: flex;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 4px;
          gap: 4px;
        }

        .auth-tab {
          flex: 1;
          padding: 9px;
          border: none;
          border-radius: 9px;
          background: transparent;
          color: var(--color-text-muted);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .auth-tab--active {
          background: rgba(124, 58, 237, 0.25);
          color: var(--color-primary-lit);
          box-shadow: 0 0 14px rgba(124, 58, 237, 0.18);
        }

        .auth-tab:not(.auth-tab--active):hover {
          color: var(--color-text-2);
        }

        .auth-card__forgot-header {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .auth-back-link {
          background: none;
          border: none;
          font-size: 13px;
          color: var(--color-text-muted);
          cursor: pointer;
          padding: 0;
          font-weight: 500;
          font-family: inherit;
          transition: color 0.15s;
          text-align: left;
          width: fit-content;
        }

        .auth-back-link:hover { color: var(--color-primary-lit); }

        .auth-card__title {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-text);
          letter-spacing: -0.2px;
        }

        .auth-card__desc {
          font-size: 13px;
          color: var(--color-text-muted);
          line-height: 1.6;
        }

        .auth-card__form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .auth-forgot-link {
          background: none;
          border: none;
          font-size: 12px;
          color: var(--color-text-muted);
          cursor: pointer;
          padding: 0;
          font-weight: 500;
          font-family: inherit;
          transition: color 0.15s;
        }

        .auth-forgot-link:hover { color: var(--color-primary-lit); }
      `}</style>
    </div>
  );
}
