import { useState, useRef, useEffect } from 'react';
import Avatar from '../common/Avatar';
import { Twemoji } from '../common/EmojiText';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

export default function ChatHeader({ chat, typingNames, onOpenInfo, onCall, onBack, onSearchToggle, searchOpen, chatMode = 'normal', onModeChange, onClearChat, clearing = false, messageCount = 0 }) {
  const secure = chatMode === 'encrypted';
  const { user } = useAuth();
  const { onlineIds } = useSocket();
  const [memberPicker, setMemberPicker] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pickerRef = useRef(null);
  const deleteRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setMemberPicker(null);
      }
      if (deleteRef.current && !deleteRef.current.contains(e.target)) {
        setDeleteOpen(false);
      }
    };
    if (memberPicker || deleteOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [memberPicker, deleteOpen]);

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
        <Avatar id={isDirect ? String(peer?.id) : String(chat.id)} name={title} size={40} avatar={isDirect ? (peer?.avatar || '') : ''} online={online} />
        <div className="peer-meta">
          <strong>{title}</strong>
          <span className={`peer-sub ${typingNames.length > 0 ? 'typing' : online ? 'on' : ''}`}>{subtitle}</span>
        </div>
      </button>
      <div className="mode-switch" role="group" aria-label="Chat mode">
        <button
          type="button"
          className={`mode-btn ${!secure ? 'active normal' : ''}`}
          onClick={() => onModeChange && onModeChange('normal')}
          title="Normal chat — no encryption"
        >
          <Twemoji>🟢</Twemoji> Normal
        </button>
        <button
          type="button"
          className={`mode-btn ${secure ? 'active secure' : ''}`}
          onClick={() => onModeChange && onModeChange('encrypted')}
          title="Secure chat — end-to-end encrypted"
        >
          <Twemoji>🔐</Twemoji> Secure
        </button>
      </div>
      <button type="button" className={`icon-btn ${searchOpen ? 'active' : ''}`} onClick={onSearchToggle} title="Search text in this chat"><Twemoji>🔍</Twemoji></button>
      <div className="group-call-wrapper" ref={deleteRef}>
        <button
          type="button"
          className={`icon-btn danger ${deleteOpen ? 'active' : ''}`}
          onClick={() => setDeleteOpen((o) => !o)}
          title="Delete messages — clear all history or delete singly"
          disabled={clearing}
        >
          <Twemoji>🗑️</Twemoji>
        </button>
        {deleteOpen && (
          <div className="member-call-picker delete-picker">
            <div className="picker-header">Delete messages</div>
            <div className="delete-hint">
              {messageCount > 0 ? `${messageCount} message${messageCount !== 1 ? 's' : ''} in this chat` : 'No messages loaded'}
              <br />Single message: hover a bubble → <Twemoji>🗑️</Twemoji>
            </div>
            <button
              type="button"
              className="picker-member danger-option"
              disabled={clearing || messageCount === 0}
              onClick={() => {
                setDeleteOpen(false);
                if (onClearChat) onClearChat();
              }}
            >
              <Twemoji>🗑️</Twemoji>
              <span>{clearing ? 'Clearing…' : 'Clear all history in this chat'}</span>
            </button>
            <button type="button" className="picker-member" onClick={() => setDeleteOpen(false)}>
              <Twemoji>✕</Twemoji>
              <span>Cancel</span>
            </button>
          </div>
        )}
      </div>
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
                  <Avatar id={String(m.id)} name={m.username} size={28} avatar={m.avatar || ''} />
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
