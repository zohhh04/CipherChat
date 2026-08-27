import { useMemo, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import GroupInfoModal from './GroupInfoModal';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import { useCall } from '../../context/CallContext';

export default function ChatWindow() {
  const { user, identityReady, publicKey, reUnlock } = useAuth();
  const { chats, activeChatId, messagesByChat, typingByChat } = useChat();
  const { startCall } = useCall();
  const [infoOpen, setInfoOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);

  const chat = activeChatId ? chats[activeChatId] : null;
  const messages = activeChatId ? messagesByChat[String(activeChatId)] || [] : [];
  const typingNames = useMemo(
    () => Object.values((activeChatId && typingByChat[String(activeChatId)]) || {}).map((t) => t.username),
    [activeChatId, typingByChat]
  );

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!unlockPass.trim()) return;
    setUnlockBusy(true);
    setUnlockError('');
    const res = await reUnlock(unlockPass);
    setUnlockBusy(false);
    if (!res.ok) setUnlockError(res.message || 'Wrong password');
    setUnlockPass('');
  };

  if (!identityReady) {
    return (
      <div className="app-shell">
        <Sidebar onNewChat={() => setNewChatOpen(true)} onNewGroup={() => setNewGroupOpen(true)} />
        <main className="chat-main">
          <div className="empty-state">
            <div className="lock-art">🔐</div>
            <h2>Enter your password</h2>
            <p>Your encryption keys need to be unlocked</p>
            <form onSubmit={handleUnlock} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, width: 300 }}>
              <input
                type="password"
                className="text-input"
                placeholder="Password"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
                autoFocus
              />
              {unlockError && <div className="alert error">{unlockError}</div>}
              <button type="submit" className="btn primary" disabled={unlockBusy || !unlockPass.trim()}>
                {unlockBusy ? 'Unlocking…' : 'Unlock'}
              </button>
            </form>
          </div>
        </main>
        {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} />}
        {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
      </div>
    );
  }

  return (
    <div className={`app-shell ${activeChatId ? 'has-active' : ''}`}>
      <Sidebar
        onNewChat={() => setNewChatOpen(true)}
        onNewGroup={() => setNewGroupOpen(true)}
      />
      <main className="chat-main">
        {chat ? (
          <>
            <ChatHeader
              chat={chat}
              typingNames={typingNames}
              onBack={() => window.history.back()}
              onOpenInfo={() => setInfoOpen(true)}
              onCall={(mediaType) => {
                const peer = chat.members.find((m) => m.id !== user.id);
                startCall(peer.id, peer.username, mediaType).catch(() => {});
              }}
            />
            <MessageList messages={messages} chat={chat} myId={user.id} typingNames={typingNames} />
            <MessageInput chatId={activeChatId} />
            {infoOpen && <GroupInfoModal chat={chat} onClose={() => setInfoOpen(false)} />}
          </>
        ) : (
          <div className="empty-state">
            <div className="lock-art">🔐</div>
            <h2>Secure Chat</h2>
            <p>Select a chat to start messaging</p>
            {publicKey && <small>End-to-end encrypted. Only members of each chat can read its messages.</small>}
          </div>
        )}
      </main>
      {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} />}
      {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
    </div>
  );
}
