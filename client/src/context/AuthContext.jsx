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

  // Returns { rotated: true } when the stored backup could not be unwrapped
  // with this password (e.g. after a forgot-password reset, which cannot
  // re-wrap the backup) and a fresh identity was created instead.
  const initIdentity = useCallback(async (me, password) => {
    const stored = await usersApi.getKeysBackup();
    if (stored.backup) {
      try {
        const priv = await unwrapPrivateKey(stored.backup, password);
        setPrivateKey(priv);
        setPublicKey(stored.publicKey);
        setIdentityReady(true);
        return { rotated: false };
      } catch {
        // Backup belongs to a previous password — self-heal with a fresh
        // identity wrapped with the current password so sign-in keeps working.
        const pair = await generateIdentityKeyPair();
        const pubB64 = await exportPublicKeyB64(pair.publicKey);
        const backup = await wrapPrivateKey(pair.privateKey, password);
        await usersApi.saveKeys(pubB64, backup);
        setPrivateKey(pair.privateKey);
        setPublicKey(pubB64);
        setIdentityReady(true);
        return { rotated: true };
      }
    }
    const pair = await generateIdentityKeyPair();
    const pubB64 = await exportPublicKeyB64(pair.publicKey);
    const backup = await wrapPrivateKey(pair.privateKey, password);
    await usersApi.saveKeys(pubB64, backup);
    setPrivateKey(pair.privateKey);
    setPublicKey(pubB64);
    setIdentityReady(true);
    return { rotated: false };
  }, []);

  const login = useCallback(
    async (email, password) => {
      // Server-side credential check first — only its errors mean "wrong login".
      let data;
      try {
        data = await authApi.login(email, password);
      } catch (err) {
        const e = apiError(err);
        return { ok: false, ...e };
      }
      setAccessToken(data.accessToken);
      setUser(data.user);
      // Device identity setup must never fail the sign-in itself.
      let keyRotated = false;
      try {
        const r = await initIdentity(data.user, password);
        keyRotated = !!(r && r.rotated);
      } catch (err) {
        console.warn('Identity setup failed, continuing signed-in:', err);
      }
      return { ok: true, keyRotated };
    },
    [initIdentity]
  );

  // Manual unlock attempt: never rotates — a wrong password just fails.
  const reUnlock = useCallback(
    async (password) => {
      if (!user) return { ok: false, message: 'Not logged in' };
      try {
        const stored = await usersApi.getKeysBackup();
        if (stored.backup) {
          const priv = await unwrapPrivateKey(stored.backup, password);
          setPrivateKey(priv);
          setPublicKey(stored.publicKey);
        } else {
          await initIdentity(user, password);
          return { ok: true };
        }
        setIdentityReady(true);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: 'Wrong password' };
      }
    },
    [user, initIdentity]
  );

  // 🔑 Create a brand-new encryption identity (ECDH P-256 key pair).
  // The private key is wrapped with the account password and only the
  // public key + wrapped backup are sent to the server.
  // WARNING: chats wrapped with the old key can no longer be decrypted.
  const createIdentityKey = useCallback(
    async (password) => {
      if (!user) return { ok: false, message: 'Not logged in' };
      if (!password || password.length < 10) {
        return { ok: false, message: 'Password must be at least 10 characters' };
      }
      try {
        const pair = await generateIdentityKeyPair();
        const pubB64 = await exportPublicKeyB64(pair.publicKey);
        const backup = await wrapPrivateKey(pair.privateKey, password);
        await usersApi.saveKeys(pubB64, backup);
        setPrivateKey(pair.privateKey);
        setPublicKey(pubB64);
        setIdentityReady(true);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err.message || 'Key creation failed' };
      }
    },
    [user]
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

        try {
          const stored = await usersApi.getKeysBackup();
          if (stored && stored.publicKey) {
            setPublicKey(stored.publicKey);
          }
        } catch {
          void 0;
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
      setUser,
      booting,
      identityReady,
      publicKey,
      login,
      logout,
      reUnlock,
      createIdentityKey,
      register: authApi.register,
    }),
    [user, booting, identityReady, publicKey, login, logout, reUnlock, createIdentityKey]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
