import { useState } from 'react';
import FileAttachment from './FileAttachment';
import TranslationWidget from './TranslationWidget';
import { Twemoji } from '../common/EmojiText';
import PasswordInput from '../common/PasswordInput';
import { timeShort } from '../../utils/format';
import { useChat } from '../../context/ChatContext';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function Ticks({ message, myId }) {
  if (message.sender !== myId || message.deletedAt) return null;
  const othersDelivered = message.deliveredTo.filter((u) => u !== myId).length;
  const othersRead = message.readBy.filter((u) => u !== myId).length;

  if (othersRead > 0) return <span className="ticks read" title="Read">✓✓</span>;
  if (othersDelivered > 0) return <span className="ticks" title="Delivered">✓✓</span>;
  return <span className="ticks" title="Sent">✓</span>;
}

function renderHighlighted(text, term) {
  const q = (term || '').trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={key++} className="search-hit">{text.slice(idx, idx + needle.length)}</mark>);
    i = idx + needle.length;
  }
  return parts;
}

export default function MessageBubble({ message, chat, myId, highlight = '', onEdit, onDelete, onReply, onAddReaction, onRemoveReaction, replyToMessage }) {
  const mine = message.sender === myId;
  const senderName = chat.members.find((m) => m.id === message.sender)?.username || 'Unknown';
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [unlockKey, setUnlockKey] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [showUnlock, setShowUnlock] = useState(false);
  let unlockSecureMessage = null;
  try {
    ({ unlockSecureMessage } = useChat());
  } catch {
    unlockSecureMessage = null;
  }

  const handleUnlock = async (e) => {
    if (e) e.preventDefault();
    if (!unlockKey.trim() || unlockBusy) return;
    setUnlockBusy(true);
    setUnlockError('');
    try {
      await unlockSecureMessage(chat.id, message.id, unlockKey.trim());
      setUnlockKey('');
      setShowUnlock(false);
    } catch (err) {
      setUnlockError(err.message || 'Wrong key — could not decrypt');
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleContextMenu = (e) => {
    if (message.deletedAt) return;
    e.preventDefault();
    setShowReactionPicker(false);
    setShowMenu(!showMenu);
  };

  const handleEdit = () => {
    setShowMenu(false);
    if (onEdit) onEdit(message);
  };

  const handleDelete = () => {
    setShowMenu(false);
    if (onDelete) onDelete(message.id);
  };

  const handleReply = () => {
    setShowMenu(false);
    if (onReply) onReply(message);
  };

  const handleReaction = (emoji) => {
    setShowReactionPicker(false);
    setShowMenu(false);
    const myReactions = message.reactions || {};
    const hasReacted = myReactions[emoji] && myReactions[emoji].includes(myId);
    if (hasReacted && onRemoveReaction) {
      onRemoveReaction(message.id, emoji);
    } else if (!hasReacted && onAddReaction) {
      onAddReaction(message.id, emoji);
    }
  };

  const reactions = message.reactions || {};
  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  const isNormal = message.mode === 'normal';
  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="bubble" onContextMenu={handleContextMenu}>
        {!mine && chat.type === 'group' && <span className="bubble-author">{senderName}</span>}
        <span className={`mode-chip ${isNormal ? 'normal' : 'secure'}`} title={isNormal ? 'Normal chat — not end-to-end encrypted' : 'Secure chat — end-to-end encrypted'}>
          {isNormal ? '🟢 Normal' : '🔐 Encrypted'}
        </span>
        {replyToMessage && !replyToMessage.deletedAt && (
          <div className="reply-preview" onClick={() => onReply && onReply(replyToMessage)}>
            <span className="reply-author">{chat.members.find((m) => m.id === replyToMessage.sender)?.username || 'Unknown'}</span>
            <span className="reply-text">{replyToMessage.text || (replyToMessage.file ? '[File]' : '...')}</span>
          </div>
        )}
        {message.deletedAt ? (
          <em className="deleted">This message was deleted</em>
        ) : message.locked ? (
          <div className="locked-secure">
            <p className="bubble-text">🔐 Encrypted message</p>
            <code
              className="locked-preview"
              title="Encrypted content — enter the sender's key to view"
              style={{ display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7, fontSize: 11 }}
            >
              {(message.lockPreview || message.lockCiphertext || '').slice(0, 160)}
            </code>
            {!showUnlock ? (
              <button type="button" className="btn primary sm" style={{ marginTop: 8 }} onClick={() => setShowUnlock(true)}>
                🔑 Enter key to view
              </button>
            ) : (
              <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <PasswordInput
                  placeholder="Enter sender's key"
                  value={unlockKey}
                  onChange={(e) => setUnlockKey(e.target.value)}
                  autoFocus
                  wrapperStyle={{ minWidth: 200 }}
                />
                {unlockError && <span className="decrypt-error" style={{ fontSize: 12 }}>{unlockError}</span>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="submit" className="btn primary sm" disabled={unlockBusy || !unlockKey.trim()}>
                    {unlockBusy ? 'Decrypting…' : 'View message'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => { setShowUnlock(false); setUnlockKey(''); setUnlockError(''); }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <>
            {message.file ? (
              <FileAttachment file={message.file} mine={mine} message={message} chatId={chat && chat.id} />
            ) : null}
            {message.viewOnce && !message.file && (
              <div className="viewonce-expired">
                <span className="viewonce-icon">👁️‍🗨️</span>
                <span>{mine ? 'View-once photo opened' : 'Photo already viewed — deleted'}</span>
              </div>
            )}
            {message.text && <p className="bubble-text">{renderHighlighted(message.text, highlight)}</p>}
            {message.decryptError && (
              <p className="bubble-text decrypt-error">🔐 Unable to decrypt this message</p>
            )}
          </>
        )}
        <span className="bubble-meta">
          {timeShort(message.createdAt)}
          {message.editedAt && <span className="edited-label" title={`Edited ${new Date(message.editedAt).toLocaleString()}`}>(edited)</span>}
          <Ticks message={message} myId={myId} />
        </span>
        {reactionEntries.length > 0 && (
          <div className="reactions-row">
            {reactionEntries.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                className={`reaction-chip ${users.includes(myId) ? 'my-reaction' : ''}`}
                onClick={() => handleReaction(emoji)}
                title={users.map((uid) => chat.members.find((m) => m.id === uid)?.username || 'Unknown').join(', ')}
              >
                {emoji} <span className="reaction-count">{users.length}</span>
              </button>
            ))}
          </div>
        )}
        {!message.deletedAt && (
          <div className="bubble-actions">
            <button
              type="button"
              className="icon-btn reaction-btn"
              title="Add reaction"
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowReactionPicker(!showReactionPicker); }}
            >
              <Twemoji>😊</Twemoji>
            </button>
            {mine && message.text && !message.locked && (
              <button
                type="button"
                className="icon-btn"
                title="Edit message"
                onClick={(e) => { e.stopPropagation(); handleEdit(); }}
              >
                <Twemoji>✏️</Twemoji>
              </button>
            )}
            <button
              type="button"
              className="icon-btn danger"
              title={mine ? 'Delete message for everyone' : 'Remove from my view only'}
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            >
              <Twemoji>🗑️</Twemoji>
            </button>
          </div>
        )}
        {showReactionPicker && (
          <div className="reaction-picker" onMouseLeave={() => setShowReactionPicker(false)}>
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" className="reaction-option" onClick={() => handleReaction(emoji)}>
                <Twemoji>{emoji}</Twemoji>
              </button>
            ))}
          </div>
        )}
        {showMenu && (
          <div className="msg-context-menu" onMouseLeave={() => setShowMenu(false)}>
            <button type="button" onClick={handleReply}>
              <Twemoji>↩</Twemoji> Reply
            </button>
            {message.text && (
              <button type="button" onClick={() => { setShowMenu(false); setShowTranslation(!showTranslation); }}>
                <Twemoji>🌐</Twemoji> Translate
              </button>
            )}
            {mine && !message.deletedAt && (
              <button type="button" onClick={handleEdit}>
                <Twemoji>✏️</Twemoji> Edit
              </button>
            )}
            {mine && (
              <button type="button" className="danger" onClick={handleDelete}>
                <Twemoji>🗑️</Twemoji> Delete for everyone
              </button>
            )}
            {!mine && (
              <button type="button" className="danger" onClick={handleDelete}>
                <Twemoji>🗑️</Twemoji> Remove from my view
              </button>
            )}
          </div>
        )}
        {showTranslation && message.text && (
          <TranslationWidget text={message.text} />
        )}
      </div>
    </div>
  );
}
