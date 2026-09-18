import { useEffect, useState } from 'react';
import VoiceTranscription from './VoiceTranscription';
import { filesApi } from '../../api';
import { importRawChatKey, decryptBufferWithKey, decryptWithKey } from '../../crypto/e2ee';
import { humanSize, duration as fmtDuration } from '../../utils/format';

const urlCache = new Map();

async function loadFileUrl(file) {
  const cacheKey = `${file.fileId}:${file.key}`;
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);

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

export default function FileAttachment({ file, mine }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    loadFileUrl(file)
      .then((r) => {
        if (alive) setState({ loading: false, ...r });
      })
      .catch((err) => {
        if (alive) setState({ loading: false, error: err.message || 'Failed to decrypt attachment' });
      });
    return () => {
      alive = false;
    };
  }, [file]);

  if (state.loading) return <div className="attachment loading">Decrypting…</div>;
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
          <VoiceTranscription audioBlob={state.blob} audioUrl={state.url} />
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
