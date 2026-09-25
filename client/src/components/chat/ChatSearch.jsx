import { useEffect, useRef } from 'react';
import { Twemoji } from '../common/EmojiText';

export default function ChatSearch({ query, onQuery, matchCount, activeIndex, onPrev, onNext, onClose }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-search-bar">
      <span className="search-icon"><Twemoji>🔍</Twemoji></span>
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search text in this chat…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matchCount > 0) {
              if (e.shiftKey) onPrev();
              else onNext();
            }
          } else if (e.key === 'Escape') {
            onClose();
          }
        }}
      />
      {query.trim() && (
        <span className="search-count">
          {matchCount === 0 ? 'No matches' : `${activeIndex + 1}/${matchCount}`}
        </span>
      )}
      <button type="button" className="icon-btn" onClick={onPrev} disabled={matchCount === 0} title="Previous match (Shift+Enter)">
        <Twemoji>▲</Twemoji>
      </button>
      <button type="button" className="icon-btn" onClick={onNext} disabled={matchCount === 0} title="Next match (Enter)">
        <Twemoji>▼</Twemoji>
      </button>
      <button type="button" className="icon-btn" onClick={onClose} title="Close search (Esc)">
        <Twemoji>✕</Twemoji>
      </button>
    </div>
  );
}
