import React, { useState, useEffect } from 'react';
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import AuthPage from './pages/AuthPage';
import DictionaryPage from './pages/DictionaryPage';
import LearningPage from './pages/LearningPage';
import ExercisesPage from './pages/ExercisesPage';
import './styles/globals.css';

// ── App shell with sidebar ────────────────────────────────────────────────────

function AppShell({ user }: { user: User }) {
  return (
    <div className="app-shell">
      <Sidebar user={user} />
      <main className="app-main">
        <Outlet />
      </main>
      <style>{`
        .app-shell {
          display: flex;
          min-height: 100vh;
        }
        .app-main {
          flex: 1;
          margin-left: var(--sidebar-w);
          min-height: 100vh;
          background:
            radial-gradient(ellipse 60% 40% at 70% 0%, rgba(124, 58, 237, 0.07) 0%, transparent 60%),
            var(--color-bg);
        }
      `}</style>
    </div>
  );
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function RequireAuth({ user, loading }: { user: User | null; loading: boolean }) {
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        flexDirection: 'column',
        gap: 14,
      }}>
        <div className="logo-mark" style={{ width: 48, height: 48, fontSize: 22, borderRadius: 14 }}>S</div>
        <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <AppShell user={user} />;
}

// ── Root component ────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const router = createBrowserRouter([
    {
      path: '/auth',
      element: user ? <Navigate to="/dictionary" replace /> : (
        <AuthPage onAuth={(u) => setUser(u)} />
      ),
    },
    {
      path: '/reset-password',
      element: <AuthPage onAuth={(u) => { setUser(u); }} />,
    },
    {
      element: <RequireAuth user={user} loading={loading} />,
      children: [
        { index: true, element: <Navigate to="/dictionary" replace /> },
        { path: '/dictionary', element: <DictionaryPage /> },
        { path: '/learning', element: <LearningPage /> },
        { path: '/exercises', element: <ExercisesPage /> },
      ],
    },
    {
      path: '*',
      element: <Navigate to="/dictionary" replace />,
    },
  ]);

  return <RouterProvider router={router} />;
}
