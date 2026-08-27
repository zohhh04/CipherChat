import { useState } from 'react';
import Modal from '../common/Modal';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';

export default function NewConversationModal({ onClose }) {
  const [mode, setMode] = useState(null);

  if (mode === 'chat') return <NewChatModal onClose={onClose} />;
  if (mode === 'group') return <NewGroupModal onClose={onClose} />;

  return (
    <Modal title="New conversation" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 14 }}>Choose a conversation type</p>
      <button type="button" className="conv-choice" onClick={() => setMode('chat')}>
        <span className="conv-icon">💬</span>
        <div>
          <strong>New Chat</strong>
          <span className="muted">Direct message with a user</span>
        </div>
      </button>
      <button type="button" className="conv-choice" onClick={() => setMode('group')}>
        <span className="conv-icon">👥</span>
        <div>
          <strong>New Group</strong>
          <span className="muted">Create a group conversation</span>
        </div>
      </button>
    </Modal>
  );
}
