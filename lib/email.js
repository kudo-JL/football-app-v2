/**
 * Email sender via Brevo HTTP API (works through any firewall that allows HTTPS).
 * - In production: calls api.brevo.com/v3/smtp/email with SMTP_API_KEY
 * - In development: logs the email to console (so you can see it locally)
 *
 * Free tier: 300 emails/day (transactional, no contact limit).
 */
const https = require('https');

const SMTP_API_KEY = process.env.SMTP_PASS || ''; // re-use SMTP_PASS env var for the Brevo API key
const SMTP_FROM = process.env.SMTP_FROM || 'Lotfi <noreply@sport.lotfi.ma>';
const BRAND_NAME = 'Lotfi';
const BRAND_TAGLINE = 'إدارة الدوريات الاحترافية';

let isDev = !SMTP_API_KEY;

/**
 * Send verification email after registration.
 */
async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/verify/${token}`;
  const html = renderVerificationHtml(name, verifyUrl);
  const text = `مرحباً ${name}،\n\nشكراً لتسجيلك في ${BRAND_NAME}!\n\nفعّل حسابك من الرابط:\n${verifyUrl}\n\nصالح لمدة 24 ساعة.\n\n— ${BRAND_NAME} · ${BRAND_TAGLINE}`;

  return sendMail({
    to: email,
    subject: `فعّل حسابك في ${BRAND_NAME}`,
    html,
    text,
  });
}

function sendMail({ to, subject, html, text }) {
  if (isDev) {
    console.log('\n=== 📧 EMAIL (DEV MODE) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) console.log('🔗 VERIFICATION LINK:', urlMatch[0]);
    console.log('==========================\n');
    return Promise.resolve({ devMode: true });
  }

  // Parse SMTP_FROM into name + email
  const fromMatch = SMTP_FROM.match(/^(.+?)\s*<([^>]+)>$/);
  const senderName = fromMatch ? fromMatch[1].trim() : 'Lotfi';
  const senderEmail = fromMatch ? fromMatch[2].trim() : SMTP_FROM;

  const body = JSON.stringify({
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        port: 443,
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': SMTP_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[email] Sent to', to, '— status', res.statusCode);
            resolve({ statusCode: res.statusCode, body: data });
          } else {
            console.error('[email] Brevo API error:', res.statusCode, data);
            reject(new Error(`Brevo API returned ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Brevo API request timed out'));
    });
    req.on('error', (err) => {
      console.error('[email] Brevo API request failed:', err.message);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function renderVerificationHtml(name, verifyUrl) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:linear-gradient(135deg,#f0fdf4 0%,#ecfeff 100%);font-family:'Segoe UI',Tahoma,sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(135deg,#f0fdf4 0%,#ecfeff 100%);padding:40px 20px;">
    <tr><td align="center">
      <table width="500" cellspacing="0" cellpadding="0" style="max-width:500px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#059669 0%,#0891b2 100%);padding:32px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">⚽</div>
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:bold;">${BRAND_NAME}</h1>
          <p style="margin:6px 0 0;color:#d1fae5;font-size:14px;">${BRAND_TAGLINE}</p>
        </td></tr>
        <tr><td style="padding:40px 32px;">
          <h2 style="margin:0 0 12px;color:#0f172a;font-size:22px;">مرحباً ${escapeHtml(name)} 👋</h2>
          <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.7;">
            شكراً لتسجيلك في <strong style="color:#059669;">${BRAND_NAME}</strong>!
            <br>نحن سعداء بانضمامك. خطوة واحدة فقط لتفعيل حسابك.
          </p>
          <table width="100%"><tr><td align="center" style="padding:16px 0 8px;">
            <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#059669 0%,#10b981 100%);color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;font-weight:bold;font-size:16px;">
              ✅ فعّل حسابي
            </a>
          </td></tr></table>
          <p style="margin:28px 0 8px;color:#64748b;font-size:13px;text-align:center;">أو انسخ والصق هذا الرابط:</p>
          <p style="margin:0;padding:12px;background:#f1f5f9;border-radius:8px;word-break:break-all;text-align:center;">
            <a href="${verifyUrl}" style="color:#0891b2;font-size:12px;text-decoration:none;font-family:monospace;">${verifyUrl}</a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;">⏰ هذا الرابط صالح لمدة 24 ساعة فقط.</p>
          <p style="margin:0;color:#cbd5e1;font-size:11px;">© ${new Date().getFullYear()} ${BRAND_NAME} · sport.lotfi.ma</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  sendVerificationEmail,
  isDevMode: () => isDev,
};
