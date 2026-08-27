import { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import Avatar from '../common/Avatar';
import { usersApi } from '../../api';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';

export default function NewGroupModal({ onClose }) {
  const { createGroup } = useChat();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      setSearched(false);
      setSearchError('');
      return undefined;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { users } = await usersApi.search(query.trim());
        if (alive) {
          setResults(users.filter((u) => u._id !== user.id));
          setSearched(true);
          setSearchError('');
        }
      } catch {
        if (alive) {
          setSearchError('Search failed. Try a username instead.');
          setResults([]);
          setSearched(true);
        }
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, user]);

  const toggle = (u) =>
    setSelected((prev) =>
      prev.some((s) => s._id === u._id) ? prev.filter((s) => s._id !== u._id) : [...prev, u]
    );

  const submit = async () => {
    if (!name.trim() || selected.length === 0) return;
    setBusy(true);
    setCreateError('');
    try {
      await createGroup(name.trim(), selected.map((s) => s._id), description.trim() || undefined);
      onClose();
    } catch (e) {
      console.error('Create group failed:', e);
      setCreateError(e.message || 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  const canCreate = name.trim() && selected.length > 0;

  return (
    <Modal title="New group" onClose={onClose}>
      <input className="text-input" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="text-input"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {selected.length > 0 && (
        <div className="chip-row">
          {selected.map((u) => (
            <button key={u._id} type="button" className="chip" onClick={() => toggle(u)}>
              {u.username} ✕
            </button>
          ))}
        </div>
      )}
      <input
        className="text-input"
        placeholder="Search by username or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="user-results">
        {results.map((u) => (
          <button key={String(u._id)} type="button" className="chat-item" onClick={() => toggle(u)}>
            <Avatar id={String(u._id)} name={u.username} size={36} />
            <div className="chat-item-main">
              <span className="chat-name">{u.username}</span>
            </div>
            <span>{selected.some((s) => s._id === u._id) ? '✓' : '＋'}</span>
          </button>
        ))}
        {searchError && <p className="empty-hint" style={{ color: 'var(--danger)' }}>{searchError}</p>}
        {searched && !searchError && results.length === 0 && (
          <p className="empty-hint">No users found. Try a username.</p>
        )}
      </div>
      {createError && <p className="alert error" style={{ marginTop: 8 }}>{createError}</p>}
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !canCreate}>
          {busy ? 'Encrypting…' : selected.length === 0 ? 'Add at least one member' : `Create group (${selected.length + 1})`}
        </button>
      </div>
    </Modal>
  );
}
