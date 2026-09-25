import { useState } from 'react';
import Modal from '../common/Modal';
import { toast } from '../common/Toast';

export default function PollModal({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState(false);

  const setOption = (i, value) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };

  const addOption = () => {
    if (options.length >= 10) {
      toast('Maximum 10 options', 'error');
      return;
    }
    setOptions((prev) => [...prev, '']);
  };

  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async (e) => {
    e.preventDefault();
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    const unique = [...new Set(opts)];
    if (!q) {
      toast('Enter a question', 'error');
      return;
    }
    if (unique.length < 2) {
      toast('Add at least 2 options', 'error');
      return;
    }
    setBusy(true);
    try {
      await onCreate(q, unique);
      onClose();
    } catch (err) {
      toast(err.message || 'Failed to create poll', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="📊 Create poll" onClose={onClose}>
      <form onSubmit={submit} className="poll-form">
        <label className="field-label">Question</label>
        <input
          className="search-input"
          placeholder="e.g. Where should we meet?"
          value={question}
          maxLength={300}
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
        />
        <label className="field-label" style={{ marginTop: 12 }}>Options ({options.length}/10)</label>
        {options.map((opt, i) => (
          <div key={i} className="poll-opt-row">
            <input
              className="search-input"
              placeholder={`Option ${i + 1}`}
              value={opt}
              maxLength={120}
              onChange={(e) => setOption(i, e.target.value)}
            />
            {options.length > 2 && (
              <button type="button" className="icon-btn danger" title="Remove option" onClick={() => removeOption(i)}>
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button type="button" className="btn sm" onClick={addOption} style={{ marginTop: 8 }}>
            + Add option
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create poll'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
