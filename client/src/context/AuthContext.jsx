import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, usersApi, apiError } from '../api';
import {
  generateIdentityKeyPair,
  exportPublicKeyB64,
  wrapPrivateKey,
  unwrapPrivateKey,
  setPrivateKey,
  hasPrivateKey,
} from '../crypto/e2ee';
import { setAccessToken } from '../api/http';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [identityReady, setIdentityReady] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const bootstrapped = useRef(false);

  const initIdentity = useCallback(async (me, password) => {
    const stored = await usersApi.getKeysBackup();
    if (stored.backup) {
      const priv = await unwrapPrivateKey(stored.backup, password);
      setPrivateKey(priv);
      setPublicKey(stored.publicKey);
    } else {
      const pair = await generateIdentityKeyPair();
      const pubB64 = await exportPublicKeyB64(pair.publicKey);
      const backup = await wrapPrivateKey(pair.privateKey, password);
      await usersApi.saveKeys(pubB64, backup);
      setPrivateKey(pair.privateKey);
      setPublicKey(pubB64);
    }
    setIdentityReady(true);
  }, []);

  const login = useCallback(
    async (email, password) => {
      try {
        const data = await authApi.login(email, password);
        setAccessToken(data.accessToken);
        setUser(data.user);
        await initIdentity(data.user, password);
        return { ok: true };
      } catch (err) {
        const e = apiError(err);
        return { ok: false, ...e };
      }
    },
    [initIdentity]
  );

  const reUnlock = useCallback(
    async (password) => {
      if (!user) return { ok: false, message: 'Not logged in' };
      try {
        await initIdentity(user, password);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err.message || 'Wrong password' };
      }
    },
    [user, initIdentity]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      void 0;
    }
    setAccessToken(null);
    setUser(null);
    setIdentityReady(false);
    setPublicKey('');
    window.location.assign('/login');
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      try {
        const data = await authApi.refresh();
        setAccessToken(data.accessToken);
        setUser(data.user);

        const stored = await usersApi.getKeysBackup().catch(() => null);
        if (stored && stored.publicKey) {
          setPublicKey(stored.publicKey);
        }
      } catch {
        void 0;
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      identityReady,
      publicKey,
      login,
      logout,
      reUnlock,
      register: authApi.register,
    }),
    [user, booting, identityReady, publicKey, login, logout, reUnlock]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
