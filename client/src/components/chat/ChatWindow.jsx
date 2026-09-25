import { useMemo, useState, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Twemoji } from '../common/EmojiText';
import { toast } from '../common/Toast';
import { usersApi } from '../../api';
import Sidebar from './Sidebar';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import GroupInfoModal from './GroupInfoModal';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import ChatSearch from './ChatSearch';
import { useCall } from '../../context/CallContext';

export default function ChatWindow() {
  const { user, publicKey } = useAuth();
  const { chats, activeChatId, messagesByChat, typingByChat, deleteMessage, deleteMessageLocal, clearChatHistory, editMessage, addReaction, removeReaction, getChatMode, setChatMode } = useChat();
  const [clearing, setClearing] = useState(false);
  const chatMode = activeChatId ? getChatMode(activeChatId) : 'normal';
  const { startCall } = useCall();
  const [infoOpen, setInfoOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
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

  // 🔍 In-chat text search: match ids + active match navigation.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => !m.deletedAt && m.text && m.text.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [messages, searchQuery]);

  useEffect(() => {
    setSearchQuery('');
    setActiveMatchIdx(0);
    setSearchOpen(false);
  }, [activeChatId]);

  useEffect(() => {
    setActiveMatchIdx(0);
  }, [searchQuery]);

  const activeMatchId = searchMatches.length > 0
    ? searchMatches[((activeMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length]
    : null;
  const goNextMatch = () => {
    if (searchMatches.length > 0) setActiveMatchIdx((i) => (i + 1) % searchMatches.length);
  };
  const goPrevMatch = () => {
    if (searchMatches.length > 0) {
      setActiveMatchIdx((i) => (i - 1 + searchMatches.length) % searchMatches.length);
    }
  };

  const handleEdit = async (message) => {
    setEditingMessage(message);
  };

  const handleDelete = async (messageId) => {
    if (!activeChatId) return;
    const msg = messages.find((m) => String(m.id) === String(messageId));
    const mine = msg ? String(msg.sender) === String(user.id) : false;
    if (mine) {
      if (!confirm('Delete this message for everyone?')) return;
      try {
        await deleteMessage(activeChatId, messageId);
        toast('Message deleted', 'success');
      } catch (err) {
        toast(err.message || 'Failed to delete message', 'error');
      }
    } else {
      // Messages you didn't send can only be hidden on this device.
      if (!confirm('Remove this message from your view only? (Sender keeps it)')) return;
      deleteMessageLocal(activeChatId, messageId);
      toast('Removed from your view', 'info');
    }
  };

  const handleClearChat = async (chatId) => {
    const cid = chatId || activeChatId;
    if (!cid) return;
    const count = (messagesByChat[String(cid)] || []).filter((m) => !m.deletedAt).length;
    if (count === 0) {
      toast('No messages to clear', 'info');
      return;
    }
    if (!confirm(`Clear all ${count} message${count !== 1 ? 's' : ''} in this chat?\n\nThis deletes history for EVERYONE in the chat and cannot be undone.\n\nSingle messages: hover a bubble and press 🗑️.`)) return;
    setClearing(true);
    try {
      await clearChatHistory(cid);
      toast('Chat history cleared', 'success');
    } catch (err) {
      toast(err.message || 'Failed to clear chat history', 'error');
    } finally {
      setClearing(false);
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
              onSearchToggle={() => setSearchOpen((s) => !s)}
              searchOpen={searchOpen}
              chatMode={chatMode}
              onModeChange={(mode) => setChatMode(activeChatId, mode)}
              onClearChat={() => handleClearChat()}
              clearing={clearing}
              messageCount={messages.filter((m) => !m.deletedAt).length}
              onCall={(mediaType, peerId, peerName) => {
                startCall(peerId, peerName, mediaType).catch(() => {});
              }}
            />
            {searchOpen && (
              <ChatSearch
                query={searchQuery}
                onQuery={setSearchQuery}
                matchCount={searchMatches.length}
                activeIndex={searchMatches.length > 0 ? (((activeMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length) : 0}
                onPrev={goPrevMatch}
                onNext={goNextMatch}
                onClose={() => { setSearchOpen(false); setSearchQuery(''); }}
              />
            )}
            <MessageList messages={messages} chat={chat} myId={user.id} typingNames={typingNames} chatMode={chatMode} searchQuery={searchOpen ? searchQuery : ''} activeMatchId={activeMatchId} onEditMessage={handleEdit} onDeleteMessage={handleDelete} onReplyMessage={handleReply} onAddReaction={handleAddReaction} onRemoveReaction={handleRemoveReaction} />
            <MessageInput
              chatId={activeChatId}
              editingMessage={editingMessage}
              onEditSubmit={handleEditSubmit}
              onEditCancel={() => setEditingMessage(null)}
              replyTo={replyTo}
              onReplyCancel={() => setReplyTo(null)}
              chatMode={chatMode}
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
      {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} />}
      {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
    </div>
  );
}
