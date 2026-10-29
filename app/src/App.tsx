import { useEffect, useRef, useState } from 'react';
import { useRoute, href } from './lib/router';
import { useStore } from './ui/components';
import { SyncPill } from './pages/settings';
import { TodayPage } from './pages/today';
import { JobsPage } from './pages/jobs';
import { ApplicationsPage } from './pages/applications';
import { CompaniesPage } from './pages/companies';
import { LearningPage } from './pages/learning';
import { InsightsPage } from './pages/insights';
import { SettingsPage } from './pages/settings';

const NAV = [
  { id: 'today', label: 'Today', icon: '☀' },
  { id: 'jobs', label: 'Job discovery', icon: '⌕' },
  { id: 'applications', label: 'Applications', icon: '▤' },
  { id: 'companies', label: 'Companies', icon: '⌂' },
  { id: 'learning', label: 'Learning', icon: '✎' },
  { id: 'insights', label: 'Insights', icon: '◔' },
  { id: 'settings', label: 'Data & sync', icon: '⚙' },
];

export function App() {
  const route = useRoute();
  const store = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const section = route.path[0] ?? 'today';
  const firstRender = useRef(true);
  useEffect(() => {
    setMenuOpen(false);
    // Move focus to the new page on navigation (not on first load, so the skip link stays first).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Keyboard tab navigation changes the route too; keep focus on the tab in that case.
    if (document.activeElement?.getAttribute('role') === 'tab') return;
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [section, route.path[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = store.status();
  const page = (() => {
    switch (section) {
      case 'jobs':
        return <JobsPage id={route.path[1]} query={route.query} />;
      case 'applications':
        return <ApplicationsPage id={route.path[1]} query={route.query} />;
      case 'companies':
        return <CompaniesPage id={route.path[1]} />;
      case 'learning':
        return <LearningPage tab={route.path[1]} sub={route.path[2]} />;
      case 'insights':
        return <InsightsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <TodayPage />;
    }
  })();

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Main" data-open={menuOpen}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" /> Self AI Journey
        </div>
        <div className="nav">
          {NAV.map((n) => (
            <a key={n.id} href={href(n.id)} aria-current={section === n.id ? 'page' : undefined}>
              <span aria-hidden="true">{n.icon}</span> {n.label}
              {n.id === 'settings' && status.conflicts > 0 && <span className="count badge badge-bad">{status.conflicts}</span>}
            </a>
          ))}
        </div>
        <div className="sidebar-foot">
          {__PUBLIC_SHELL__ ? 'Public shell: no personal data is bundled. Your data stays in this browser unless you connect your private repository.' : 'Private build'}
          <br />
          Works without any AI service.
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-sm menu-btn" aria-expanded={menuOpen} aria-label="Open navigation" onClick={() => setMenuOpen((o) => !o)}>
            ☰
          </button>
          <strong className="hide-sm">{NAV.find((n) => n.id === section)?.label ?? 'Today'}</strong>
          <span className="spacer" />
          <SyncPill />
        </header>
        <main id="main" tabIndex={-1} className="content">
          {store.ready ? page : <p>Loading your working copy…</p>}
        </main>
      </div>
    </div>
  );
}
