import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext';

const CallContext = createContext(null);

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

  const cleanup = useCallback(() => {
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
    const constraints = { audio: true, video: mediaType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false };
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

  const startCall = useCallback(
    async (peerId, peerName, mediaType) => {
      setError('');
      peerRef.current = String(peerId);
      setCall({ state: 'outgoing', peerId: String(peerId), peerName, mediaType, muted: false, cameraOff: false, sharing: false });
      try {
        await getMedia(mediaType);
        emit('webrtc:call', { to: String(peerId), mediaType });
      } catch {
        cleanup();
        setError('Camera/microphone permission denied');
        throw new Error('permission');
      }
    },
    [emit, getMedia, cleanup]
  );

  const acceptCall = useCallback(async () => {
    setCall((c) => (c ? { ...c, state: 'active' } : c));
    try {
      await getMedia(call.mediaType);
      emit('webrtc:answer', { to: call.peerId, accept: true });
    } catch {
      emit('webrtc:answer', { to: call.peerId, accept: false });
      cleanup();
      setError('Camera/microphone permission denied');
    }
  }, [call, emit, getMedia, cleanup]);

  const declineCall = useCallback(() => {
    emit('webrtc:answer', { to: call.peerId, accept: false });
    cleanup();
  }, [call, emit, cleanup]);

  const endCall = useCallback(() => {
    if (peerRef.current) emit('webrtc:end', { to: peerRef.current });
    cleanup();
  }, [emit, cleanup]);

  useEffect(() => {
    const offs = [];

    offs.push(
      subscribe('call:incoming', ({ from, fromName, mediaType }) => {
        peerRef.current = String(from);
        setCall({ state: 'incoming', peerId: String(from), peerName: fromName, mediaType, muted: false, cameraOff: false, sharing: false });
      })
    );

    offs.push(
      subscribe('call:busy', () => {
        setError('User is busy');
        setTimeout(cleanup, 1200);
      })
    );

    offs.push(
      subscribe('call:answered', async ({ from, accept }) => {
        if (!accept) {
          setError('Call declined');
          setTimeout(cleanup, 1000);
          return;
        }
        setCall((c) => (c ? { ...c, state: 'active' } : c));
        const pc = buildPeerConnection(String(from));
        attachLocalTracks(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emit('webrtc:offer', { to: String(from), sdp: pc.localDescription.sdp });
      })
    );

    offs.push(
      subscribe('call:offer', async ({ from, sdp }) => {
        const pc = buildPeerConnection(String(from));
        attachLocalTracks(pc);
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

    offs.push(subscribe('call:ended', () => cleanup()));

    return () => offs.forEach((off) => off());
  }, [subscribe, emit, cleanup]);

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
