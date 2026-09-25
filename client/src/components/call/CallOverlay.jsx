import { useEffect, useRef, useState } from 'react';
import { useCall } from '../../context/CallContext';
import Avatar from '../common/Avatar';

function useCallTimer(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function CallWaveform({ active }) {
  if (!active) return null;
  return (
    <div className="call-waveform">
      {[...Array(5)].map((_, i) => (
        <span key={i} className="wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

export default function CallOverlay() {
  const {
    call,
    localStream,
    remoteStream,
    error,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  } = useCall();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const stageRef = useRef(null);
  const [pipPos, setPipPos] = useState(null); // {x, y} in px relative to stage, null = default corner
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const timer = useCallTimer(call?.state === 'active');

  // Draggable local PiP: pointer drag anywhere on the small video, clamped to stage.
  const onPipPointerDown = (e) => {
    if (!stageRef.current || !localVideoRef.current) return;
    e.preventDefault();
    const stage = stageRef.current.getBoundingClientRect();
    const el = localVideoRef.current.getBoundingClientRect();
    dragRef.current = {
      offsetX: e.clientX - el.left,
      offsetY: e.clientY - el.top,
      w: el.width,
      h: el.height,
      stage,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPipPointerMove = (e) => {
    if (!dragging || !dragRef.current) return;
    const { offsetX, offsetY, w, h, stage } = dragRef.current;
    let x = e.clientX - stage.left - offsetX;
    let y = e.clientY - stage.top - offsetY;
    x = Math.max(8, Math.min(x, stage.width - w - 8));
    y = Math.max(8, Math.min(y, stage.height - h - 8));
    setPipPos({ x, y });
  };
  const onPipPointerUp = () => {
    setDragging(false);
    dragRef.current = null;
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  if (!call) return null;

  const isVideo = call.mediaType === 'video';
  const isActive = call.state === 'active';
  const isRinging = call.state === 'outgoing';
  const isIncoming = call.state === 'incoming';
  const isConnecting = isActive && !remoteStream;

  return (
    <div className={`call-overlay ${isVideo ? 'video' : 'audio'}`}>
      <div className="call-bg-glow" />

      {isVideo ? (
        <div className="video-stage" ref={stageRef}>
          <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
          {!remoteStream && (
            <div className="video-placeholder">
              <div className={`avatar-ring ${isRinging || isIncoming ? 'pulse' : ''}`}>
                <Avatar id={call.peerId} name={call.peerName} size={96} />
              </div>
              <p className="call-peer-name">{call.peerName}</p>
              <p className="call-status-text">
                {isRinging ? 'Ringing\u2026' : isConnecting ? 'Connecting\u2026' : ''}
              </p>
              {(isRinging || isIncoming) && (
                <div className="ringing-dots">
                  <span /><span /><span />
                </div>
              )}
            </div>
          )}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`local-video${dragging ? ' dragging' : ''}`}
            style={pipPos ? { left: pipPos.x, top: pipPos.y, right: 'auto', bottom: 'auto' } : undefined}
            onPointerDown={onPipPointerDown}
            onPointerMove={onPipPointerMove}
            onPointerUp={onPipPointerUp}
            onPointerCancel={onPipPointerUp}
            onDoubleClick={() => setPipPos(null)}
            title="Drag to move • double-click to reset"
          />
          {isActive && (
            <div className="call-badge">
              <span className="badge-dot" /> Encrypted
            </div>
          )}
        </div>
      ) : (
        <div className="audio-stage">
          <div className={`avatar-ring ${isRinging || isIncoming ? 'pulse' : ''}`}>
            <Avatar id={call.peerId} name={call.peerName} size={120} />
          </div>
          <h3 className="call-peer-name">{call.peerName}</h3>
          <p className="call-status-text">
            {error
              || (isIncoming ? 'Incoming call' : isRinging ? 'Ringing\u2026' : isActive ? (timer || 'Connected') : 'Connecting\u2026')}
          </p>
          <CallWaveform active={isActive && !call.muted} />
          {(isRinging || isIncoming) && (
            <div className="ringing-dots">
              <span /><span /><span />
            </div>
          )}
          {isActive && (
            <div className="call-badge">
              <span className="badge-dot" /> End-to-end encrypted
            </div>
          )}
          <audio ref={remoteAudioRef} autoPlay />
        </div>
      )}

      {isVideo && isActive && (
        <div className="call-timer">{timer}</div>
      )}

      {isIncoming ? (
        <div className="call-controls incoming-controls">
          <div className="incoming-action">
            <button type="button" className="call-btn decline" onClick={declineCall} aria-label="Decline">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 004.73.89 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91" />
                <line x1="23" y1="1" x2="1" y2="23" />
              </svg>
            </button>
            <span className="action-label">Decline</span>
          </div>
          <div className="incoming-action">
            <button type="button" className="call-btn accept" onClick={acceptCall} aria-label="Accept">
              {isVideo ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                </svg>
              )}
            </button>
            <span className="action-label">Accept</span>
          </div>
        </div>
      ) : (
        <div className="call-controls active-controls">
          {isActive && (
            <>
              <div className="control-item">
                <button type="button" className={`call-btn ${call.muted ? 'active-danger' : ''}`} onClick={toggleMute} title="Mute">
                  {call.muted ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                      <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
                <span className="control-label">{call.muted ? 'Unmute' : 'Mute'}</span>
              </div>
              {isVideo && (
                <>
                  <div className="control-item">
                    <button type="button" className={`call-btn ${call.cameraOff ? 'active-danger' : ''}`} onClick={toggleCamera} title="Camera">
                      {call.cameraOff ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23" />
                          <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34m-7.72-2.06l4.92-4.92" />
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      )}
                    </button>
                    <span className="control-label">{call.cameraOff ? 'Show' : 'Hide'}</span>
                  </div>
                  <div className="control-item">
                    <button type="button" className={`call-btn ${call.sharing ? 'active-accent' : ''}`} onClick={toggleScreenShare} title="Share screen">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </button>
                    <span className="control-label">{call.sharing ? 'Stop' : 'Share'}</span>
                  </div>
                </>
              )}
            </>
          )}
          <div className="control-item">
            <button type="button" className="call-btn decline end-call-btn" onClick={endCall} title="End call" aria-label="End call">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 004.73.89 2 2 0 012 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91" />
                <line x1="23" y1="1" x2="1" y2="23" />
              </svg>
            </button>
            <span className="control-label">End</span>
          </div>
        </div>
      )}
      {error && <div className="call-error">{error}</div>}
    </div>
  );
}
