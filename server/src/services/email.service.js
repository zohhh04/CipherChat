const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../config/logger');

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    logger.warn({ to, subject }, 'SMTP not configured - email content follows');
    logger.info({ to, subject, text }, 'EMAIL');
    return { delivered: false };
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, html, text });
  return { delivered: true };
}

function verificationEmail(user, token) {
  const url = `${config.appPublicUrl}/verify-email?token=${token}`;
  return {
    subject: 'Verify your Secure Chat account',
    text: `Hi ${user.username}, verify your account: ${url}`,
    html: `<p>Hi <strong>${user.username}</strong>,</p><p>Verify your Secure Chat account:</p><p><a href="${url}">Verify email</a></p>`,
  };
}

function resetEmail(user, token) {
  const url = `${config.appPublicUrl}/reset-password?token=${token}`;
  return {
    subject: 'Reset your Secure Chat password',
    text: `Hi ${user.username}, reset your password: ${url}`,
    html: `<p>Hi <strong>${user.username}</strong>,</p><p>Reset your password (valid 30 minutes):</p><p><a href="${url}">Reset password</a></p>`,
  };
}

module.exports = { sendMail, verificationEmail, resetEmail };
