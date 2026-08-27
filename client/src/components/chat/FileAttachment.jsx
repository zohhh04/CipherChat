import { useEffect, useState } from 'react';
import { filesApi } from '../../api';
import { importRawChatKey, decryptBufferWithKey, decryptWithKey } from '../../crypto/e2ee';
import { humanSize, duration as fmtDuration } from '../../utils/format';

const urlCache = new Map();

async function loadFileUrl(file) {
  const cacheKey = `${file.fileId}:${file.key}`;
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);

  const key = await importRawChatKey(file.key);
  const [buffer, meta] = await Promise.all([
    filesApi.download(file.fileId),
    filesApi.meta(file.fileId),
  ]);

  const plain = await decryptBufferWithKey(key, file.iv, buffer);
  const name = await decryptWithKey(key, { iv: meta.nameIv, ciphertext: meta.nameCt });

  const blob = new Blob([plain], { type: file.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  urlCache.set(cacheKey, { url, name });
  return { url, name };
}

export default function FileAttachment({ file, mine }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    loadFileUrl(file)
      .then((r) => {
        if (alive) setState({ loading: false, ...r });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: 'Failed to decrypt attachment' });
      });
    return () => {
      alive = false;
    };
  }, [file]);

  if (state.loading) return <div className="attachment loading">Decrypting…</div>;
  if (state.error) return <div className="attachment error">{state.error}</div>;

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
