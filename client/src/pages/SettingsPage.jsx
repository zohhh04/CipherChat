import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usersApi, apiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fingerprint } from '../crypto/e2ee';
import Avatar from '../components/common/Avatar';
import { toast } from '../components/common/Toast';

export default function SettingsPage() {
  const { user, publicKey, identityReady, logout } = useAuth();
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

  const revokeAll = async () => {
    if (!confirm('Revoke all other sessions? You will stay signed in on this device.')) return;
    try {
      for (const s of sessions) {
        await usersApi.revokeSession(s.id);
      }
      await loadSessions();
      toast('All other sessions revoked', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    }
  };

  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/app" className="icon-btn" title="Back to chats">←</Link>
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      <div className="settings-grid">
        {/* Account Section */}
        <section className="card">
          <h3>👤 Account</h3>
          <div className="profile-row">
            <Avatar id={user.id} name={user.username} size={64} />
            <div>
              <strong>{user.username}</strong>
              <p>{user.email}</p>
              <span className={`role-tag ${user.role}`}>{user.role}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-label">Member since</span>
            <span className="info-value">{memberSince}</span>
          </div>
          <div className={`verify-badge ${user.isVerified ? 'ok' : ''}`}>
            {user.isVerified ? '✔ Email verified' : '⚠ Email not verified'}
          </div>
        </section>

        {/* Profile Section */}
        <section className="card">
          <h3>✏️ Profile</h3>
          <label className="field-label" htmlFor="about">About</label>
          <textarea
            id="about"
            className="text-input textarea"
            value={about}
            maxLength={140}
            rows={3}
            placeholder="Tell others about yourself..."
            onChange={(e) => setAbout(e.target.value)}
          />
          <span className="char-count">{about.length}/140</span>
          <button type="button" className="btn primary" onClick={saveProfile} disabled={busy}>
            Save profile
          </button>
        </section>

        {/* Security Section */}
        <section className="card wide">
          <h3>🔐 Security & Encryption</h3>
          <p className="muted">
            All messages are end-to-end encrypted. Your private key never leaves this device in plaintext.
            Compare fingerprints with contacts to verify their identity.
          </p>
          <div className="security-grid">
            <div className="security-item">
              <span className="security-icon">🔑</span>
              <div>
                <strong>Encryption Status</strong>
                <p className={identityReady ? 'status-ok' : 'status-warn'}>
                  {identityReady ? 'Keys unlocked' : 'Keys locked'}
                </p>
              </div>
            </div>
            <div className="security-item">
              <span className="security-icon">🛡️</span>
              <div>
                <strong>E2EE Protocol</strong>
                <p>ECDH P-256 + AES-256-GCM</p>
              </div>
            </div>
          </div>
          <div className="fingerprint-section">
            <label className="field-label">Your Fingerprint</label>
            <p className="muted small">Compare this with your contacts to verify identity</p>
            <code className="fingerprint">{fp || 'Generating…'}</code>
          </div>
        </section>

        {/* Sessions Section */}
        <section className="card wide">
          <div className="card-header-row">
            <h3>📱 Active Devices & Sessions</h3>
            {sessions.length > 1 && (
              <button type="button" className="btn danger sm" onClick={revokeAll}>
                Revoke all others
              </button>
            )}
          </div>
          {sessions.length === 0 && <p className="muted">No active sessions.</p>}
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id} className="session-item">
                <div className="session-info">
                  <span className="session-device">{s.deviceLabel}</span>
                  <span className="session-meta">
                    {s.ip} · Last active {new Date(s.lastUsedAt).toLocaleString()}
                  </span>
                </div>
                <button type="button" className="btn danger sm" onClick={() => revoke(s.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Change Password Section */}
        <section className="card">
          <h3>🔑 Change Password</h3>
          <input
            className="text-input"
            type="password"
            placeholder="Current password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            autoComplete="current-password"
          />
          <input
            className="text-input"
            type="password"
            placeholder="New password (min 10 chars)"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            autoComplete="new-password"
          />
          <input
            className="text-input"
            type="password"
            placeholder="Confirm new password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            autoComplete="new-password"
          />
          <button type="button" className="btn primary" onClick={changePassword} disabled={busy}>
            {busy ? 'Updating...' : 'Update password'}
          </button>
          <p className="muted small">⚠️ Changing your password will sign you out on every device and re-wrap your encryption keys.</p>
        </section>

        {/* About Section */}
        <section className="card">
          <h3>ℹ️ About CipherChat</h3>
          <div className="about-info">
            <div className="info-row">
              <span className="info-label">Version</span>
              <span className="info-value">1.0.0</span>
            </div>
            <div className="info-row">
              <span className="info-label">Encryption</span>
              <span className="info-value">AES-256-GCM</span>
            </div>
            <div className="info-row">
              <span className="info-label">Key Exchange</span>
              <span className="info-value">ECDH P-256</span>
            </div>
            <div className="info-row">
              <span className="info-label">Protocol</span>
              <span className="info-value">WebCrypto API</span>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            CipherChat uses end-to-end encryption to protect your messages.
            Only you and the people you communicate with can read them.
          </p>
        </section>

        {/* Danger Zone */}
        <section className="card danger-zone">
          <h3>⚠️ Danger Zone</h3>
          <p className="muted">
            Once you delete your account, there is no going back. Please be certain.
          </p>
          <button type="button" className="btn danger" disabled>
            Delete Account
          </button>
        </section>
      </div>
    </div>
  );
}
