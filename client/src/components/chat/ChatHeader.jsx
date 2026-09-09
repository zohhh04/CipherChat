import { useState, useRef, useEffect } from 'react';
import Avatar from '../common/Avatar';
import { Twemoji } from '../common/EmojiText';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

export default function ChatHeader({ chat, typingNames, onOpenInfo, onCall, onBack, onSummary }) {
  const { user } = useAuth();
  const { onlineIds } = useSocket();
  const [memberPicker, setMemberPicker] = useState(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setMemberPicker(null);
      }
    };
    if (memberPicker) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [memberPicker]);

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

  const otherMembers = isDirect
    ? []
    : chat.members.filter((m) => String(m.id) !== String(user.id));

  return (
    <header className="chat-header">
      <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="Back">
        <Twemoji>←</Twemoji>
      </button>
      <button type="button" className="peer-row" onClick={onOpenInfo}>
        <Avatar id={String(chat.id)} name={title} size={40} online={online} />
        <div className="peer-meta">
          <strong>{title}</strong>
          <span className={`peer-sub ${typingNames.length > 0 ? 'typing' : online ? 'on' : ''}`}>{subtitle}</span>
        </div>
      </button>
      <button type="button" className="icon-btn" onClick={onSummary} title="AI Summary"><Twemoji>📝</Twemoji></button>
      {isDirect && (
        <>
          <button type="button" className="icon-btn" onClick={() => onCall('audio', peer.id, peer.username)} title="Voice call"><Twemoji>📞</Twemoji></button>
          <button type="button" className="icon-btn" onClick={() => onCall('video', peer.id, peer.username)} title="Video call"><Twemoji>🎥</Twemoji></button>
        </>
      )}
      {!isDirect && otherMembers.length > 0 && (
        <div className="group-call-wrapper" ref={pickerRef}>
          <button type="button" className="icon-btn" onClick={() => setMemberPicker(memberPicker ? null : 'voice')} title="Voice call">
            <Twemoji>📞</Twemoji>
          </button>
          <button type="button" className="icon-btn" onClick={() => setMemberPicker(memberPicker ? null : 'video')} title="Video call">
            <Twemoji>🎥</Twemoji>
          </button>
          {memberPicker && (
            <div className="member-call-picker">
              <div className="picker-header">Call a member</div>
              {otherMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="picker-member"
                  onClick={() => {
                    onCall(memberPicker, m.id, m.username);
                    setMemberPicker(null);
                  }}
                >
                  <Avatar id={String(m.id)} name={m.username} size={28} />
                  <span>{m.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!isDirect && (
        <button type="button" className="icon-btn" onClick={onOpenInfo} title="Group info"><Twemoji>ℹ️</Twemoji></button>
      )}
    </header>
  );
}
