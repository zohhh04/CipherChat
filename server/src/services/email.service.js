const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../config/logger');

let transporter = null;

function createTransporter() {
  if (!config.smtp.host) {
    logger.warn('SMTP_HOST is empty - emails will not be sent');
    return null;
  }

  const isGmail = config.smtp.host.includes('gmail');

  const transportConfig = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  };

  if (isGmail) {
    transportConfig.service = 'gmail';
    transportConfig.tls = { rejectUnauthorized: false };
  }

  const t = nodemailer.createTransport(transportConfig);

  t.verify()
    .then(() => logger.info({ host: config.smtp.host }, 'SMTP connection verified OK'))
    .catch((err) => logger.error({ err: err.message, host: config.smtp.host }, 'SMTP connection FAILED'));

  return t;
}

transporter = createTransporter();

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    logger.warn({ to, subject }, 'SMTP not configured - email not sent');
    logger.info('\n╔══════════════════════════════════════════╗');
    logger.info('║         EMAIL (dev mode only)            ║');
    logger.info('╠══════════════════════════════════════════╣');
    logger.info(`  To:      ${to}`);
    logger.info(`  Subject: ${subject}`);
    logger.info(`  Body:    ${text}`);
    logger.info('╚══════════════════════════════════════════╝\n');
    return { delivered: false };
  }

  try {
    const info = await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      text,
    });
    logger.info({ to, subject, messageId: info.messageId }, 'Email sent successfully');
    return { delivered: true };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'Email send FAILED');
    throw err;
  }
}

function emailWrapper({ title, preheader, body }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b141a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0b141a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#00a884,#06cf9c);border-radius:16px;padding:12px 16px;text-align:center;">
                    <span style="font-size:28px;">&#x1f6e1;&#xfe0f;</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:12px;">
                    <span style="font-size:20px;font-weight:700;color:#e9edef;letter-spacing:-0.3px;">CipherChat</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#111b21;border-radius:16px;border:1px solid rgba(134,150,160,0.12);overflow:hidden;">
              <!-- Green accent bar -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,#00a884,#06cf9c);"></td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:36px 32px;">
                ${body}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 16px 0;">
              <p style="margin:0;font-size:12px;color:#8696a0;line-height:1.6;">
                This is a security-related email for your CipherChat account.<br>
                If you didn't request this, you can safely ignore this email.
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#667781;">
                End-to-end encrypted &middot; CipherChat &copy; ${new Date().getFullYear()}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function verificationEmail(user, token) {
  const url = `${config.appPublicUrl}/verify-email?token=${token}`;
  const username = user.username || 'there';

  const html = emailWrapper({
    title: 'Verify your CipherChat account',
    preheader: `Welcome to CipherChat, ${username}! Verify your email to get started.`,
    body: `
      <tr>
        <td align="center" style="padding-bottom:8px;">
          <span style="font-size:42px;">&#x1f389;</span>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#e9edef;">Welcome to CipherChat!</h1>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:8px;">
          <p style="margin:0;font-size:15px;color:#e9edef;line-height:1.6;">Hi <strong>${username}</strong>,</p>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:24px;">
          <p style="margin:0;font-size:15px;color:#8696a0;line-height:1.7;">
            You're almost ready to start messaging. Verify your email address to activate your account and unlock end-to-end encrypted conversations.
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="background:linear-gradient(135deg,#00a884,#06cf9c);border-radius:12px;">
                <a href="${url}" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                  Verify My Email
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#1f2c34;border-radius:10px;border:1px solid rgba(134,150,160,0.08);">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0;font-size:13px;color:#8696a0;line-height:1.5;">
                  &#x1f512; <strong style="color:#e9edef;">Your privacy matters.</strong> All messages on CipherChat are end-to-end encrypted. Not even we can read them.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td>
          <p style="margin:0;font-size:13px;color:#667781;line-height:1.6;">
            Or copy and paste this link into your browser:<br>
            <a href="${url}" style="color:#00a884;word-break:break-all;font-size:12px;">${url}</a>
          </p>
        </td>
      </tr>
    `,
  });

  return {
    subject: 'Verify your CipherChat account',
    text: `Hi ${username}, verify your account: ${url}`,
    html,
  };
}

function resetEmail(user, token) {
  const url = `${config.appPublicUrl}/reset-password?token=${token}`;
  const username = user.username || 'there';

  const html = emailWrapper({
    title: 'Reset your CipherChat password',
    preheader: `${username}, we received a request to reset your CipherChat password.`,
    body: `
      <tr>
        <td align="center" style="padding-bottom:8px;">
          <span style="font-size:42px;">&#x1f510;</span>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#e9edef;">Password Reset Request</h1>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:8px;">
          <p style="margin:0;font-size:15px;color:#e9edef;line-height:1.6;">Hi <strong>${username}</strong>,</p>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:24px;">
          <p style="margin:0;font-size:15px;color:#8696a0;line-height:1.7;">
            We received a request to reset the password for your CipherChat account. Click the button below to choose a new password. This link will expire in <strong style="color:#e9edef;">30 minutes</strong>.
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="background:linear-gradient(135deg,#00a884,#06cf9c);border-radius:12px;">
                <a href="${url}" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                  Reset My Password
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#1f2c34;border-radius:10px;border:1px solid rgba(134,150,160,0.08);">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0;font-size:13px;color:#8696a0;line-height:1.5;">
                  &#x26a0;&#xfe0f; <strong style="color:#e9edef;">Didn't request this?</strong> If you didn't ask to reset your password, you can safely ignore this email. Your password will remain unchanged.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#1f2c34;border-radius:10px;border:1px solid rgba(134,150,160,0.08);">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0;font-size:13px;color:#8696a0;line-height:1.5;">
                  &#x1f512; <strong style="color:#e9edef;">Security tip:</strong> Your new password should be at least 10 characters long and include a mix of letters, numbers, and symbols.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td>
          <p style="margin:0;font-size:13px;color:#667781;line-height:1.6;">
            Or copy and paste this link into your browser:<br>
            <a href="${url}" style="color:#00a884;word-break:break-all;font-size:12px;">${url}</a>
          </p>
        </td>
      </tr>
    `,
  });

  return {
    subject: 'Reset your CipherChat password',
    text: `Hi ${username}, reset your password: ${url}`,
    html,
  };
}

module.exports = { sendMail, verificationEmail, resetEmail };
