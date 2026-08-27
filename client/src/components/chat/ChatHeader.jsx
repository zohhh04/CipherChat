import Avatar from '../common/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

export default function ChatHeader({ chat, typingNames, onOpenInfo, onCall, onBack }) {
  const { user } = useAuth();
  const { onlineIds } = useSocket();

  if (!chat) return <header className="chat-header empty" />;

  const isDirect = chat.type === 'direct';
  const peer = isDirect ? chat.members.find((m) => m.id !== user.id) : null;
  const title = isDirect ? peer?.username || 'Unknown' : chat.groupInfo?.name || 'Group';
  const online = isDirect && onlineIds.has(String(peer?.id));

  let subtitle;
  if (typingNames.length > 0) {
    subtitle = `${typingNames[0]} is typing…`;
  } else if (isDirect) {
    subtitle = online ? 'online' : 'offline';
  } else {
    subtitle = `${chat.members.length} members`;
  }

  return (
    <header className="chat-header">
      <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="Back">
        ←
      </button>
      <button type="button" className="peer-row" onClick={onOpenInfo}>
        <Avatar id={String(chat.id)} name={title} size={38} online={online} />
        <div className="peer-meta">
          <strong>{title}</strong>
          <span className={`peer-sub ${typingNames.length > 0 ? 'typing' : online ? 'on' : ''}`}>{subtitle}</span>
        </div>
      </button>
      {isDirect && (
        <>
          <button type="button" className="icon-btn" onClick={() => onCall('audio')} title="Voice call">📞</button>
          <button type="button" className="icon-btn" onClick={() => onCall('video')} title="Video call">🎥</button>
        </>
      )}
      {!isDirect && (
        <button type="button" className="icon-btn" onClick={onOpenInfo} title="Group info">ℹ️</button>
      )}
    </header>
  );
}
