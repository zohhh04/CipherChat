import { useEffect, useRef, useState } from 'react';
import { Twemoji } from '../common/EmojiText';
import { useChat } from '../../context/ChatContext';
import { toast } from '../common/Toast';

const EMOJIS = ['😀', '😂', '🥲', '😍', '👍', '🙏', '🔥', '🎉', '❤️', '😢', '😮', '🤔'];

export default function MessageInput({ chatId, editingMessage, onEditSubmit, onEditCancel, replyTo, onReplyCancel }) {
  const { sendText, sendFile, notifyTyping } = useChat();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);

  useEffect(() => {
    setText('');
    if (editingMessage) {
      setText(editingMessage.text || '');
    }
  }, [chatId, editingMessage]);

  const handleSendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (editingMessage) {
        await onEditSubmit(trimmed);
      } else {
        await sendText(chatId, trimmed, replyTo ? replyTo.id : undefined);
      }
      setText('');
      if (onReplyCancel) onReplyCancel();
      notifyTyping(chatId, false);
    } catch (e) {
      toast(e.message || 'Failed to send message', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleFilePick = (accept, kind) => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast('Max file size is 25 MB', 'error');
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      await sendFile(chatId, file, kind, undefined, (p) => setProgress(p));
      toast('Attachment sent', 'success');
    } catch (err) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const seconds = (Date.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 800) {
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
          setBusy(true);
          try {
            await sendFile(chatId, file, 'audio', Math.round(seconds));
          } catch (err) {
            toast(err.message || 'Voice note failed', 'error');
          } finally {
            setBusy(false);
          }
        }
      };
      recorder.start();
      startedAtRef.current = Date.now();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast('Microphone access denied', 'error');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <div className="message-input">
      {editingMessage && (
        <div className="edit-bar">
          <span className="edit-indicator"><Twemoji>✏️</Twemoji> Editing message</span>
          <button type="button" className="icon-btn" onClick={onEditCancel} title="Cancel editing"><Twemoji>✕</Twemoji></button>
        </div>
      )}
      {replyTo && !editingMessage && (
        <div className="reply-bar">
          <div className="reply-bar-content">
            <span className="reply-bar-author">Replying to {replyTo.sender}</span>
            <span className="reply-bar-text">{replyTo.text || (replyTo.file ? '[File]' : '...')}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onReplyCancel} title="Cancel reply"><Twemoji>✕</Twemoji></button>
        </div>
      )}
      {recording ? (
        <div className="record-bar">
          <span className="rec-dot" />
          <span>Recording… tap send to stop</span>
          <button type="button" className="send-btn" onClick={stopRecording} disabled={busy}>
            ➤
          </button>
        </div>
      ) : (
        <>
          {showEmoji && (
            <div className="emoji-pop">
              {EMOJIS.map((em) => (
                <button key={em} type="button" className="emoji-btn" onClick={() => setText((t) => t + em)}>
                  {em}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="icon-btn" title="Emoji" onClick={() => setShowEmoji((s) => !s)}>
            <Twemoji>😊</Twemoji>
          </button>
          <label className={`icon-btn attach-label ${busy ? 'disabled' : ''}`} title="Attach image/video">
            <Twemoji>🖼️</Twemoji>
            <input type="file" accept="image/*,video/*" hidden onChange={handleFilePick('image/*,video/*', 'file')} />
          </label>
          <label className={`icon-btn attach-label ${busy ? 'disabled' : ''}`} title="Attach document/PDF">
            <Twemoji>📎</Twemoji>
            <input type="file" hidden onChange={handleFilePick('*', 'file')} />
          </label>
          <textarea
            rows={1}
            placeholder={busy ? (progress != null ? `Encrypting & uploading… ${Math.round(progress * 100)}%` : 'Working…') : 'Type a message'}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              notifyTyping(chatId, true);
            }}
            onBlur={() => notifyTyping(chatId, false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
          />
          {text.trim() ? (
            <button type="button" className="send-btn" onClick={handleSendText} disabled={busy} aria-label="Send">
              <Twemoji>➤</Twemoji>
            </button>
          ) : (
            <button
              type="button"
              className="send-btn mic"
              onClick={startRecording}
              disabled={busy}
              aria-label="Record voice note"
            >
              <Twemoji>🎤</Twemoji>
            </button>
          )}
        </>
      )}
    </div>
  );
}
