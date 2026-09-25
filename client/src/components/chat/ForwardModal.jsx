import { useMemo, useState } from 'react';
import Modal from '../common/Modal';
import Avatar from '../common/Avatar';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../common/Toast';

function chatTitle(chat, myId) {
  if (chat.type === 'direct') {
    const peer = (chat.members || []).find((m) => String(m.id) !== String(myId));
    return peer?.username || 'Unknown';
  }
  return chat.groupInfo?.name || 'Group';
}

function previewText(msg) {
  if (!msg) return '';
  if (msg.deletedAt) return 'Deleted message';
  if (msg.type === 'poll' && msg.poll) return `📊 ${msg.poll.question}`;
  if (msg.type === 'call') return `📞 ${msg.text || 'Missed call'}`;
  if (msg.file) return `📎 ${msg.file.name || 'attachment'}`;
  return String(msg.text || '').slice(0, 80);
}

export default function ForwardModal({ message, onClose }) {
  const { chats, forwardMessage, getChatMode } = useChat();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const list = useMemo(() => {
    const all = Object.values(chats || {});
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((c) => chatTitle(c, user.id).toLowerCase().includes(q))
      : all;
    return filtered.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  }, [chats, query, user]);

  const forward = async (targetChat) => {
    if (busyId) return;
    setBusyId(String(targetChat.id));
    try {
      await forwardMessage(message, String(targetChat.id), { mode: getChatMode(String(targetChat.id)) });
      toast(`Forwarded to ${chatTitle(targetChat, user.id)}`, 'success');
      onClose();
    } catch (err) {
      toast(err.message || 'Failed to forward', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title="↪ Forward message" onClose={onClose}>
      <div className="forward-preview">“{previewText(message)}”</div>
      <input
        className="search-input"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        style={{ marginTop: 8 }}
      />
      <div className="forward-list">
        {list.length === 0 && <p className="empty-hint">No chats found</p>}
        {list.map((c) => {
          const title = chatTitle(c, user.id);
          return (
            <button
              key={c.id}
              type="button"
              className="forward-item"
              onClick={() => forward(c)}
              disabled={busyId !== null}
            >
              <Avatar id={String(c.id)} name={title} size={36} />
              <span className="forward-name">{title}</span>
              <span className="forward-type">{c.type === 'group' ? 'Group' : 'Direct'}</span>
              {busyId === String(c.id) && <span className="forward-busy">Sending…</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
