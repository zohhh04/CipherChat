import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usersApi, authApi, apiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fingerprint } from '../crypto/e2ee';
import { getSecureKey, setSecureKey } from '../crypto/securePass';
import PasswordInput from '../components/common/PasswordInput';
import Avatar from '../components/common/Avatar';
import { Twemoji } from '../components/common/EmojiText';
import { toast } from '../components/common/Toast';

export default function SettingsPage() {
  const { user, publicKey, identityReady, logout, setUser } = useAuth();
  const [secureKey, setSecureKeyInput] = useState(() => getSecureKey(user?.id));
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [about, setAbout] = useState(user.about || '');
  const [sessions, setSessions] = useState([]);
  const [fp, setFp] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [deletePw, setDeletePw] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

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
  }, [loadSessions]);

  useEffect(() => {
    if (publicKey && publicKey.length > 0) {
      fingerprint(publicKey).then(setFp).catch(() => setFp('Unable to generate'));
    } else if (identityReady) {
      setFp('No public key found');
    }
  }, [publicKey, identityReady]);

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

  const deleteAccount = async () => {
    if (!confirm('Are you absolutely sure? This action is irreversible and will permanently delete your account, all messages, and files.')) return;
    if (!deletePw) {
      toast('Enter your password to confirm deletion', 'error');
      return;
    }
    setBusy(true);
    try {
      await usersApi.deleteAccount(deletePw);
      toast('Account deleted permanently', 'success');
      await logout();
    } catch (err) {
      toast(apiError(err).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';

  const resendVerification = async () => {
    setResending(true);
    try {
      await authApi.resendVerification();
      toast('Verification email sent. Check your inbox.', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    } finally {
      setResending(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('Max avatar size is 5 MB', 'error');
      return;
    }
    setAvatarBusy(true);
    try {
      const { user: updated } = await usersApi.uploadAvatar(file);
      setUser(updated);
      toast('Profile photo updated', 'success');
    } catch (err) {
      toast(apiError(err).message || 'Upload failed', 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    try {
      const { user: updated } = await usersApi.removeAvatar();
      setUser(updated);
      toast('Profile photo removed', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/app" className="icon-btn" title="Back to chats"><Twemoji>←</Twemoji></Link>
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme">
          <Twemoji>{theme === 'dark' ? '☀️' : '🌙'}</Twemoji>
        </button>
      </header>

      <div className="settings-grid">
        {/* Account Section */}
        <section className="card">
          <h3>👤 Account</h3>
          <div className="profile-row">
            <div className="avatar-upload-wrap">
              <Avatar id={user.id} name={user.username} size={64} avatar={user.avatar} />
              <label className="avatar-overlay" title="Change photo">
                📷
                <input type="file" accept="image/*" hidden onChange={handleAvatarUpload} disabled={avatarBusy} />
              </label>
              {avatarBusy && <span className="avatar-spinner" />}
            </div>
            <div>
              <strong>{user.username}</strong>
              <p>{user.email}</p>
              <span className={`role-tag ${user.role}`}>{user.role}</span>
            </div>
          </div>
          {user.avatar && (
            <button type="button" className="btn sm" onClick={handleAvatarRemove} disabled={avatarBusy}>
              Remove photo
            </button>
          )}
          <div className="info-row">
            <span className="info-label">Member since</span>
            <span className="info-value">{memberSince}</span>
          </div>
          <div className={`verify-badge ${user.isVerified ? 'ok' : ''}`}>
            {user.isVerified ? '✔ Email verified' : '⚠ Email not verified'}
          </div>
          {!user.isVerified && (
            <button type="button" className="btn sm" onClick={resendVerification} disabled={resending}>
              {resending ? 'Sending...' : 'Resend verification email'}
            </button>
          )}
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
          <div className="fingerprint-section">
            <label className="field-label">🔐 Secure Chat Key (shared key)</label>
            <p className="muted small">
              This key encrypts every message you send in 🔐 Secure mode. Share this exact key
              with your receiver (outside the chat) — they type it on the locked message to view it.
              No password is asked at startup.
            </p>
            <PasswordInput
              placeholder="e.g. mango-sunset-42 (share with receiver)"
              value={secureKey}
              onChange={(e) => setSecureKeyInput(e.target.value)}
              autoComplete="off"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="btn primary sm"
                onClick={() => {
                  if (!secureKey.trim()) {
                    toast('Enter a key first', 'error');
                    return;
                  }
                  setSecureKey(user.id, secureKey.trim());
                  toast('🔐 Secure Chat Key saved — receivers use this same key to decrypt', 'success');
                }}
              >
                💾 Save key
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const rand = `key-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
                  setSecureKeyInput(rand);
                  setSecureKey(user.id, rand);
                  toast('New random key generated & saved', 'success');
                }}
              >
                🎲 Generate
              </button>
              {getSecureKey(user.id) && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    navigator.clipboard.writeText(getSecureKey(user.id)).then(() => toast('Key copied — share it with your receiver', 'success')).catch(() => {});
                  }}
                >
                  📋 Copy
                </button>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              Current: <code>{getSecureKey(user.id) ? '•••••• (saved)' : 'not set — set one before sending secure messages'}</code>
            </p>
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
          <PasswordInput
            placeholder="Current password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            autoComplete="current-password"
          />
          <PasswordInput
            placeholder="New password (min 10 chars)"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            autoComplete="new-password"
          />
          <PasswordInput
            placeholder="Confirm new password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            autoComplete="new-password"
          />
          <button type="button" className="btn primary" onClick={changePassword} disabled={busy}>
            {busy ? 'Updating...' : 'Update password'}
          </button>
          <p className="muted small">⚠️ Changing your password will sign you out on every device. Your encryption identity is refreshed automatically on next sign-in.</p>
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
          <PasswordInput
            placeholder="Enter your password to confirm"
            value={deletePw}
            onChange={(e) => setDeletePw(e.target.value)}
            autoComplete="current-password"
          />
          <button type="button" className="btn danger" onClick={deleteAccount} disabled={busy || !deletePw}>
            {busy ? 'Deleting...' : 'Delete Account Permanently'}
          </button>
        </section>
      </div>
    </div>
  );
}
