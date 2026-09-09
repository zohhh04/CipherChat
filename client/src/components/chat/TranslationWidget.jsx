import { useState } from 'react';
import { Twemoji } from '../common/EmojiText';
import { aiApi } from '../../api';
import { toast } from '../common/Toast';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'uk', label: 'Ukrainian' },
];

export default function TranslationWidget({ text, onTranslated }) {
  const [targetLang, setTargetLang] = useState('es');
  const [translated, setTranslated] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleTranslate = async () => {
    if (!text?.trim()) return;
    setLoading(true);
    setTranslated('');
    try {
      const result = await aiApi.translate(text, targetLang);
      setTranslated(result.translated);
      if (onTranslated) onTranslated(result.translated);
    } catch (err) {
      toast(err?.response?.data?.message || 'Translation failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="translation-widget">
      <div className="translation-controls">
        <div className="lang-select-wrap">
          <button
            type="button"
            className="lang-select-btn"
            onClick={() => setShowPicker(!showPicker)}
          >
            <Twemoji>🌐</Twemoji> {LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang}
          </button>
          {showPicker && (
            <div className="lang-picker">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  className={`lang-option ${targetLang === lang.code ? 'active' : ''}`}
                  onClick={() => { setTargetLang(lang.code); setShowPicker(false); }}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn sm primary"
          onClick={handleTranslate}
          disabled={loading || !text?.trim()}
        >
          {loading ? 'Translating...' : 'Translate'}
        </button>
      </div>
      {translated && (
        <div className="translation-result">
          <p>{translated}</p>
        </div>
      )}
    </div>
  );
}
