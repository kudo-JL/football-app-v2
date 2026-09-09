/**
 * Email sender (nodemailer).
 * - In production: uses SMTP_* env vars (set in Coolify)
 * - In development: logs emails to console (so you can see them locally)
 *
 * Recommended providers (free tier):
 *   - Brevo (ex-Sendinblue): 300 emails/day free — https://www.brevo.com
 *   - Mailgun: 100 emails/day free — https://www.mailgun.com
 *   - SendGrid: 100 emails/day free — https://sendgrid.com
 */
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Lotfi <noreply@sport.lotfi.ma>';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';
const BRAND_NAME = 'Lotfi';
const BRAND_TAGLINE = 'إدارة الدوريات الاحترافية';

let transporter = null;
let isDev = true;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  isDev = false;
}

/**
 * Send verification email after registration.
 */
async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${PUBLIC_URL}/verify/${token}`;
  const html = renderVerificationHtml(name, verifyUrl);
  const text = `مرحباً ${name}،\n\nشكراً لتسجيلك في ${BRAND_NAME}!\n\nفعّل حسابك من الرابط:\n${verifyUrl}\n\nصالح لمدة 24 ساعة.\n\n— ${BRAND_NAME} · ${BRAND_TAGLINE}`;

  return sendMail({
    to: email,
    subject: `فعّل حسابك في ${BRAND_NAME}`,
    html,
    text,
  });
}

async function sendMail({ to, subject, html, text }) {
  if (isDev) {
    // Dev mode: log to console (you can see the verification URL)
    console.log('\n=== 📧 EMAIL (DEV MODE) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('---');
    // Find the verify URL and print it boldly
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      console.log('🔗 VERIFICATION LINK:', urlMatch[0]);
    }
    console.log('==========================\n');
    return { devMode: true };
  }

  // Production: real send
  return transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    html,
    text,
  });
}

function renderVerificationHtml(name, verifyUrl) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-height: 100vh;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%); padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="500" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">

          <!-- Header with logo/brand -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #0891b2 100%); padding: 32px 24px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 8px;">⚽</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; letter-spacing: -0.5px;">${BRAND_NAME}</h1>
              <p style="margin: 6px 0 0; color: #d1fae5; font-size: 14px;">${BRAND_TAGLINE}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 22px; font-weight: bold;">مرحباً ${escapeHtml(name)} 👋</h2>
              <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.7;">
                شكراً لتسجيلك في <strong style="color: #059669;">${BRAND_NAME}</strong>!
                <br>
                نحن سعداء بانضمامك. خطوة واحدة فقط لتفعيل حسابك والبدء في إدارة دورياتك الاحترافية.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 16px 0 8px;">
                    <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(5,150,105,0.3);">
                      ✅ فعّل حسابي
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 28px 0 8px; color: #64748b; font-size: 13px; line-height: 1.5; text-align: center;">
                أو انسخ والصق هذا الرابط في متصفحك:
              </p>
              <p style="margin: 0; padding: 12px; background: #f1f5f9; border-radius: 8px; word-break: break-all; text-align: center;">
                <a href="${verifyUrl}" style="color: #0891b2; font-size: 12px; text-decoration: none; font-family: 'Courier New', monospace;">${verifyUrl}</a>
              </p>

              <!-- Features highlight -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 28px;">
                <tr>
                  <td style="padding: 20px; background: #f0fdf4; border-radius: 10px; border-right: 4px solid #059669;">
                    <p style="margin: 0 0 8px; color: #065f46; font-size: 13px; font-weight: bold;">بعد التفعيل، تستطيع:</p>
                    <ul style="margin: 0; padding-right: 20px; color: #047857; font-size: 13px; line-height: 1.8;">
                      <li>إنشاء وإدارة دوريات لا محدودة</li>
                      <li>دعم الأندية بأدوات احترافية</li>
                      <li>متابعة الترتيب والإحصائيات</li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 4px; color: #94a3b8; font-size: 11px;">
                ⏰ هذا الرابط صالح لمدة 24 ساعة فقط.
              </p>
              <p style="margin: 0 0 4px; color: #94a3b8; font-size: 11px;">
                إذا لم تطلب هذا الحساب، تجاهل هذا الإيميل.
              </p>
              <p style="margin: 12px 0 0; color: #cbd5e1; font-size: 11px;">
                © ${new Date().getFullYear()} ${BRAND_NAME} · sport.lotfi.ma
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 20px 0 0; color: #94a3b8; font-size: 11px; text-align: center;">
          أُرسل هذا الإيميل لأنك قمت بالتسجيل في ${BRAND_NAME}.
        </p>
      </td>
    </tr>
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
