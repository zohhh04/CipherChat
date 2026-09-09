import { useState } from 'react';
import { Twemoji } from '../common/EmojiText';
import { aiApi } from '../../api';
import { toast } from '../common/Toast';

export default function VoiceTranscription({ audioBlob, audioUrl }) {
  const [transcript, setTranscript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTranscribe = async () => {
    setLoading(true);
    setError('');
    setTranscript('');

    try {
      let blob = audioBlob;

      if (!blob && audioUrl) {
        const response = await fetch(audioUrl);
        blob = await response.blob();
      }

      if (!blob) {
        throw new Error('No audio available for transcription');
      }

      const result = await aiApi.transcribe(blob);
      setTranscript(result.transcript);
    } catch (err) {
      const message = err?.response?.data?.message || err.message || 'Transcription failed';
      setError(message);
      toast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (transcript) {
    return (
      <div className="voice-transcript">
        <div className="transcript-header">
          <Twemoji>📝</Twemoji>
          <span>Transcription</span>
        </div>
        <p className="transcript-text">{transcript}</p>
      </div>
    );
  }

  return (
    <div className="voice-transcribe-btn">
      <button
        type="button"
        className="btn sm"
        onClick={handleTranscribe}
        disabled={loading}
      >
        {loading ? (
          <>
            <Twemoji>⏳</Twemoji> Transcribing...
          </>
        ) : (
          <>
            <Twemoji>🎤</Twemoji> Transcribe
          </>
        )}
      </button>
      {error && <span className="transcribe-error">{error}</span>}
    </div>
  );
}
