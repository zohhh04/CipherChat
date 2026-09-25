require('dotenv').config();

const num = (v, d) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) =>
  v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const accessSecret = process.env.JWT_ACCESS_SECRET || '';
const refreshSecret = process.env.JWT_REFRESH_SECRET || '';
if (isProd && (accessSecret.length < 32 || refreshSecret.length < 32)) {
  throw new Error('JWT secrets must be at least 32 chars in production');
}

module.exports = {
  env: nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: num(process.env.PORT, 5000),

  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cipherchat',

  clientUrls: (process.env.CLIENT_URLS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  appPublicUrl: process.env.APP_PUBLIC_URL || 'http://localhost:5173',

  jwt: {
    accessSecret,
    refreshSecret,
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshDays: num(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
    issuer: 'secure-chat',
    audience: 'secure-chat-client',
  },

  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),

  emailVerificationRequired: bool(process.env.EMAIL_VERIFICATION_REQUIRED, true),

  smtp: {
    // Empty by default: with no SMTP configured, emails are logged to the
    // console in dev (see email.service) instead of failing against Gmail.
    host: process.env.SMTP_HOST || process.env.EMAIL_HOST || '',
    port: num(process.env.SMTP_PORT || process.env.EMAIL_PORT, 587),
    user: process.env.SMTP_USER || process.env.EMAIL_USER || '',
    // Gmail app passwords are shown with spaces but must be used without them
    pass: (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s+/g, ''),
    from:
      process.env.MAIL_FROM ||
      process.env.EMAIL_FROM ||
      (process.env.SMTP_USER || process.env.EMAIL_USER
        ? `CipherChat <${process.env.SMTP_USER || process.env.EMAIL_USER}>`
        : 'Secure Chat <no-reply@localhost>'),
    secure: num(process.env.SMTP_PORT || process.env.EMAIL_PORT, 587) === 465,
  },

  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  https: {
    enabled: bool(process.env.ENABLE_HTTPS, false),
    keyPath: process.env.TLS_KEY_PATH || './certs/key.pem',
    certPath: process.env.TLS_CERT_PATH || './certs/cert.pem',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxMb: num(process.env.MAX_FILE_MB, 25),
  },

  ai: {
    apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || 'gemini-2.0-flash',
    baseURL: process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    maxTokens: num(process.env.AI_MAX_TOKENS, 500),
  },

  logPretty: bool(process.env.LOG_PRETTY, !isProd),
};
