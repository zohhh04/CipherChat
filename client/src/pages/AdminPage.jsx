import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, apiError } from '../api';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/common/Avatar';
import { toast } from '../components/common/Toast';

export default function AdminPage() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState({ users: [], total: 0 });
  const [logs, setLogs] = useState({ logs: [], total: 0 });
  const [sessions, setSessions] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminApi.stats().then(setStats).catch(() => {});
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminApi.users({ q: query || undefined, page, limit: 20 });
      setUsers(data);
    } catch (err) {
      toast(apiError(err).message, 'error');
    }
  }, [query, page]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'logs') {
      adminApi.logs({ page: 1, limit: 50 }).then(setLogs).catch(() => {});
    }
    if (tab === 'sessions') {
      adminApi.sessions().then((d) => setSessions(d.sessions)).catch(() => {});
    }
  }, [tab, loadUsers]);

  const setStatus = async (id, banned) => {
    try {
      await adminApi.setUserStatus(id, banned);
      await loadUsers();
      toast(banned ? 'User banned' : 'User unbanned', 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    }
  };

  const setRole = async (id, role) => {
    try {
      await adminApi.setUserRole(id, role);
      await loadUsers();
      toast(`Role changed to ${role}`, 'success');
    } catch (err) {
      toast(apiError(err).message, 'error');
    }
  };

  return (
    <div className="admin-page">
      <header className="settings-header">
        <Link to="/app" className="icon-btn">←</Link>
        <h2>Admin console</h2>
        <span />
      </header>

      <nav className="tabs">
        {['overview', 'users', 'sessions', 'logs'].map((t) => (
          <button key={t} type="button" className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'overview' && stats && (
        <div className="stat-grid">
          {[
            ['Users', stats.users],
            ['Chats', stats.chats],
            ['Groups', stats.groups],
            ['Messages', stats.messages],
            ['Files', stats.files],
            ['Online now', stats.onlineUsers],
          ].map(([label, value]) => (
            <div key={label} className="stat-card">
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <section className="card wide">
          <div className="table-toolbar">
            <input
              className="text-input"
              placeholder="Search username or email"
              value={query}
              onChange={(e) => {
                setPage(1);
                setQuery(e.target.value);
              }}
            />
            <small>{users.total} total · page {page}</small>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th><th>Email</th><th>Role</th><th>Verified</th><th>Joined</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.users.map((u) => (
                  <tr key={String(u._id)} className={u.isBanned ? 'banned' : ''}>
                    <td>
                      <div className="cell-user">
                        <Avatar id={String(u._id)} name={u.username} size={30} />
                        {u.username}
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.isVerified ? '✔' : '—'}</td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="actions-cell">
                      {String(u._id) !== String(me?.id) && (
                        <>
                          <button type="button" className="btn sm" onClick={() => setRole(u._id, u.role === 'admin' ? 'user' : 'admin')}>
                            {u.role === 'admin' ? 'Demote' : 'Promote'}
                          </button>
                          <button type="button" className={`btn sm ${u.isBanned ? '' : 'danger'}`} onClick={() => setStatus(u._id, !u.isBanned)}>
                            {u.isBanned ? 'Unban' : 'Ban'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <button type="button" className="btn sm" disabled={page * 20 >= users.total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </section>
      )}

      {tab === 'sessions' && (
        <section className="card wide">
          <h3>Active sessions (all users)</h3>
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.username}</strong>
                  <small>{s.deviceLabel} · {s.ip} · last active {new Date(s.lastUsedAt).toLocaleString()}</small>
                </div>
                <button
                  type="button"
                  className="btn danger sm"
                  onClick={async () => {
                    await adminApi.revokeSession(s.id).catch(() => {});
                    setSessions((prev) => prev.filter((x) => x.id !== s.id));
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'logs' && (
        <section className="card wide">
          <h3>Audit log</h3>
          <div className="table-wrap scroll-y">
            <table>
              <thead>
                <tr><th>When</th><th>Action</th><th>Severity</th><th>Actor</th><th>Email</th><th>IP</th></tr>
              </thead>
              <tbody>
                {logs.logs.map((l) => (
                  <tr key={l.id} className={`sev-${l.severity}`}>
                    <td>{new Date(l.createdAt).toLocaleString()}</td>
                    <td><code>{l.action}</code></td>
                    <td>{l.severity}</td>
                    <td>{l.actor ? l.actor.username : '—'}</td>
                    <td>{l.email || '—'}</td>
                    <td>{l.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
