import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import { Twemoji } from '../common/EmojiText';
import { dayLabel } from '../../utils/format';

export default function MessageList({ messages, chat, myId, typingNames, chatMode = 'normal', searchQuery = '', activeMatchId = null, pinnedId = null, onEditMessage, onDeleteMessage, onReplyMessage, onAddReaction, onRemoveReaction, onPinMessage, onForwardMessage, onVotePoll, onCallBack }) {
  const endRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    // Only autoscroll if user is already near the bottom — don't hijack history reading.
    const el = listRef.current;
    if (!el) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typingNames.length]);

  // Jump to the active search match.
  useEffect(() => {
    if (activeMatchId) {
      document.getElementById(`msg-${activeMatchId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeMatchId]);

  let lastDay = '';
  const secure = chatMode === 'encrypted';

  return (
    <div className="message-list" ref={listRef}>
      <div className={`mode-banner ${secure ? 'secure' : 'normal'}`}>
        {secure ? (
          <><Twemoji>🔐</Twemoji> <strong>SECURE CHAT</strong> — Messages are encrypted on your device and decrypted on the recipient&apos;s device.</>
        ) : (
          <><Twemoji>🟢</Twemoji> <strong>NORMAL CHAT</strong> — Messages are not end-to-end encrypted.</>
        )}
      </div>
      {messages.map((m) => {
        const day = dayLabel(m.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        const replyToMsg = m.replyTo ? messages.find((msg) => msg.id === m.replyTo) : null;
        const isActiveMatch = activeMatchId && m.id === activeMatchId;
        return (
          <div key={m.id} id={`msg-${m.id}`} className={isActiveMatch ? 'search-active-match' : undefined}>
            {showDay && <div className="day-divider">{day}</div>}
            <MessageBubble message={m} chat={chat} myId={myId} highlight={searchQuery} isPinned={pinnedId && String(pinnedId) === String(m.id)} onEdit={onEditMessage} onDelete={onDeleteMessage} onReply={onReplyMessage} onAddReaction={onAddReaction} onRemoveReaction={onRemoveReaction} onPin={onPinMessage} onForward={onForwardMessage} onVote={onVotePoll} onCallBack={onCallBack} replyToMessage={replyToMsg} />
          </div>
        );
      })}
      {typingNames.length > 0 && (
        <div className="bubble-row theirs">
          <div className="bubble typing-bubble">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
