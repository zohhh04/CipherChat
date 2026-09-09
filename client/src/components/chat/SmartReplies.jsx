import { useState, useCallback } from 'react';
import { Twemoji } from '../common/EmojiText';
import { aiApi } from '../../api';
import { toast } from '../common/Toast';

export default function SmartReplies({ chatId, messages, myId, onSelect }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchReplies = useCallback(async () => {
    setLoading(true);
    try {
      const recentTexts = (messages || [])
        .filter((m) => m.text && m.text.trim().length > 0 && !m.deletedAt)
        .slice(-10)
        .map((m) => ({
          sender: m.sender === myId ? 'Me' : 'Other',
          text: m.text,
        }));

      if (recentTexts.length === 0) {
        toast('No messages to base suggestions on. Send some messages first.', 'error');
        setLoading(false);
        return;
      }

      const result = await aiApi.smartReplies(chatId, '', recentTexts);
      const smartReplies = result.replies || result || [];
      if (Array.isArray(smartReplies) && smartReplies.length > 0) {
        setReplies(smartReplies.slice(0, 5));
      } else {
        toast('No suggestions generated. Try again.', 'error');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to get suggestions';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [chatId, messages, myId]);

  if (replies.length === 0 && !loading) {
    return (
      <button
        type="button"
        className="smart-replies-trigger"
        onClick={fetchReplies}
        title="Get AI reply suggestions"
      >
        <Twemoji>✨</Twemoji> Smart Replies
      </button>
    );
  }

  return (
    <div className="smart-replies">
      <div className="smart-replies-header">
        <Twemoji>✨</Twemoji>
        <span>Suggested replies</span>
        <button type="button" className="icon-btn sm" onClick={() => setReplies([])} title="Clear">
          <Twemoji>✕</Twemoji>
        </button>
      </div>
      <div className="smart-replies-list">
        {loading ? (
          <span className="smart-replies-loading">Thinking...</span>
        ) : (
          replies.map((reply, i) => (
            <button
              key={i}
              type="button"
              className="smart-reply-chip"
              onClick={() => { onSelect(reply); setReplies([]); }}
            >
              {reply}
            </button>
          ))
        )}
        {!loading && replies.length > 0 && (
          <button type="button" className="icon-btn sm" onClick={fetchReplies} title="Refresh suggestions">
            <Twemoji>🔄</Twemoji>
          </button>
        )}
      </div>
    </div>
  );
}
