import { useMemo, useState, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Twemoji } from '../common/EmojiText';
import { usersApi } from '../../api';
import Sidebar from './Sidebar';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import GroupInfoModal from './GroupInfoModal';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import SummaryPanel from './SummaryModal';
import { useCall } from '../../context/CallContext';

export default function ChatWindow() {
  const { user, identityReady, publicKey, reUnlock } = useAuth();
  const { chats, activeChatId, messagesByChat, typingByChat, deleteMessage, editMessage, addReaction, removeReaction } = useChat();
  const { startCall } = useCall();
  const [infoOpen, setInfoOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);

  const { registerSync } = useTheme();

  useEffect(() => {
    if (user) {
      registerSync((theme) => {
        usersApi.updateMe({ theme }).catch(() => {});
      });
    }
  }, [user, registerSync]);

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

  const handleEdit = async (message) => {
    setEditingMessage(message);
  };

  const handleDelete = async (messageId) => {
    if (!activeChatId) return;
    if (!confirm('Delete this message?')) return;
    try {
      await deleteMessage(activeChatId, messageId);
    } catch (err) {
      void 0;
    }
  };

  const handleEditSubmit = async (text) => {
    if (!activeChatId || !editingMessage) return;
    await editMessage(activeChatId, editingMessage.id, text);
    setEditingMessage(null);
  };

  const handleReply = (message) => {
    setReplyTo(message);
  };

  const handleAddReaction = async (messageId, emoji) => {
    if (!activeChatId) return;
    await addReaction(activeChatId, messageId, emoji);
  };

  const handleRemoveReaction = async (messageId, emoji) => {
    if (!activeChatId) return;
    await removeReaction(activeChatId, messageId, emoji);
  };

  const handleSendWithReply = async (text) => {
    setReplyTo(null);
  };

  if (!identityReady) {
    return (
      <div className="app-shell">
        <Sidebar onNewChat={() => setNewChatOpen(true)} onNewGroup={() => setNewGroupOpen(true)} />
        <main className="chat-main">
          <div className="empty-state">
            <div className="lock-art"><Twemoji>🔐</Twemoji></div>
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
              onSummary={() => setSummaryOpen(true)}
              onCall={(mediaType, peerId, peerName) => {
                startCall(peerId, peerName, mediaType).catch(() => {});
              }}
            />
            <MessageList messages={messages} chat={chat} myId={user.id} typingNames={typingNames} onEditMessage={handleEdit} onDeleteMessage={handleDelete} onReplyMessage={handleReply} onAddReaction={handleAddReaction} onRemoveReaction={handleRemoveReaction} />
            <MessageInput
              chatId={activeChatId}
              editingMessage={editingMessage}
              onEditSubmit={handleEditSubmit}
              onEditCancel={() => setEditingMessage(null)}
              replyTo={replyTo}
              onReplyCancel={() => setReplyTo(null)}
            />
            {infoOpen && <GroupInfoModal chat={chat} onClose={() => setInfoOpen(false)} />}
          </>
        ) : (
          <div className="empty-state">
            <div className="lock-art"><Twemoji>💬</Twemoji></div>
            <h2>CipherChat Web</h2>
            <p>Send and receive messages without keeping your phone online.<br/>Use CipherChat on up to 4 linked devices and 1 phone at the same time.</p>
            {publicKey && <small>End-to-end encrypted. Only members of each chat can read its messages.</small>}
          </div>
        )}
      </main>
      {summaryOpen && <SummaryPanel chatId={activeChatId} onClose={() => setSummaryOpen(false)} />}
      {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} />}
      {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
    </div>
  );
}
