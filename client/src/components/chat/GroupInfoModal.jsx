import { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import Avatar from '../common/Avatar';
import { usersApi, chatsApi } from '../../api';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { toast } from '../common/Toast';

export default function GroupInfoModal({ chat, onClose }) {
  const { user } = useAuth();
  const { onlineIds } = useSocket();
  const { addMember, removeMemberAndRotate, leaveChat, rotateGroupKeyManually, chats, refreshChats } = useChat();
  const [name, setName] = useState(chat.groupInfo?.name || '');
  const [description, setDescription] = useState(chat.groupInfo?.description || '');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const isAdmin = chat.members.find((m) => m.id === user.id)?.isAdmin;

  useEffect(() => {
    if (!adding || query.trim().length < 1) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { users } = await usersApi.search(query.trim());
        if (alive) setResults(users.filter((u) => !chat.members.some((m) => String(m.id) === String(u._id))));
      } catch {
        void 0;
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [adding, query, chat]);

  const saveDetails = async () => {
    setBusy(true);
    try {
      await chatsApi.updateGroup(String(chat.id), { name: name.trim(), description: description.trim() });
      await refreshChats();
      toast('Group updated', 'success');
    } catch {
      toast('Update failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async (userId) => {
    setBusy(true);
    try {
      await addMember(String(chat.id), userId);
      setAdding(false);
      setQuery('');
      toast('Member added with key wrap', 'success');
    } catch (e) {
      toast(e.message || 'Failed to add member', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId, username) => {
    if (!window.confirm(`Remove ${username}? The chat key will be rotated so they lose access.`)) return;
    setBusy(true);
    try {
      await removeMemberAndRotate(String(chat.id), userId);
      toast('Member removed and key rotated', 'success');
      onClose();
    } catch (e) {
      toast(e.message || 'Failed to remove member', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    if (!window.confirm('Leave this group? You will lose access to its messages.')) return;
    try {
      await leaveChat(String(chat.id));
      onClose();
    } catch (e) {
      toast(e.message || 'Failed to leave', 'error');
    }
  };

  const onRotate = async () => {
    setBusy(true);
    try {
      await rotateGroupKeyManually(String(chat.id));
      toast('Group key rotated for all members', 'success');
    } catch (e) {
      toast(e.message || 'Rotation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const liveChat = chats[String(chat.id)] || chat;

  return (
    <Modal title="Group info" onClose={onClose} wide>
      <div className="group-head">
        <Avatar id={String(liveChat.id)} name={liveChat.groupInfo?.name || 'Group'} size={64} />
        <div>
          <strong>{liveChat.groupInfo?.name}</strong>
          <p>{liveChat.groupInfo?.description}</p>
        </div>
      </div>

      {isAdmin && !adding && (
        <>
          <div className="form-row">
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
            <input className="text-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
            <button type="button" className="btn" onClick={saveDetails} disabled={busy}>Save</button>
          </div>
          <div className="form-row">
            <button type="button" className="btn" onClick={() => setAdding(true)}>＋ Add member</button>
            <button type="button" className="btn" onClick={onRotate} disabled={busy}>🔄 Rotate group key</button>
            <button type="button" className="btn danger" onClick={onLeave}>Leave group</button>
          </div>
        </>
      )}

      {isAdmin && adding && (
        <div className="add-member-box">
          <input
            className="text-input"
            placeholder="Search users to add…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="user-results">
            {results.map((u) => (
              <button key={String(u._id)} type="button" className="chat-item" disabled={busy} onClick={() => onAdd(u._id)}>
                <Avatar id={String(u._id)} name={u.username} size={36} />
                <span className="chat-name">{u.username}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      <h4>Members ({liveChat.members.length})</h4>
      <div className="member-list">
        {liveChat.members.map((m) => (
          <div key={String(m.id)} className="member-row">
            <Avatar id={String(m.id)} name={m.username} size={36} online={onlineIds.has(String(m.id))} />
            <span className="member-name">
              {m.username}
              {m.id === user.id ? ' (you)' : ''}
            </span>
            {m.isAdmin && <span className="role-badge">admin</span>}
            {isAdmin && m.id !== user.id && (
              <button type="button" className="icon-btn danger" onClick={() => onRemove(m.id, m.username)} title="Remove">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
