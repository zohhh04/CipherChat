import { useState } from 'react';
import FileAttachment from './FileAttachment';
import TranslationWidget from './TranslationWidget';
import { Twemoji, TrashIcon } from '../common/EmojiText';
import PasswordInput from '../common/PasswordInput';
import { timeShort } from '../../utils/format';
import { useChat } from '../../context/ChatContext';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function Ticks({ message, myId }) {
  if (!message || message.sender !== myId || message.deletedAt) return null;
  const delivered = Array.isArray(message.deliveredTo) ? message.deliveredTo : [];
  const read = Array.isArray(message.readBy) ? message.readBy : [];
  const othersDelivered = delivered.filter((u) => u !== myId).length;
  const othersRead = read.filter((u) => u !== myId).length;

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

function PollBody({ message, myId, chat, onVote }) {
  const poll = message.poll;
  const [voting, setVoting] = useState(-1);
  if (!poll) return null;
  const total = poll.options.reduce((n, _, i) => n + (poll.votes?.[i]?.length || 0), 0);
  const myVote = poll.options.findIndex((_, i) => (poll.votes?.[i] || []).map(String).includes(String(myId)));

  const vote = async (idx) => {
    if (voting >= 0 || !onVote) return;
    setVoting(idx);
    try {
      await onVote(message.id, idx);
    } finally {
      setVoting(-1);
    }
  };

  return (
    <div className="poll-body">
      <p className="poll-question">📊 {poll.question}</p>
      <div className="poll-options">
        {poll.options.map((opt, i) => {
          const count = poll.votes?.[i]?.length || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = myVote === i;
          const voters = (poll.votes?.[i] || []).map(
            (uid) => (chat?.members || []).find((m) => String(m.id) === String(uid))?.username || 'Unknown'
          );
          return (
            <button
              key={i}
              type="button"
              className={`poll-option ${mine ? 'my-vote' : ''}`}
              onClick={() => vote(i)}
              disabled={voting >= 0}
              title={voters.length > 0 ? voters.join(', ') : 'No votes yet'}
            >
              <span className="poll-bar" style={{ width: `${pct}%` }} />
              <span className="poll-opt-text">{opt}</span>
              <span className="poll-count">{count} vote{count !== 1 ? 's' : ''} · {pct}%</span>
              {mine && <span className="poll-mine">✓</span>}
            </button>
          );
        })}
      </div>
      <span className="poll-total">{total} vote{total !== 1 ? 's' : ''} total · tap an option to vote</span>
    </div>
  );
}

export default function MessageBubble({ message, chat, myId, highlight = '', isPinned = false, onEdit, onDelete, onReply, onAddReaction, onRemoveReaction, onPin, onForward, onVote, onCallBack, replyToMessage }) {
  const mine = message?.sender === myId;
  const senderName = (chat?.members || []).find((m) => m.id === message?.sender)?.username || 'Unknown';
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [unlockKey, setUnlockKey] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [showUnlock, setShowUnlock] = useState(false);
  const { unlockSecureMessage } = useChat();

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
    if (!message || message.deletedAt) return;
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
    if (onDelete && message?.id) onDelete(message.id);
  };

  const handleReply = () => {
    setShowMenu(false);
    if (onReply) onReply(message);
  };

  const handlePin = () => {
    setShowMenu(false);
    if (onPin) onPin(message);
  };

  const handleForward = () => {
    setShowMenu(false);
    if (onForward) onForward(message);
  };

  const handleVote = (messageId, optionIndex) => {
    if (onVote) return onVote(messageId, optionIndex);
    return Promise.resolve();
  };

  const handleReaction = (emoji) => {
    setShowReactionPicker(false);
    setShowMenu(false);
    const myReactions = message?.reactions || {};
    const hasReacted = myReactions[emoji] && (myReactions[emoji] || []).includes(myId);
    if (hasReacted && onRemoveReaction) {
      onRemoveReaction(message.id, emoji);
    } else if (!hasReacted && onAddReaction) {
      onAddReaction(message.id, emoji);
    }
  };

  const reactions = message?.reactions || {};
  const reactionEntries = Object.entries(reactions).filter(([, users]) => (users || []).length > 0);

  const isNormal = message?.mode === 'normal';
  const isCall = message?.type === 'call';
  const isPoll = message?.type === 'poll' && message.poll;
  const isSystem = message?.type === 'system';
  const editable = mine && message?.type === 'text' && message.text && !message.locked && !message.deletedAt;

  // System notices render centered without a bubble chrome.
  if (!message) return null;
  if (isSystem && !message.deletedAt) {
    return (
      <div className="system-row">
        <span className="system-pill">{message.text}</span>
      </div>
    );
  }

  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className={`bubble ${isCall ? 'call-bubble' : ''}`} onContextMenu={handleContextMenu}>
        {!mine && chat?.type === 'group' && <span className="bubble-author">{senderName}</span>}
        <span className={`mode-chip ${isNormal ? 'normal' : 'secure'}`} title={isNormal ? 'Normal chat — not end-to-end encrypted' : 'Secure chat — end-to-end encrypted'}>
          {isNormal ? '🟢 Normal' : '🔐 Encrypted'}
        </span>
        {message.forwarded && <span className="forwarded-label" title="Forwarded from another chat">↪ Forwarded</span>}
        {isPinned && <span className="pinned-label" title="This message is pinned">📌 Pinned</span>}
        {replyToMessage && !replyToMessage.deletedAt && (
          <div className="reply-preview" onClick={() => onReply && onReply(replyToMessage)}>
            <span className="reply-author">{(chat?.members || []).find((m) => m.id === replyToMessage.sender)?.username || 'Unknown'}</span>
            <span className="reply-text">{replyToMessage.text || (replyToMessage.file ? '[File]' : replyToMessage.poll ? `📊 ${replyToMessage.poll.question}` : '...')}</span>
          </div>
        )}
        {message?.deletedAt ? (
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
        ) : isCall ? (
          <div className="call-msg">
            <span className="call-icon" title={message.callKind === 'video' ? 'Video call' : 'Voice call'}>
              {message.callKind === 'video' ? '🎥' : '📞'}
            </span>
            <span className="call-text">{message.text || (message.callKind === 'video' ? 'Missed video call' : 'Missed voice call')}</span>
            {onCallBack && (
              <button type="button" className="btn primary sm call-back-btn" onClick={() => onCallBack(message)}>
                Call back
              </button>
            )}
          </div>
        ) : isPoll ? (
          <PollBody message={message} myId={myId} chat={chat} onVote={handleVote} />
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
                className={`reaction-chip ${(users || []).includes(myId) ? 'my-reaction' : ''}`}
                onClick={() => handleReaction(emoji)}
                title={(users || []).map((uid) => (chat?.members || []).find((m) => m.id === uid)?.username || 'Unknown').join(', ')}
              >
                {emoji} <span className="reaction-count">{(users || []).length}</span>
              </button>
            ))}
          </div>
        )}
        {!message?.deletedAt && (
          <div className="bubble-actions">
            <button
              type="button"
              className="icon-btn reaction-btn"
              title="Add reaction"
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowReactionPicker(!showReactionPicker); }}
            >
              <Twemoji>😊</Twemoji>
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Forward to another chat"
              onClick={(e) => { e.stopPropagation(); handleForward(); }}
            >
              <Twemoji>↪</Twemoji>
            </button>
            <button
              type="button"
              className="icon-btn"
              title={isPinned ? 'Unpin message' : 'Pin message'}
              onClick={(e) => { e.stopPropagation(); handlePin(); }}
            >
              <Twemoji>📌</Twemoji>
            </button>
            {editable && (
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
              <TrashIcon />
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
            <button type="button" onClick={handleForward}>
              <Twemoji>↪</Twemoji> Forward
            </button>
            <button type="button" onClick={handlePin}>
              <Twemoji>📌</Twemoji> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            {message.text && !isPoll && !isCall && (
              <button type="button" onClick={() => { setShowMenu(false); setShowTranslation(!showTranslation); }}>
                <Twemoji>🌐</Twemoji> Translate
              </button>
            )}
            {editable && (
              <button type="button" onClick={handleEdit}>
                <Twemoji>✏️</Twemoji> Edit
              </button>
            )}
            {mine && (
              <button type="button" className="danger" onClick={handleDelete}>
                <TrashIcon size={15} /> Delete for everyone
              </button>
            )}
            {!mine && (
              <button type="button" className="danger" onClick={handleDelete}>
                <TrashIcon size={15} /> Remove from my view
              </button>
            )}
          </div>
        )}
        {showTranslation && message.text && !isPoll && !isCall && (
          <TranslationWidget text={message.text} />
        )}
      </div>
    </div>
  );
}
