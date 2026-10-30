import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { getToken, loginUrl, setToken } from './api';
import { Alert } from './components/ui';
import Batches from './pages/Batches';
import ContactDetailPage from './pages/ContactDetail';
import Contacts from './pages/Contacts';
import Pipeline from './pages/Pipeline';
import Profile from './pages/Profile';
import Queue from './pages/Queue';
import Review from './pages/Review';
import SettingsPage from './pages/Settings';
import Stats from './pages/Stats';

const ERRORS: Record<string, string> = {
  not_allowed: 'That Google account is not the one this app is set up for.',
  invalid_state: 'The sign-in link expired. Please try again.',
  token_exchange: 'Google rejected the sign-in. Check the OAuth client ID and secret.',
  missing_gmail_scopes: 'Please tick both Gmail permission boxes on the Google consent screen.',
  no_refresh_token: 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.',
  access_denied: 'Sign-in was cancelled.',
};

function Login({ error }: { error?: string | null }) {
  return (
    <div className="mx-auto mt-24 max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-semibold">ColdEmails</h1>
      <p className="text-sm text-slate-600">Personal outreach tool for finance, consulting and quant recruiting.</p>
      {error && <Alert>{ERRORS[error] ?? error}</Alert>}
      <a className="btn btn-primary" href={loginUrl()}>
        Sign in with Google
      </a>
    </div>
  );
}

function AuthCallback() {
  const [q] = useSearchParams();
  const nav = useNavigate();
  const token = q.get('token');
  const error = q.get('error');
  useEffect(() => {
    if (token) {
      setToken(token);
      nav('/', { replace: true });
    }
  }, [token, nav]);
  return token ? null : <Login error={error ?? 'Sign-in failed'} />;
}

const NAV = [
  ['/contacts', 'Contacts'],
  ['/drafts', 'New drafts'],
  ['/review', 'Review'],
  ['/queue', 'Queue'],
  ['/pipeline', 'Pipeline'],
  ['/stats', 'Stats'],
  ['/profile', 'Profile'],
  ['/settings', 'Settings'],
] as const;

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const qc = useQueryClient();
  useEffect(() => {
    const out = () => {
      setAuthed(false);
      qc.clear();
    };
    window.addEventListener('coldemails:logout', out);
    return () => window.removeEventListener('coldemails:logout', out);
  }, [qc]);

  return (
    <Routes>
      <Route
        path="/auth"
        element={
          <AuthGate onDone={() => setAuthed(true)}>
            <AuthCallback />
          </AuthGate>
        }
      />
      <Route
        path="*"
        element={
          getToken() && authed ? (
            <div className="mx-auto max-w-6xl px-4 py-4">
              <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
                <span className="mr-3 py-1.5 text-sm font-semibold">ColdEmails</span>
                {NAV.map(([to, label]) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-sm ${isActive ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {label}
                  </NavLink>
                ))}
              </nav>
              <Routes>
                <Route path="/" element={<Navigate to="/contacts" replace />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/contacts/:id" element={<ContactDetailPage />} />
                <Route path="/drafts" element={<Batches />} />
                <Route path="/review" element={<Review />} />
                <Route path="/queue" element={<Queue />} />
                <Route path="/pipeline" element={<Pipeline />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/contacts" replace />} />
              </Routes>
            </div>
          ) : (
            <Login />
          )
        }
      />
    </Routes>
  );
}

/** Marks the app as signed in as soon as the callback stores the token. */
function AuthGate({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  const [q] = useSearchParams();
  useEffect(() => {
    if (q.get('token')) onDone();
  }, [q, onDone]);
  return <>{children}</>;
}
