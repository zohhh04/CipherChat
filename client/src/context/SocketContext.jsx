import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL, setRefreshHandler, getAccessToken } from '../api/http';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, identityReady } = useAuth();
  const [connected, setConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const socketRef = useRef(null);
  const listenersRef = useRef([]);

  useEffect(() => {
    if (!user || !identityReady) return undefined;

    const socket = io(SOCKET_URL || undefined, {
      auth: { token: getAccessToken() },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    setRefreshHandler((token) => {
      socket.auth.token = token;
      if (!socket.connected) socket.connect();
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onPresence = ({ userId, online }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(String(userId));
        else next.delete(String(userId));
        return next;
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('presence:update', onPresence);

    for (const [event, handler] of listenersRef.current) {
      socket.on(event, handler);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('presence:update', onPresence);
      for (const [event, handler] of listenersRef.current) {
        socket.off(event, handler);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, identityReady]);

  const subscribe = useMemo(
    () => (event, handler) => {
      const pair = [event, handler];
      listenersRef.current.push(pair);
      if (socketRef.current) socketRef.current.on(event, handler);
      return () => {
        listenersRef.current = listenersRef.current.filter((p) => p[1] !== handler);
        if (socketRef.current) socketRef.current.off(event, handler);
      };
    },
    []
  );

  const emit = useMemo(
    () => (event, payload) => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit(event, payload);
        return true;
      }
      return false;
    },
    []
  );

  const value = useMemo(
    () => ({ socket: socketRef, connected, onlineIds, subscribe, emit }),
    [connected, onlineIds, subscribe, emit]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
