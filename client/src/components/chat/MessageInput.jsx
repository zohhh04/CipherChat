import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Twemoji } from '../common/EmojiText';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { getSecureKey, setSecureKey } from '../../crypto/securePass';
import { toast } from '../common/Toast';

const EMOJIS = ['😀', '😂', '🥲', '😍', '👍', '🙏', '🔥', '🎉', '❤️', '😢', '😮', '🤔'];

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export default function MessageInput({ chatId, editingMessage, onEditSubmit, onEditCancel, replyTo, onReplyCancel, chatMode = 'normal' }) {
  const { sendText, sendFile, notifyTyping } = useChat();
  const { user } = useAuth();
  const secure = chatMode === 'encrypted';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [progress, setProgress] = useState(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [keyNeeded, setKeyNeeded] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const hasSecureKey = Boolean(user && getSecureKey(user.id));
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    setText('');
    if (editingMessage) {
      setText(editingMessage.text || '');
    }
  }, [chatId, editingMessage]);

  useEffect(() => {
    setKeyNeeded(false);
    setKeyDraft('');
  }, [chatId, chatMode]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  const handleSendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (editingMessage) {
        await onEditSubmit(trimmed);
      } else {
        await sendText(chatId, trimmed, replyTo ? replyTo.id : undefined, { mode: chatMode });
      }
      setText('');
      if (onReplyCancel) onReplyCancel();
      notifyTyping(chatId, false);
    } catch (e) {
      const msg = e.message || 'Failed to send message';
      if (/secure chat key/i.test(msg)) setKeyNeeded(true);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveSecureKey = () => {
    const v = keyDraft.trim();
    if (!v) {
      toast('Enter a key first', 'error');
      return;
    }
    if (!user) return;
    setSecureKey(user.id, v);
    setKeyDraft('');
    setKeyNeeded(false);
    toast('🔐 Secure Chat Key saved — now send again. Share this exact key with your receiver so they can decrypt.', 'success');
  };

  const handleFilePick = (accept, kind) => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast('Max file size is 25 MB', 'error');
      return;
    }
    const wantsViewOnce = viewOnce && (file.type || '').startsWith('image/');
    if (viewOnce && !wantsViewOnce) {
      toast('One-time view works for photos only', 'error');
      return;
    }
    // View-once photos are always sent as type 'image' so the server enforces image-only.
    const sendKind = wantsViewOnce ? 'image' : kind;
    setBusy(true);
    setProgress(0);
    try {
      await sendFile(chatId, file, sendKind, undefined, (p) => setProgress(p), { ...(wantsViewOnce ? { viewOnce: true } : {}), mode: chatMode });
      toast(wantsViewOnce ? 'View-once photo sent 👁️' : 'Attachment sent', 'success');
      setViewOnce(false);
    } catch (err) {
      if (/secure chat key/i.test(err.message || '')) setKeyNeeded(true);
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const startRecording = async () => {
    if (typeof MediaRecorder === 'undefined') {
      toast('Voice recording is not supported in this browser', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onerror = () => {
        toast('Recording error occurred', 'error');
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });

        if (blob.size < 500) {
          toast('Recording too short', 'error');
          setRecording(false);
          return;
        }

        const ext = (mimeType || 'audio/webm').split('/')[1].split(';')[0];
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType || 'audio/webm' });
        setRecording(false);
        setBusy(true);
        try {
          await sendFile(chatId, file, 'audio', seconds, undefined, { mode: chatMode });
          toast('Voice note sent', 'success');
        } catch (err) {
          if (/secure chat key/i.test(err.message || '')) setKeyNeeded(true);
          toast(err.message || 'Failed to send voice note', 'error');
        } finally {
          setBusy(false);
        }
      };

      recorder.start(1000);
      startedAtRef.current = Date.now();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        toast('Microphone permission denied. Please allow microphone access.', 'error');
      } else if (err.name === 'NotFoundError') {
        toast('No microphone found on this device', 'error');
      } else {
        toast('Could not start recording: ' + (err.message || 'Unknown error'), 'error');
      }
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    recorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    chunksRef.current = [];
    setRecording(false);
    setRecordingTime(0);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="message-input-wrap">
      <div className={`mode-hint ${secure ? 'secure' : 'normal'}`}>
        {secure ? '🔐 Secure Chat — End-to-End Encrypted' : '🟢 Normal Chat'}
      </div>
      {secure && (keyNeeded || !hasSecureKey) && (
        <div className="secure-key-prompt">
          <span className="secure-key-text">
            <Twemoji>🔑</Twemoji> {keyNeeded
              ? 'Secure send blocked: no Secure Chat Key on this device yet.'
              : 'No Secure Chat Key set on this device yet.'}{' '}
            Set one here (or in <Link to="/settings">Settings</Link>) and share the <strong>exact same key</strong> with your receiver — they type it on the locked message to read it.
          </span>
          <div className="secure-key-row">
            <input
              className="search-input"
              type="password"
              placeholder="e.g. mango-sunset-42"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveSecureKey(); } }}
              autoComplete="off"
            />
            <button type="button" className="btn primary sm" onClick={saveSecureKey} disabled={!keyDraft.trim()}>
              Save key
            </button>
            {keyNeeded && (
              <button type="button" className="icon-btn" title="Dismiss" onClick={() => setKeyNeeded(false)}>
                <Twemoji>✕</Twemoji>
              </button>
            )}
          </div>
        </div>
      )}
      {viewOnce && (
        <div className="viewonce-bar">
          <span>👁️ View-once ON — next <strong>photo</strong> opens 1 time, then deletes. Screenshots are blocked best-effort.</span>
          <button type="button" className="icon-btn" title="Turn off view-once" onClick={() => setViewOnce(false)}>✕</button>
        </div>
      )}
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
          <span className="rec-time">{formatTime(recordingTime)}</span>
          <span className="rec-label">Recording…</span>
          <button type="button" className="icon-btn rec-cancel" onClick={cancelRecording} title="Cancel recording">
            <Twemoji>✕</Twemoji>
          </button>
          <button type="button" className="send-btn" onClick={stopRecording} disabled={busy} title="Send voice note">
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
          <button
            type="button"
            className={`icon-btn ${viewOnce ? 'viewonce-active' : ''}`}
            title={viewOnce ? 'View-once ON: next photo opens 1 time, screenshot deterred' : 'View-once OFF: tap to send next photo as one-time view (photos only)'}
            onClick={() => setViewOnce((v) => !v)}
            disabled={busy}
          >
            <Twemoji>{viewOnce ? '👁️‍🗨️' : '👁️'}</Twemoji>
          </button>
          <label className={`icon-btn attach-label ${busy ? 'disabled' : ''}`} title={viewOnce ? 'Attach photo as one-time view' : 'Attach image/video'}>
            <Twemoji>🖼️</Twemoji>
            <input type="file" accept="image/*,video/*" hidden onChange={handleFilePick('image/*,video/*', 'file')} />
          </label>
          <label className={`icon-btn attach-label ${busy ? 'disabled' : ''}`} title="Attach document/PDF">
            <Twemoji>📎</Twemoji>
            <input type="file" hidden onChange={handleFilePick('*', 'file')} />
          </label>
          <textarea
            rows={1}
            placeholder={busy ? (progress != null ? `${secure ? 'Encrypting & ' : ''}uploading… ${Math.round(progress * 100)}%` : 'Working…') : (secure ? 'Type a secure message' : 'Type a message')}
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
    </div>
  );
}
