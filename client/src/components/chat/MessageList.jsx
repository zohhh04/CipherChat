import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import { dayLabel } from '../../utils/format';

export default function MessageList({ messages, chat, myId, typingNames }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, typingNames.length]);

  let lastDay = '';

  return (
    <div className="message-list">
      <div className="e2ee-note">🔒 Messages are end-to-end encrypted. Only people in this chat can read them.</div>
      {messages.map((m) => {
        const day = dayLabel(m.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={m.id}>
            {showDay && <div className="day-divider">{day}</div>}
            <MessageBubble message={m} chat={chat} myId={myId} />
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
