import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usersApi, apiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fingerprint } from '../crypto/e2ee';
import Avatar from '../components/common/Avatar';
import { toast } from '../components/common/Toast';

export default function SettingsPage() {
  const { user, publicKey, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [about, setAbout] = useState(user.about || '');
  const [sessions, setSessions] = useState([]);
  const [fp, setFp] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const { sessions: list } = await usersApi.sessions();
      setSessions(list);
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    loadSessions();
    if (publicKey) fingerprint(publicKey).then(setFp).catch(() => {});
  }, [loadSessions, publicKey]);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await usersApi.updateMe({ about });
      toast('Profile saved', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (pw.next !== pw.confirm) {
      toast('New passwords do not match', 'error');
      return;
    }
    if (pw.next.length < 10) {
      toast('Password must be at least 10 characters', 'error');
      return;
    }
    setBusy(true);
    try {
      await usersApi.changePassword(pw.current, pw.next);
      toast('Password changed. Please sign in again.', 'success');
      setTimeout(async () => {
        await logout();
        navigate('/login');
      }, 1200);
    } catch (err) {
      toast(apiError(err).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    try {
      await usersApi.revokeSession(id);
      await loadSessions();
      toast('Session revoked', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/app" className="icon-btn">←</Link>
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h3>Profile</h3>
          <div className="profile-row">
            <Avatar id={user.id} name={user.username} size={56} />
            <div>
              <strong>{user.username}</strong>
              <p>{user.email}</p>
            </div>
          </div>
          <label className="field-label" htmlFor="about">About</label>
          <input id="about" className="text-input" value={about} maxLength={140} onChange={(e) => setAbout(e.target.value)} />
          <div className={`verify-badge ${user.isVerified ? 'ok' : ''}`}>
            {user.isVerified ? '✔ Email verified' : '⚠ Email not verified'}
          </div>
          <button type="button" className="btn primary" onClick={saveProfile} disabled={busy}>Save profile</button>
        </section>

        <section className="card">
          <h3>Encryption</h3>
          <p className="muted">Your private key never leaves this device in plaintext. Compare fingerprints with contacts to verify identities.</p>
          <code className="fingerprint">{fp || 'Generating…'}</code>
        </section>

        <section className="card">
          <h3>Change password</h3>
          <input className="text-input" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input className="text-input" type="password" placeholder="New password (min 10)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <input className="text-input" type="password" placeholder="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
          <button type="button" className="btn primary" onClick={changePassword} disabled={busy}>Update password</button>
          <p className="muted small">Changing your password signs you out on every device.</p>
        </section>

        <section className="card wide">
          <h3>Active devices & sessions</h3>
          {sessions.length === 0 && <p className="muted">No other active sessions.</p>}
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.deviceLabel}</strong>
                  <small>{s.ip} · last active {new Date(s.lastUsedAt).toLocaleString()}</small>
                </div>
                <button type="button" className="btn danger sm" onClick={() => revoke(s.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
