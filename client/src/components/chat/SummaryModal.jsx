import { useState } from 'react';
import { Twemoji } from '../common/EmojiText';
import { aiApi } from '../../api';
import { toast } from '../common/Toast';

const STYLES = [
  { id: 'brief', label: 'Brief', icon: '📝' },
  { id: 'detailed', label: 'Detailed', icon: '📋' },
  { id: 'bullets', label: 'Bullets', icon: '📌' },
];

export default function SummaryPanel({ chatId, onClose }) {
  const [summary, setSummary] = useState('');
  const [style, setStyle] = useState('brief');
  const [loading, setLoading] = useState(false);

  const handleSummarize = async () => {
    setLoading(true);
    setSummary('');
    try {
      const result = await aiApi.summarize(chatId, style);
      setSummary(result.summary);
    } catch (err) {
      toast(err?.response?.data?.message || 'Failed to generate summary', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="summary-panel">
      <div className="summary-panel-header">
        <h3><Twemoji>📝</Twemoji> Chat Summary</h3>
        <button type="button" className="icon-btn" onClick={onClose}><Twemoji>✕</Twemoji></button>
      </div>

      <div className="summary-panel-body">
        <div className="summary-styles">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`style-btn ${style === s.id ? 'active' : ''}`}
              onClick={() => setStyle(s.id)}
            >
              <Twemoji>{s.icon}</Twemoji> {s.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn primary full-width"
          onClick={handleSummarize}
          disabled={loading}
        >
          {loading ? 'Generating...' : 'Generate Summary'}
        </button>

        {summary && (
          <div className="summary-result">
            <p>{summary}</p>
          </div>
        )}

        <p className="muted small" style={{ marginTop: 12 }}>
          AI summaries are generated from encrypted messages. Content is decrypted client-side before sending to the AI service.
        </p>
      </div>
    </div>
  );
}
