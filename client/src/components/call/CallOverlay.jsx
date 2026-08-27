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
  const timer = useCallTimer(call?.state === 'active');

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

  return (
    <div className={`call-overlay ${isVideo ? 'video' : 'audio'}`}>
      {isVideo ? (
        <div className="video-stage">
          <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
          {!remoteStream && (
            <div className="video-placeholder">
              <Avatar id={call.peerId} name={call.peerName} size={96} />
              <p>{call.state === 'outgoing' ? 'Ringing…' : 'Connecting…'}</p>
            </div>
          )}
          <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
        </div>
      ) : (
        <div className="audio-stage">
          <Avatar id={call.peerId} name={call.peerName} size={110} />
          <h3>{call.peerName}</h3>
          <p>
            {error
              || (call.state === 'incoming' ? 'Incoming call' : call.state === 'outgoing' ? 'Ringing…' : timer || 'Connected')}
          </p>
          <audio ref={remoteAudioRef} autoPlay />
        </div>
      )}

      {isVideo && isActive && (
        <div className="call-timer">{timer}</div>
      )}

      {call.state === 'incoming' ? (
        <div className="call-controls">
          <button type="button" className="call-btn decline" onClick={declineCall} aria-label="Decline">
            ✕
          </button>
          <button type="button" className="call-btn accept" onClick={acceptCall} aria-label="Accept">
            {isVideo ? '🎥' : '📞'}
          </button>
        </div>
      ) : (
        <div className="call-controls">
          {isActive && (
            <>
              <button type="button" className={`call-btn ${call.muted ? 'active-danger' : ''}`} onClick={toggleMute} title="Mute">
                {call.muted ? '🔇' : '🎙️'}
              </button>
              {isVideo && (
                <>
                  <button type="button" className={`call-btn ${call.cameraOff ? 'active-danger' : ''}`} onClick={toggleCamera} title="Camera">
                    {call.cameraOff ? '🚫' : '📷'}
                  </button>
                  <button
                    type="button"
                    className={`call-btn ${call.sharing ? 'active-accent' : ''}`}
                    onClick={toggleScreenShare}
                    title="Share screen"
                  >
                    🖥️
                  </button>
                </>
              )}
            </>
          )}
          <button type="button" className="call-btn decline" onClick={endCall} title="End call" aria-label="End call">
            ⏻
          </button>
        </div>
      )}
      {error && <div className="call-error">{error}</div>}
    </div>
  );
}
