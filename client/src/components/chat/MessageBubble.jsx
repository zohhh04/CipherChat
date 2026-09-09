import { useState } from 'react';
import FileAttachment from './FileAttachment';
import TranslationWidget from './TranslationWidget';
import { Twemoji } from '../common/EmojiText';
import { timeShort } from '../../utils/format';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function Ticks({ message, myId }) {
  if (message.sender !== myId || message.deletedAt) return null;
  const othersDelivered = message.deliveredTo.filter((u) => u !== myId).length;
  const othersRead = message.readBy.filter((u) => u !== myId).length;

  if (othersRead > 0) return <span className="ticks read" title="Read">✓✓</span>;
  if (othersDelivered > 0) return <span className="ticks" title="Delivered">✓✓</span>;
  return <span className="ticks" title="Sent">✓</span>;
}

export default function MessageBubble({ message, chat, myId, onEdit, onDelete, onReply, onAddReaction, onRemoveReaction, replyToMessage }) {
  const mine = message.sender === myId;
  const senderName = chat.members.find((m) => m.id === message.sender)?.username || 'Unknown';
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

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

  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="bubble" onContextMenu={handleContextMenu}>
        {!mine && chat.type === 'group' && <span className="bubble-author">{senderName}</span>}
        {replyToMessage && !replyToMessage.deletedAt && (
          <div className="reply-preview" onClick={() => onReply && onReply(replyToMessage)}>
            <span className="reply-author">{chat.members.find((m) => m.id === replyToMessage.sender)?.username || 'Unknown'}</span>
            <span className="reply-text">{replyToMessage.text || (replyToMessage.file ? '[File]' : '...')}</span>
          </div>
        )}
        {message.deletedAt ? (
          <em className="deleted">This message was deleted</em>
        ) : (
          <>
            {message.file ? (
              <FileAttachment file={message.file} mine={mine} />
            ) : null}
            {message.text && <p className="bubble-text">{message.text}</p>}
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
                <Twemoji>🗑️</Twemoji> Delete
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
