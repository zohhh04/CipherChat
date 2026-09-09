import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import { Twemoji } from '../common/EmojiText';
import { dayLabel } from '../../utils/format';

export default function MessageList({ messages, chat, myId, typingNames, onEditMessage, onDeleteMessage, onReplyMessage, onAddReaction, onRemoveReaction }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typingNames.length]);

  let lastDay = '';

  return (
    <div className="message-list">
      <div className="e2ee-note"><Twemoji>🔒</Twemoji> Messages are end-to-end encrypted. Only people in this chat can read them.</div>
      {messages.map((m) => {
        const day = dayLabel(m.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        const replyToMsg = m.replyTo ? messages.find((msg) => msg.id === m.replyTo) : null;
        return (
          <div key={m.id}>
            {showDay && <div className="day-divider">{day}</div>}
            <MessageBubble message={m} chat={chat} myId={myId} onEdit={onEditMessage} onDelete={onDeleteMessage} onReply={onReplyMessage} onAddReaction={onAddReaction} onRemoveReaction={onRemoveReaction} replyToMessage={replyToMsg} />
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
