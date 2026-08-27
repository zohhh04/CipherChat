import { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import Avatar from '../common/Avatar';
import { usersApi } from '../../api';
import { useChat } from '../../context/ChatContext';

export default function NewChatModal({ onClose }) {
  const { createDirect } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(null);
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
          setResults(users);
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
  }, [query]);

  const pick = (u) => {
    setSelected(u);
    setQuery(u.username);
    setResults([]);
  };

  const startChat = async () => {
    if (!selected) return;
    setBusy(true);
    setCreateError('');
    try {
      await createDirect(selected._id);
      onClose();
    } catch (e) {
      setCreateError(e.message || 'Could not open chat');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New chat" onClose={onClose}>
      <input
        className="text-input"
        placeholder="Search by username or email"
        value={query}
        autoFocus
        onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
      />
      {!selected && (
        <div className="user-results">
          {results.map((u) => (
            <button key={String(u._id)} type="button" className="chat-item" onClick={() => pick(u)}>
              <Avatar id={String(u._id)} name={u.username} size={40} />
              <div className="chat-item-main">
                <span className="chat-name">{u.username}</span>
                {u.about && <span className="chat-preview">{u.about}</span>}
              </div>
            </button>
          ))}
          {searchError && <p className="empty-hint" style={{ color: 'var(--danger)' }}>{searchError}</p>}
          {searched && !searchError && results.length === 0 && (
            <p className="empty-hint">No users found. Try a username.</p>
          )}
        </div>
      )}
      {selected && (
        <div className="selected-user-preview">
          <Avatar id={String(selected._id)} name={selected.username} size={40} />
          <span className="chat-name">{selected.username}</span>
        </div>
      )}
      {createError && <p className="alert error" style={{ marginTop: 8 }}>{createError}</p>}
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={startChat} disabled={busy || !selected}>
          {busy ? 'Encrypting…' : 'Start Chat'}
        </button>
      </div>
    </Modal>
  );
}
