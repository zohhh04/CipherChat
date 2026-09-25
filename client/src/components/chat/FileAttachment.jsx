import { useEffect, useState } from 'react';
import ViewOnceImage from './ViewOnceImage';
import PasswordInput from '../common/PasswordInput';
import { filesApi } from '../../api';
import { useChat } from '../../context/ChatContext';
import { importRawChatKey, decryptBufferWithKey, decryptWithKey } from '../../crypto/e2ee';
import { humanSize, duration as fmtDuration } from '../../utils/format';

const urlCache = new Map();

async function loadFileUrl(file) {
  const cacheKey = `${file.fileId}:${file.key || 'plain'}`;
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);

  // 🟢 Normal mode: raw bytes on server, plaintext name already in message.
  if (file.plain) {
    let buffer;
    try {
      buffer = await filesApi.download(file.fileId);
    } catch (e) {
      throw new Error('Failed to download file from server');
    }
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Downloaded file is empty');
    }
    const blob = new Blob([buffer], { type: file.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    urlCache.set(cacheKey, { url, name: file.name || 'attachment', blob });
    return { url, name: file.name || 'attachment', blob };
  }

  if (!file.key || !file.iv) {
    throw new Error('File decryption key is missing from message');
  }

  let key;
  try {
    key = await importRawChatKey(file.key);
  } catch (e) {
    throw new Error('Invalid file encryption key');
  }

  let buffer, meta;
  try {
    [buffer, meta] = await Promise.all([
      filesApi.download(file.fileId),
      filesApi.meta(file.fileId),
    ]);
  } catch (e) {
    throw new Error('Failed to download file from server');
  }

  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Downloaded file is empty');
  }

  let plain;
  try {
    plain = await decryptBufferWithKey(key, file.iv, buffer);
  } catch (e) {
    throw new Error('Decryption failed — file key does not match');
  }

  let name;
  try {
    name = await decryptWithKey(key, { iv: meta.nameIv, ciphertext: meta.nameCt });
  } catch {
    name = file.name || 'attachment';
  }

  const blob = new Blob([plain], { type: file.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  urlCache.set(cacheKey, { url, name, blob });
  return { url, name, blob };
}

export default function FileAttachment({ file, mine, message, chatId }) {
  const [state, setState] = useState({ loading: true });
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState('');
  const isViewOnce = !!(file && file.viewOnce) || !!(message && message.viewOnce);
  const isExpired = !!(message && (message.expired || message.viewedAt));
  const { decryptSecureFile } = useChat();

  const loadSecure = async (password) => {
    const cacheKey = `${file.fileId}:secure`;
    if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);
    const { plain, name } = await decryptSecureFile(chatId, file, password);
    const blob = new Blob([plain], { type: file.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const out = { url, name, blob };
    urlCache.set(cacheKey, out);
    return out;
  };

  useEffect(() => {
    // View-once photos decrypt lazily on tap — don't pre-fetch here.
    if (isViewOnce) {
      setState({ loading: false, viewOncePending: true });
      return undefined;
    }
    let alive = true;
    (async () => {
      try {
        // 🔐 Shared-key file: decrypt with the sender's Settings key
        // (cached from the then-and-there message unlock).
        if (file && file.securePass) {
          if (!decryptSecureFile) throw new Error('Enter the key to decrypt this file');
          const r = await loadSecure('');
          if (alive) setState({ loading: false, ...r });
          return;
        }
        const r = await loadFileUrl(file);
        if (alive) setState({ loading: false, ...r });
      } catch (err) {
        if (!alive) return;
        const msg = err.message || 'Failed to decrypt attachment';
        if (file && file.securePass && /key/i.test(msg)) {
          setState({ loading: false, needKey: true });
        } else {
          setState({ loading: false, error: msg });
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, isViewOnce, chatId]);

  const submitKey = async (e) => {
    if (e) e.preventDefault();
    if (!keyInput.trim() || keyBusy) return;
    setKeyBusy(true);
    setKeyError('');
    try {
      const r = await loadSecure(keyInput.trim());
      setState({ loading: false, ...r, needKey: false });
      setKeyInput('');
    } catch (err) {
      setKeyError(err.message || 'Wrong key — could not decrypt');
    } finally {
      setKeyBusy(false);
    }
  };

  if (isViewOnce) {
    return <ViewOnceLazy file={file} mine={mine} message={message} chatId={chatId} expired={isExpired} />;
  }

  if (state.loading) return <div className="attachment loading">Decrypting…</div>;
  if (state.needKey) {
    return (
      <div className="attachment error">
        <span className="attach-error-icon">🔐</span>
        <span className="attach-error-text">Encrypted file — enter the sender&apos;s key to view</span>
        <form onSubmit={submitKey} style={{ display: 'flex', gap: 6, marginTop: 8, width: '100%' }}>
          <PasswordInput
            placeholder="Enter sender's key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            wrapperStyle={{ flex: 1 }}
          />
          <button type="submit" className="btn primary sm" disabled={keyBusy || !keyInput.trim()}>
            {keyBusy ? '…' : 'View'}
          </button>
        </form>
        {keyError && <span className="attach-error-text">{keyError}</span>}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="attachment error">
        <span className="attach-error-icon">🔒</span>
        <span className="attach-error-text">{state.error}</span>
      </div>
    );
  }

  const mime = file.mime || '';
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const isPdf = mime.includes('pdf');

  return (
    <div className="attachment">
      {isImage && (
        <a href={state.url} target="_blank" rel="noreferrer">
          <img className="attach-img" src={state.url} alt={state.name || 'image'} />
        </a>
      )}
      {isVideo && <video className="attach-video" src={state.url} controls />}
      {isAudio && (
        <div className="voice-note" data-mine={mine || undefined}>
          <audio controls src={state.url} preload="metadata" />
          <span className="voice-dur">{fmtDuration(file.duration)}</span>
        </div>
      )}
      {!isImage && !isVideo && !isAudio && (
        <a className="attach-doc" href={state.url} download={state.name || 'file'} target="_blank" rel="noreferrer">
          <span className="doc-icon">{isPdf ? '📄' : '📎'}</span>
          <span className="doc-meta">
            <strong>{state.name || 'file'}</strong>
            <small>{humanSize(file.size)}</small>
          </span>
        </a>
      )}
      {(isImage || isVideo) && <small className="attach-name">{state.name}</small>}
    </div>
  );
}

function ViewOnceLazy({ file, mine, message, chatId, expired }) {
  const { markViewOnce, decryptSecureFile } = useChat();
  const [st, setSt] = useState({ idle: true });
  const [voKey, setVoKey] = useState('');
  const [voKeyBusy, setVoKeyBusy] = useState(false);
  const [voKeyError, setVoKeyError] = useState('');
  const msgId = message ? message.id : null;

  // If server already says expired (history reload), never fetch bytes.
  if (expired || (message && (message.expired || message.viewedAt))) {
    return (
      <div className="viewonce-expired">
        <span className="viewonce-icon">👁️‍🗨️</span>
        <span>{mine ? 'View-once photo opened' : 'Photo already viewed — deleted'}</span>
      </div>
    );
  }

  if (!file || !file.fileId) {
    return <div className="attachment loading">Encrypting…</div>;
  }

  const open = async (password) => {
    setSt({ loading: true });
    try {
      let r;
      if (file && file.securePass) {
        const cacheKey = `${file.fileId}:secure`;
        if (urlCache.has(cacheKey)) {
          r = urlCache.get(cacheKey);
        } else {
          const { plain, name } = await decryptSecureFile(chatId, file, password || '');
          const blob = new Blob([plain], { type: file.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          r = { url, name, blob };
          urlCache.set(cacheKey, r);
        }
      } else {
        r = await loadFileUrl(file);
      }
      setSt({ loading: false, ...r });
    } catch (err) {
      const msg = err.message || '';
      // Server wiped after first view → show expired instead of error.
      if (/already viewed|expired|gone|missing/i.test(msg)) {
        if (msgId && chatId) markViewOnce(chatId, msgId).catch(() => {});
        setSt({ loading: false, expired: true });
      } else if (file && file.securePass && /key/i.test(msg)) {
        setSt({ loading: false, needKey: true });
      } else {
        setSt({ loading: false, error: msg || 'Failed to decrypt photo' });
      }
    }
  };

  const submitVoKey = async (e) => {
    if (e) e.preventDefault();
    if (!voKey.trim() || voKeyBusy) return;
    setVoKeyBusy(true);
    setVoKeyError('');
    try {
      const cacheKey = `${file.fileId}:secure`;
      const { plain, name } = await decryptSecureFile(chatId, file, voKey.trim());
      const blob = new Blob([plain], { type: file.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const r = { url, name, blob };
      urlCache.set(cacheKey, r);
      setSt({ loading: false, ...r });
      setVoKey('');
    } catch (err) {
      setVoKeyError(err.message || 'Wrong key — could not decrypt');
    } finally {
      setVoKeyBusy(false);
    }
  };

  if (st.expired) {
    return (
      <div className="viewonce-expired">
        <span className="viewonce-icon">👁️‍🗨️</span>
        <span>Photo already viewed — deleted</span>
      </div>
    );
  }
  if (st.error) {
    return (
      <div className="attachment error">
        <span className="attach-error-icon">🔒</span>
        <span className="attach-error-text">{st.error}</span>
      </div>
    );
  }
  if (st.loading) return <div className="attachment loading">Decrypting one-time photo…</div>;
  if (st.url) {
    return <ViewOnceImage chatId={chatId} message={message} imageUrl={st.url} fileName={st.name} mine={mine} />;
  }
  if (st.needKey) {
    return (
      <div className="attachment error">
        <span className="attach-error-icon">🔐</span>
        <span className="attach-error-text">Encrypted one-time photo — enter the sender&apos;s key</span>
        <form onSubmit={submitVoKey} style={{ display: 'flex', gap: 6, marginTop: 8, width: '100%' }}>
          <PasswordInput
            placeholder="Enter sender's key"
            value={voKey}
            onChange={(e) => setVoKey(e.target.value)}
            wrapperStyle={{ flex: 1 }}
          />
          <button type="submit" className="btn primary sm" disabled={voKeyBusy || !voKey.trim()}>
            {voKeyBusy ? '…' : 'Open'}
          </button>
        </form>
        {voKeyError && <span className="attach-error-text">{voKeyError}</span>}
      </div>
    );
  }
  return (
    <button type="button" className="viewonce-thumb" onClick={() => open('')} title="Open one-time photo">
      <span className="viewonce-thumb-icon">👁️</span>
      <span className="viewonce-thumb-text">{mine ? 'View-once photo (tap to preview)' : 'View once — tap to open'}</span>
      <span className="viewonce-thumb-sub">Opens 1 time · screenshots deterred</span>
    </button>
  );
}
