import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from '../common/Avatar';
import { Twemoji } from '../common/EmojiText';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import { chatListTime } from '../../utils/format';
import { toast } from '../common/Toast';

export default function Sidebar({ onNewChat, onNewGroup }) {
  const { user, logout, identityReady } = useAuth();
  const { chats, activeChatId, openChat, typingByChat, unreadTotal, loadingChats, decryptPreview, searchMessages, messageUrgency } = useChat();
  const { onlineIds, connected } = useSocket();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [previews, setPreviews] = useState({});
  const [searchMode, setSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

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
    if (searchMode && query.trim()) {
      const results = searchMessages(query);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchMode, query, searchMessages]);

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
          <Avatar id={user.id} name={user.username} size={42} />
          <div className="me-meta">
            <strong>{user.username}</strong>
            <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'online' : 'connecting…'}</span>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme">
            <Twemoji>{theme === 'dark' ? '☀️' : '🌙'}</Twemoji>
          </button>
          <Link to="/settings" className="icon-btn" title="Settings"><Twemoji>⚙️</Twemoji></Link>
          {user.role === 'admin' && (
            <Link to="/admin" className="icon-btn" title="Admin console"><Twemoji>🛡️</Twemoji></Link>
          )}
          <button type="button" className="icon-btn" onClick={handleLogout} title="Sign out"><Twemoji>⏻</Twemoji></button>
        </div>
      </header>

      {unreadTotal > 0 && (
        <div className="notif-banner">{unreadTotal} unread message{unreadTotal > 1 ? 's' : ''}</div>
      )}

      <div className="sidebar-actions">
        <div className="search-row">
          <input
            className="search-input"
            placeholder={searchMode ? 'Search messages...' : 'Search or start new chat'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`icon-btn search-toggle ${searchMode ? 'active' : ''}`}
            onClick={() => { setSearchMode(!searchMode); setQuery(''); }}
            title={searchMode ? 'Search chats' : 'Search messages'}
          >
            <Twemoji>{searchMode ? '💬' : '🔍'}</Twemoji>
          </button>
        </div>
        <div className="action-buttons">
          <button
            type="button"
            onClick={onNewChat}
            className="action-btn"
            title={identityReady ? 'New chat' : 'Unlock encryption keys first'}
            disabled={!identityReady}
          >
            <Twemoji>💬</Twemoji>
          </button>
          <button
            type="button"
            onClick={onNewGroup}
            className="action-btn"
            title={identityReady ? 'New group' : 'Unlock encryption keys first'}
            disabled={!identityReady}
          >
            <Twemoji>👥</Twemoji>
          </button>
        </div>
      </div>
      {!identityReady && (
        <div className="lock-banner"><Twemoji>🔒</Twemoji> Enter your password to unlock encryption</div>
      )}

      <div className="chat-list">
        {loadingChats && chatList.length === 0 && <p className="empty-hint">Loading…</p>}
        {loadingChats === false && chatList.length === 0 && (
          <p className="empty-hint">No chats yet. Start one with ＋ Chat.</p>
        )}
        {searchMode && query.trim() && searchResults.length === 0 && (
          <p className="empty-hint">No messages found</p>
        )}
        {searchMode && query.trim() && searchResults.length > 0 && (
          <div className="search-results">
            <div className="search-results-header">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</div>
            {searchResults.map((m) => {
              const chat = chats[m.chatId];
              const chatName = chat ? (chat.type === 'group' && chat.groupInfo ? chat.groupInfo.name : chat.members.find((mm) => mm.id !== user.id)?.username || 'Unknown') : 'Unknown';
              return (
                <button
                  type="button"
                  key={m.id}
                  className="search-result-item"
                  onClick={() => openChat(m.chatId)}
                >
                  <span className="search-result-chat">{chatName}</span>
                  <span className="search-result-text">{m.text.slice(0, 80)}</span>
                  <span className="search-result-time">{new Date(m.createdAt).toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        )}
        {!searchMode && chatList.map((c) => {
          const cid = String(c.id);
          const typers = Object.values(typingByChat[cid] || {});
          const urgency = messageUrgency[cid]?.urgency || 'normal';
          return (
            <button
              type="button"
              key={cid}
              className={`chat-item ${activeChatId === cid ? 'active' : ''}`}
              data-urgency={urgency}
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
                        ? previews[cid] ?? <><Twemoji>🔒</Twemoji> Encrypted message</>
                        : <><Twemoji>🔒</Twemoji> Encrypted message</>}
                  </span>
                  {(c.unreadCount || 0) > 0 && (
                    <span className={`badge ${messageUrgency[cid]?.urgency === 'critical' ? 'critical' : messageUrgency[cid]?.urgency === 'high' ? 'high' : ''}`}>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
