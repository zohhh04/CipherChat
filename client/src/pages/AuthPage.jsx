import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, apiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { Twemoji } from '../components/common/EmojiText';
import PasswordInput from '../components/common/PasswordInput';
import { toast } from '../components/common/Toast';

export default function AuthPage({ mode }) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();

  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(mode === 'verify-email' ? 'Verifying…' : '');
  const [done, setDone] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const verifyOnceRef = useRef(false);

  const goLogin = () => navigate('/login', { replace: true });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (mode !== 'verify-email') return;
    const token = params.get('token');
    if (!token) {
      setInfo('Missing verification token');
      return;
    }
    // Guard: tokens are single-use and effects can fire twice in dev —
    // without this the second call burns with "Invalid or expired token".
    if (verifyOnceRef.current) return;
    verifyOnceRef.current = true;
    let timer;
    const goLoginSoon = () => {
      timer = setTimeout(() => navigate('/login', { replace: true }), 2000);
    };
    authApi
      .verifyEmail(token)
      .then(() => {
        setInfo('Email verified! Taking you to sign in…');
        setDone(true);
        toast('Email verified! Please sign in.', 'success');
        goLoginSoon();
      })
      .catch((err) => {
        const e = apiError(err);
        if (e.code === 'token_invalid') {
          setInfo('This link was already used or expired — your email may already be verified. Taking you to sign in…');
          setDone(true);
          goLoginSoon();
        } else {
          setInfo(e.message);
        }
      });
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [mode, params, navigate]);

  const resendLink = async () => {
    const target = resendEmail || form.email;
    if (!target) return;
    setResending(true);
    try {
      await authApi.resendVerification(target);
      setInfo('If that account is unverified, a new link has been sent. Check your inbox (and spam folder).');
      setError('');
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setResending(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await login(form.email, form.password);
        if (!res.ok) {
          setError(res.message);
          if (res.code === 'email_unverified') {
            setError('Please verify your email first. Check your inbox (and spam folder).');
            setResendEmail(form.email);
          }
          return;
        }
        if (res.keyRotated) {
          toast('Welcome back! Your encryption identity was refreshed after your password change.', 'info');
        } else {
          toast('Welcome back!', 'success');
        }
        navigate('/app');
      } else if (mode === 'register') {
        if (form.password !== form.confirm) {
          setError('Passwords do not match');
          return;
        }
        const res = await authApi.register({
          username: form.username,
          email: form.email,
          password: form.password,
        });
        if (res.data?.devVerifyToken) {
          await authApi.verifyEmail(res.data.devVerifyToken);
          setInfo('Account created & verified (dev mode). You can sign in now.');
        } else if (res.data?.verificationEmailSent === false) {
          setInfo('Account created, but the verification email could not be sent. Check the address, then request a new link below.');
          setResendEmail(form.email);
        } else {
          setInfo('Account created. Check your email for a verification link.');
        }
        setDone(true);
      } else if (mode === 'forgot') {
        const res = await authApi.forgotPassword(form.email);
        setError('');
        if (res.devResetToken) {
          setInfo('Dev mode: SMTP not configured. Use this token to reset your password:');
          setDevToken(res.devResetToken);
        } else {
          setInfo(res.message);
        }
      } else if (mode === 'reset') {
        const token = params.get('token');
        if (!token) {
          setError('Missing reset token. Please open the link from your email again.');
          return;
        }
        if (form.password !== form.confirm) {
          setError('Passwords do not match');
          return;
        }
        await authApi.resetPassword(token, form.password);
        setInfo('Password updated. Sign in with your new password.');
        setDone(true);
      }
    } catch (err) {
      const e = apiError(err);
      setError(e.details && e.details.length > 0 ? `${e.details[0].path}: ${e.details[0].message}` : e.message);
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    login: 'Sign in',
    register: 'Create account',
    forgot: 'Reset password',
    reset: 'Choose a new password',
    'verify-email': 'Email verification',
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-shield"><Twemoji>🛡️</Twemoji></span>
          <h1>Secure Chat</h1>
          <p>End-to-end encrypted messaging</p>
        </div>

        <h2>{titles[mode]}</h2>

        {info && <div className="alert info">{info}</div>}
        {devToken && (
          <div className="dev-token-box">
            <code className="dev-token-value">{devToken}</code>
            <div className="dev-token-actions">
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  navigator.clipboard.writeText(devToken).then(() => toast('Token copied!', 'success'));
                }}
              >
                Copy token
              </button>
              <Link
                className="btn primary sm"
                to={`/reset-password?token=${devToken}`}
              >
                Use token to reset
              </Link>
            </div>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {resendEmail && (
          <button type="button" className="btn sm block" onClick={resendLink} disabled={resending} style={{ marginTop: 8 }}>
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>
        )}

        {(mode === 'verify-email' || done) && (
          <button type="button" className="btn primary block" onClick={goLogin}>
            Go to sign in
          </button>
        )}

        {!done && mode !== 'verify-email' && (
          <form onSubmit={submit} className="auth-form">
            {mode === 'register' && (
              <input className="text-input" placeholder="Username" value={form.username} onChange={set('username')} required minLength={3} maxLength={32} autoComplete="username" />
            )}
            {mode !== 'reset' && (
              <input className="text-input" type="email" placeholder="Email" value={form.email} onChange={set('email')} required autoComplete="email" />
            )}
            {mode !== 'forgot' && (
              <PasswordInput
                placeholder={mode === 'reset' ? 'New password (min 10 chars)' : 'Password'}
                value={form.password}
                onChange={set('password')}
                required
                minLength={mode === 'login' ? 1 : 10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            )}
            {(mode === 'register' || mode === 'reset') && (
              <PasswordInput placeholder="Confirm password" value={form.confirm} onChange={set('confirm')} required minLength={10} autoComplete="new-password" />
            )}

            <button className="btn primary block" type="submit" disabled={busy}>
              {busy ? 'Working…' : titles[mode]}
            </button>
          </form>
        )}

        <nav className="auth-links">
          {mode === 'login' && (
            <>
              <Link to="/forgot-password">Forgot password?</Link>
              <Link to="/register">Create an account</Link>
            </>
          )}
          {mode !== 'login' && <Link to="/login">Back to sign in</Link>}
        </nav>
      </div>
    </div>
  );
}
