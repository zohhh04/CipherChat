import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext';

/**
 * One-time photo viewer (images only).
 * - Blurred placeholder until opened.
 * - Full-screen overlay: no right-click / drag / download button.
 * - Deters screenshots: blocks PrintScreen & common shortcuts, hides image
 *   when window loses focus, revokes the decrypted blob URL on close.
 * - Honest limitation: no website can 100% block OS-level screenshots
 *   (phone screen capture, second camera). Server still deletes the bytes
 *   after first open so it can't be re-fetched.
 */
export default function ViewOnceImage({ chatId, message, imageUrl, fileName, mine }) {
  const { markViewOnce } = useChat();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [burned, setBurned] = useState(!!message.expired || !!message.viewedAt);
  const urlRef = useRef(imageUrl);
  urlRef.current = imageUrl;

  const burn = useCallback(() => {
    if (burned) return;
    setBurned(true);
    setOpen(false);
    // Tell server to wipe ciphertext + file bytes (idempotent).
    if (!mine) markViewOnce(chatId, message.id).catch(() => {});
    else markViewOnce(chatId, message.id).catch(() => {});
  }, [burned, mine, markViewOnce, chatId, message.id]);

  // Screenshot / copy deterrents while viewer is open.
  useEffect(() => {
    if (!open) return undefined;

    const block = (e) => e.preventDefault();
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      // PrintScreen, or Ctrl/Cmd+Shift+S / Ctrl+P / Ctrl+C / Ctrl+S while viewing
      if (
        e.key === 'PrintScreen' ||
        ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c'].includes(k)) ||
        (e.ctrlKey && e.shiftKey && k === 's')
      ) {
        e.preventDefault();
        setHidden(true);
        setTimeout(() => setHidden(false), 1200);
      }
    };
    const onBlur = () => setHidden(true);
    const onFocus = () => setHidden(false);
    const onVis = () => setHidden(document.hidden);

    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [open]);

  // When viewer closes (or unmounts after burn), revoke blob URL so the
  // decrypted bytes can't be reopened from memory.
  useEffect(() => () => {
    if (burned && urlRef.current && urlRef.current.startsWith('blob:')) {
      try { URL.revokeObjectURL(urlRef.current); } catch { /* noop */ }
    }
  }, [burned]);

  if (burned || message.expired || message.viewedAt) {
    return (
      <div className="viewonce-expired">
        <span className="viewonce-icon">👁️‍🗨️</span>
        <span>{mine ? 'View-once photo opened' : 'Photo already viewed — deleted'}</span>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="viewonce-thumb" onClick={() => setOpen(true)}>
        <span className="viewonce-thumb-icon">👁️</span>
        <span className="viewonce-thumb-text">
          {mine ? 'View-once photo (preview)' : 'View once — tap to open'}
        </span>
        <span className="viewonce-thumb-sub">Opens 1 time · screenshots deterred</span>
      </button>

      {open && (
        <div className="viewonce-overlay" onContextMenu={(e) => e.preventDefault()} onClick={burn}>
          <div
            className="viewonce-frame"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="viewonce-topbar">
              <span>👁️ View once — closes on tap outside</span>
              <button type="button" className="icon-btn" onClick={burn} title="Close and delete">✕</button>
            </div>
            {hidden ? (
              <div className="viewonce-hidden">Photo hidden while window unfocused (screenshot protection)</div>
            ) : (
              <img
                className="viewonce-img"
                src={imageUrl}
                alt={fileName || 'view-once photo'}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
              />
            )}
            <div className="viewonce-warn">
              Screenshot / recording is blocked best-effort. The photo deletes after this view.
            </div>
            <button type="button" className="btn primary" onClick={burn}>
              Close — delete photo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
