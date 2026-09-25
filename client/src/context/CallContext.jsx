import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext';
import { chatsApi, messagesApi } from '../api';

// Missed-call history: write "Missed voice/video call at …" into the 1:1
// direct chat with the peer so it shows inside the conversation like WhatsApp.
// Exactly one side logs per scenario (see declineCall/endCall/timeouts below)
// so online peers don't get duplicates via realtime broadcast.
async function logMissedCallToDirectChat(peerId, mediaType) {
  try {
    const pid = String(peerId);
    const { chats } = await chatsApi.list();
    let chat = (chats || []).find(
      (c) => c.type === 'direct' && (c.members || []).some((m) => String(m.id) === pid)
    );
    let chatId = chat ? String(chat.id) : null;
    if (!chatId) {
      const created = await chatsApi.createDirect(pid, {});
      chatId = String(created.chatId);
    }
    if (chatId) {
      await messagesApi.logMissedCall(chatId, mediaType === 'video' ? 'video' : 'audio');
    }
  } catch {
    // best-effort: call UX must never break because history logging failed
  }
}

const CallContext = createContext(null);

function createRingtone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(ctx.destination);

  function playTone(freq, startTime, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
    gain.gain.setValueAtTime(0.25, startTime + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  function ring() {
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.8;
      playTone(440, now + offset, 0.35);
      playTone(480, now + offset, 0.35);
    }
  }

  let interval = null;

  return {
    start() {
      if (interval) return;
      ring();
      interval = setInterval(ring, 2400);
    },
    stop() {
      if (interval) { clearInterval(interval); interval = null; }
      try { ctx.close(); } catch {}
    },
  };
}

function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

export function CallProvider({ children }) {
  const { subscribe, emit } = useSocket();

  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState('');

  const pcRef = useRef(null);
  const localRef = useRef(null);
  const peerRef = useRef(null);
  const bufferedIceRef = useRef([]);
  const ringtoneRef = useRef(null);
  const ringTimeoutRef = useRef(null);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    if (localRef.current) {
      localRef.current.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    peerRef.current = null;
    bufferedIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    setError('');
  }, []);

  const getMedia = useCallback(async (mediaType) => {
    const constraints = {
      audio: true,
      video: mediaType === 'video'
        ? {
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 },
            frameRate: { min: 15, ideal: 30, max: 60 },
          }
        : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  function attachLocalTracks(pc) {
    localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current));
  }

  function drainIce(pc) {
    bufferedIceRef.current.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    bufferedIceRef.current = [];
  }

  function buildPeerConnection(peerId) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });

    pc.onicecandidate = (e) => {
      if (e.candidate && peerRef.current) emit('webrtc:ice', { to: peerRef.current, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) cleanup();
    };

    pcRef.current = pc;
    void peerId;
    return pc;
  }

  function setVideoBitrate(pc, bitrate) {
    const transceivers = pc.getTransceivers();
    for (const t of transceivers) {
      if (t.sender && t.sender.track && t.sender.track.kind === 'video') {
        const params = t.sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = bitrate;
        params.encodings[0].maxFramerate = 30;
        t.sender.setParameters(params).catch(() => {});
      }
    }
  }

  const startCall = useCallback(
    async (peerId, peerName, mediaType) => {
      setError('');
      peerRef.current = String(peerId);
      setCall({ state: 'outgoing', peerId: String(peerId), peerName, mediaType, muted: false, cameraOff: false, sharing: false });
      try {
        await getMedia(mediaType);
        emit('webrtc:call', { to: String(peerId), mediaType });
        // Outgoing unanswered for 45s → treat as missed, hang up + log history.
        clearRingTimeout();
        ringTimeoutRef.current = setTimeout(() => {
          const pid = peerRef.current;
          const mt = mediaType;
          if (pid) emit('webrtc:end', { to: pid });
          if (pid) void logMissedCallToDirectChat(pid, mt);
          cleanup();
          setError('No answer — logged as missed call');
        }, 45000);
      } catch {
        cleanup();
        setError('Camera/microphone permission denied');
        throw new Error('permission');
      }
    },
    [emit, getMedia, cleanup, clearRingTimeout]
  );

  const acceptCall = useCallback(async () => {
    if (!call) return;
    if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
    clearRingTimeout();
    setCall((c) => (c ? { ...c, state: 'active' } : c));
    try {
      await getMedia(call.mediaType);
      emit('webrtc:answer', { to: call.peerId, accept: true });
    } catch {
      emit('webrtc:answer', { to: call.peerId, accept: false });
      cleanup();
      setError('Camera/microphone permission denied');
    }
  }, [call, emit, getMedia, cleanup, clearRingTimeout]);

  const declineCall = useCallback(() => {
    if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
    clearRingTimeout();
    const pid = call ? call.peerId : peerRef.current;
    const mt = call ? call.mediaType : 'audio';
    if (call) emit('webrtc:answer', { to: call.peerId, accept: false });
    // Callee declined → callee logs the missed-call history entry.
    if (pid) void logMissedCallToDirectChat(pid, mt);
    cleanup();
  }, [call, emit, cleanup, clearRingTimeout]);

  const endCall = useCallback(() => {
    clearRingTimeout();
    // Caller cancelling an outgoing (never-connected) call logs the missed entry.
    // Callee ending an active call, or either side ending an active call, logs nothing.
    if (call && call.state === 'outgoing' && peerRef.current) {
      const pid = peerRef.current;
      const mt = call.mediaType;
      emit('webrtc:end', { to: pid });
      void logMissedCallToDirectChat(pid, mt);
    } else if (peerRef.current) {
      emit('webrtc:end', { to: peerRef.current });
    }
    cleanup();
  }, [emit, cleanup, call, clearRingTimeout]);

  useEffect(() => {
    const offs = [];

    offs.push(
      subscribe('call:incoming', ({ from, fromName, mediaType }) => {
        peerRef.current = String(from);
        setCall({ state: 'incoming', peerId: String(from), peerName: fromName, mediaType, muted: false, cameraOff: false, sharing: false });
        if (!ringtoneRef.current) { ringtoneRef.current = createRingtone(); ringtoneRef.current.start(); }
        // Incoming ringing 60s with no answer (caller vanished) → callee logs missed.
        clearRingTimeout();
        ringTimeoutRef.current = setTimeout(() => {
          void logMissedCallToDirectChat(String(from), mediaType);
          if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
          cleanup();
          setError('Missed call — logged in chat');
        }, 60000);
      })
    );

    offs.push(
      subscribe('call:busy', () => {
        if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
        clearRingTimeout();
        setError('User is busy');
        setTimeout(cleanup, 1200);
      })
    );

    offs.push(
      subscribe('call:answered', async ({ from, accept }) => {
        if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
        if (!accept) {
          clearRingTimeout();
          // Callee declined and already logged history; caller just shows status.
          setError('Call declined');
          setTimeout(cleanup, 1000);
          return;
        }
        clearRingTimeout();
        setCall((c) => (c ? { ...c, state: 'active' } : c));
        const pc = buildPeerConnection(String(from));
        attachLocalTracks(pc);
        if (call?.mediaType === 'video') setVideoBitrate(pc, 2500000);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emit('webrtc:offer', { to: String(from), sdp: pc.localDescription.sdp });
      })
    );

    offs.push(
      subscribe('call:offer', async ({ from, sdp }) => {
        const pc = buildPeerConnection(String(from));
        attachLocalTracks(pc);
        if (call?.mediaType === 'video') setVideoBitrate(pc, 2500000);
        await pc.setRemoteDescription({ type: 'offer', sdp });
        drainIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        emit('webrtc:answer-sdp', { to: String(from), sdp: pc.localDescription.sdp });
      })
    );

    offs.push(
      subscribe('call:answer-sdp', async ({ sdp }) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription({ type: 'answer', sdp });
        drainIce(pc);
      })
    );

    offs.push(
      subscribe('call:ice', ({ candidate }) => {
        if (!candidate) return;
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) pc.addIceCandidate(candidate).catch(() => {});
        else bufferedIceRef.current.push(candidate);
      })
    );

    offs.push(subscribe('call:ended', () => {
      if (ringtoneRef.current) { ringtoneRef.current.stop(); ringtoneRef.current = null; }
      clearRingTimeout();
      cleanup();
    }));

    return () => offs.forEach((off) => off());
  }, [subscribe, emit, cleanup, clearRingTimeout]);

  const toggleMute = useCallback(() => {
    setCall((c) => {
      if (!c) return c;
      const next = !c.muted;
      localRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return { ...c, muted: next };
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCall((c) => {
      if (!c || c.mediaType !== 'video') return c;
      const next = !c.cameraOff;
      localRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = !next;
      });
      return { ...c, cameraOff: next };
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const current = call;
    if (!pc || !current || current.mediaType !== 'video') return;

    try {
      if (current.sharing) {
        const camTrack = localRef.current?.getVideoTracks()[0];
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && camTrack) await sender.replaceTrack(camTrack);
        setCall((c) => ({ ...c, sharing: false }));
      } else {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = display.getVideoTracks()[0];
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(screenTrack);
        screenTrack.onended = async () => {
          const camTrack = localRef.current?.getVideoTracks()[0];
          if (sender && camTrack) await sender.replaceTrack(camTrack);
          setCall((c) => (c ? { ...c, sharing: false } : c));
        };
        setCall((c) => ({ ...c, sharing: true }));
      }
    } catch {
      void 0;
    }
  }, [call]);

  const value = useMemo(
    () => ({
      call,
      localStream,
      remoteStream,
      error,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    }),
    [call, localStream, remoteStream, error, startCall, acceptCall, declineCall, endCall, toggleMute, toggleCamera, toggleScreenShare]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  return useContext(CallContext);
}
