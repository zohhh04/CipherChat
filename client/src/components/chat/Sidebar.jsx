import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from '../common/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import { chatListTime } from '../../utils/format';
import { toast } from '../common/Toast';

export default function Sidebar({ onNewChat, onNewGroup }) {
  const { user, logout, identityReady } = useAuth();
  const { chats, activeChatId, openChat, typingByChat, unreadTotal, loadingChats, decryptPreview } = useChat();
  const { onlineIds, connected } = useSocket();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [previews, setPreviews] = useState({});

  const chatList = useMemo(
    () =>
      Object.values(chats)
        .filter((c) => {
          if (!query.trim()) return true;
          const q = query.toLowerCase();
          return (
            (c.groupInfo && c.groupInfo.name.toLowerCase().includes(q)) ||
            c.members.some((m) => m.id !== user.id && m.username.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)),
    [chats, query, user]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = {};
      for (const c of Object.values(chats)) {
        next[String(c.id)] = await decryptPreview(c);
      }
      if (alive) setPreviews((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      alive = false;
    };
  }, [chats, decryptPreview]);

  const titleOf = (c) => {
    if (c.type === 'group' && c.groupInfo) return c.groupInfo.name;
    const peer = c.members.find((m) => m.id !== user.id);
    return peer ? peer.username : 'Unknown';
  };

  const peerIdOf = (c) => {
    const peer = c.members.find((m) => m.id !== user.id);
    return peer ? String(peer.id) : '';
  };

  const handleLogout = async () => {
    await logout();
    toast('Signed out', 'info');
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="me-row">
          <Avatar id={user.id} name={user.username} size={40} />
          <div className="me-meta">
            <strong>{user.username}</strong>
            <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'online' : 'connecting…'}</span>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <Link to="/settings" className="icon-btn" title="Settings">⚙️</Link>
          {user.role === 'admin' && (
            <Link to="/admin" className="icon-btn" title="Admin console">🛡️</Link>
          )}
          <button type="button" className="icon-btn" onClick={handleLogout} title="Sign out">⏻</button>
        </div>
      </header>

      {unreadTotal > 0 && (
        <div className="notif-banner">{unreadTotal} unread message{unreadTotal > 1 ? 's' : ''}</div>
      )}

      <div className="sidebar-actions">
        <input
          className="search-input"
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          onClick={onNewChat}
          className="pill-btn"
          title={identityReady ? 'New chat' : 'Unlock encryption keys first'}
          disabled={!identityReady}
        >
          ＋ Chat
        </button>
        <button
          type="button"
          onClick={onNewGroup}
          className="pill-btn"
          title={identityReady ? 'New group' : 'Unlock encryption keys first'}
          disabled={!identityReady}
        >
          ＋ Group
        </button>
      </div>
      {!identityReady && (
        <div className="lock-banner">🔒 Enter your password to unlock encryption</div>
      )}

      <div className="chat-list">
        {loadingChats && chatList.length === 0 && <p className="empty-hint">Loading…</p>}
        {loadingChats === false && chatList.length === 0 && (
          <p className="empty-hint">No chats yet. Start one with ＋ Chat.</p>
        )}
        {chatList.map((c) => {
          const cid = String(c.id);
          const typers = Object.values(typingByChat[cid] || {});
          return (
            <button
              type="button"
              key={cid}
              className={`chat-item ${activeChatId === cid ? 'active' : ''}`}
              onClick={() => openChat(cid)}
            >
              <Avatar
                id={cid}
                name={titleOf(c)}
                size={44}
                online={c.type === 'direct' && onlineIds.has(peerIdOf(c))}
              />
              <div className="chat-item-main">
                <div className="chat-item-top">
                  <span className="chat-name">{titleOf(c)}</span>
                  <span className="chat-time">{chatListTime(c.lastActivity)}</span>
                </div>
                <div className="chat-item-bottom">
                  <span className={`chat-preview ${typers.length ? 'typing' : ''}`}>
                    {typers.length
                      ? `${typers[0].username} is typing…`
                      : previews[cid] !== undefined
                        ? previews[cid] ?? '🔒 Encrypted message'
                        : '🔒 Encrypted message'}
                  </span>
                  {(c.unreadCount || 0) > 0 && <span className="badge">{c.unreadCount}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
