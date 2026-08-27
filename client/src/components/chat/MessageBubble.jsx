import FileAttachment from './FileAttachment';
import { timeShort } from '../../utils/format';

function Ticks({ message, myId }) {
  if (message.sender !== myId || message.deletedAt) return null;
  const othersDelivered = message.deliveredTo.filter((u) => u !== myId).length;
  const othersRead = message.readBy.filter((u) => u !== myId).length;

  if (othersRead > 0) return <span className="ticks read" title="Read">✓✓</span>;
  if (othersDelivered > 0) return <span className="ticks" title="Delivered">✓✓</span>;
  return <span className="ticks" title="Sent">✓</span>;
}

export default function MessageBubble({ message, chat, myId }) {
  const mine = message.sender === myId;
  const senderName = chat.members.find((m) => m.id === message.sender)?.username || 'Unknown';

  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="bubble">
        {!mine && chat.type === 'group' && <span className="bubble-author">{senderName}</span>}
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
          <Ticks message={message} myId={myId} />
        </span>
      </div>
    </div>
  );
}
