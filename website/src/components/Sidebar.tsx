import React from 'react';
import { NavLink } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  user: User;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  locked?: boolean;
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.998.002A3 3 0 0 0 12 5Z" />
      <path d="M9 8v1" />
      <path d="M6 8v1" />
      <path d="M3 8v1" />
      <path d="M12 5c0 2.21-1.79 4-4 4H5a3 3 0 0 0-3 3v1a2 2 0 0 0 2 2v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1a2 2 0 0 0 2-2v-1a3 3 0 0 0-3-3h-3" />
      <path d="M12 5a3 3 0 1 1 5.998.002A3 3 0 0 1 12 5Z" />
      <path d="M15 8v1" />
      <path d="M18 8v1" />
      <path d="M21 8v1" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dictionary', label: 'Dictionary',  icon: <BookIcon />,  locked: false },
  { to: '/learning',   label: 'Learning',    icon: <BrainIcon />, locked: true  },
  { to: '/exercises',  label: 'Exercises',   icon: <ZapIcon />,   locked: true  },
];

export default function Sidebar({ user }: SidebarProps) {
  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <div className="logo-mark" style={{ width: 36, height: 36, fontSize: 18, borderRadius: 11 }}>S</div>
        <span className="logo-name" style={{ fontSize: 20 }}>Subly</span>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? 'sidebar__link--active' : ''} ${item.locked ? 'sidebar__link--locked' : ''}`
            }
          >
            <span className="sidebar__link-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.locked && <span className="sidebar__lock-badge">Soon</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__user">
          <div className="sidebar__avatar">
            {user.email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <span className="sidebar__email">{user.email}</span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={handleSignOut} style={{ width: '100%', justifyContent: 'flex-start', marginTop: 4 }}>
          Sign out
        </button>
      </div>

      <style>{`
        .sidebar {
          width: var(--sidebar-w);
          background: var(--color-bg-panel);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          padding: 20px 12px;
          gap: 8px;
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: 10;
        }

        .sidebar__logo {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 4px 16px;
          border-bottom: 1px solid var(--color-border);
          margin-bottom: 8px;
        }

        .sidebar__nav {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .sidebar__link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-muted);
          transition: all 0.18s;
          cursor: pointer;
          text-decoration: none;
          position: relative;
        }

        .sidebar__link:hover:not(.sidebar__link--locked) {
          background: var(--color-surface-hi);
          color: var(--color-text-2);
        }

        .sidebar__link--active {
          background: rgba(124, 58, 237, 0.18);
          color: var(--color-primary-lit) !important;
        }

        .sidebar__link--active .sidebar__link-icon {
          color: var(--color-primary-lit);
        }

        .sidebar__link--locked {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .sidebar__link-icon {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          color: inherit;
        }

        .sidebar__lock-badge {
          margin-left: auto;
          font-size: 10px;
          font-weight: 700;
          color: var(--color-text-faint);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 4px;
          padding: 1px 5px;
          letter-spacing: 0.04em;
        }

        .sidebar__footer {
          border-top: 1px solid var(--color-border);
          padding-top: 12px;
          margin-top: auto;
        }

        .sidebar__user {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 4px;
          margin-bottom: 2px;
        }

        .sidebar__avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary), var(--color-sky));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .sidebar__email {
          font-size: 12px;
          color: var(--color-text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </aside>
  );
}
