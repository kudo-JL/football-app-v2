const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const { sendVerificationEmail } = require('../lib/email');

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'تسجيل الدخول', error: null, info: req.query.info || null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'البريد وكلمة المرور مطلوبة' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'بيانات الدخول غير صحيحة' });
  }
  if (!user.is_verified) {
    return res.render('auth/login', {
      title: 'تسجيل الدخول',
      error: null,
      info: 'الحساب غير مفعل. تحقق من بريدك الإلكتروني لرسالة التفعيل. <a href="/resend-verification?email=' + encodeURIComponent(email) + '">إعادة إرسال</a>',
    });
  }
  auth.issueSession(res, user);
  res.redirect('/');
});

router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'إنشاء حساب', error: null });
});

router.post('/register', (req, res) => {
  const { name, email, password, passwordConfirm } = req.body || {};
  if (!name || !email || !password) {
    return res.render('auth/register', { title: 'إنشاء حساب', error: 'كل الحقول مطلوبة' });
  }
  if (password.length < 6) {
    return res.render('auth/register', { title: 'إنشاء حساب', error: 'كلمة المرور 6+ أحرف' });
  }
  if (password !== passwordConfirm) {
    return res.render('auth/register', { title: 'إنشاء حساب', error: 'كلمتا المرور غير متطابقتين' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.render('auth/register', { title: 'إنشاء حساب', error: 'البريد مستخدم بالفعل' });
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const role = count === 0 ? 'ADMIN' : 'USER';
  const isSuperAdmin = count === 0 ? 1 : 0;  // First registered user is the super admin
  const id = auth.newId();
  // Generate verification token (24h expiry)
  const token = require('crypto').randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, is_super_admin, is_verified, verification_token, verification_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, email, auth.hashPassword(password), name, role, isSuperAdmin, token, expires);
  // Send verification email (async, but we don't await — best-effort)
  sendVerificationEmail(email, name, token).catch((e) => {
    console.error('[email] Failed to send verification:', e.message);
  });
  // Show "check your email" page
  res.render('auth/check-email', {
    title: 'تحقق من بريدك',
    email,
    devMode: require('../lib/email').isDevMode(),
    resendDone: false,
    alreadyVerified: false,
    notFound: false,
  });
});

// Email verification link
router.get('/verify/:token', (req, res) => {
  const { token } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);
  if (!user) {
    return res.render('auth/verify-result', { title: 'خطأ', success: false, message: 'رابط التفعيل غير صالح.' });
  }
  if (user.verification_expires_at && new Date(user.verification_expires_at) < new Date()) {
    return res.render('auth/verify-result', {
      title: 'انتهت صلاحية الرابط',
      success: false,
      message: 'انتهت صلاحية رابط التفعيل. <a href="/resend-verification?email=' + encodeURIComponent(user.email) + '">إعادة إرسال</a>',
    });
  }
  db.prepare('UPDATE users SET is_verified = 1, verification_token = NULL, verification_expires_at = NULL WHERE id = ?').run(user.id);
  // Auto-login after verification
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  auth.issueSession(res, updated);
  res.render('auth/verify-result', { title: 'تم التفعيل', success: true, message: 'تم تفعيل حسابك بنجاح! مرحباً بك في Sport Oriental.' });
});

// Resend verification email
router.get('/resend-verification', (req, res) => {
  const email = req.query.email || '';
  if (!email) {
    return res.render('auth/check-email', { title: 'إعادة إرسال', email: '', devMode: require('../lib/email').isDevMode(), resendDone: false });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.render('auth/check-email', { title: 'إعادة إرسال', email, devMode: require('../lib/email').isDevMode(), resendDone: false, notFound: true });
  }
  if (user.is_verified) {
    return res.render('auth/check-email', { title: 'إعادة إرسال', email, devMode: require('../lib/email').isDevMode(), resendDone: true, alreadyVerified: true });
  }
  const token = require('crypto').randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET verification_token = ?, verification_expires_at = ? WHERE id = ?').run(token, expires, user.id);
  sendVerificationEmail(email, user.name, token).catch((e) => {
    console.error('[email] Failed to resend:', e.message);
  });
    res.render('auth/check-email', { title: 'إعادة إرسال', email, devMode: require('../lib/email').isDevMode(), resendDone: true, alreadyVerified: false });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/login');
});

// Account settings: change password
router.get('/account', auth.requireAuth, (req, res) => {
  const stats = {
    leagues: db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE owner_id = ?').get(req.user.id).n,
    sections: db.prepare('SELECT COUNT(*) AS n FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)').get(req.user.id).n,
  };
  res.render('auth/account', { title: 'حسابي', user: req.user, stats, error: null, success: req.query.saved || null });
});

router.post('/account/password', auth.requireAuth, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const renderWith = (error) => res.render('auth/account', {
    title: 'حسابي',
    user: req.user,
    stats: {
      leagues: db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE owner_id = ?').get(req.user.id).n,
      sections: db.prepare('SELECT COUNT(*) AS n FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)').get(req.user.id).n,
    },
    error,
    success: null,
  });

  if (!currentPassword || !newPassword || !confirmPassword) {
    return renderWith('كل الحقول مطلوبة');
  }
  if (!auth.verifyPassword(currentPassword, user.password_hash)) {
    return renderWith('كلمة المرور الحالية غير صحيحة');
  }
  if (newPassword.length < 6) {
    return renderWith('كلمة المرور الجديدة 6 أحرف على الأقل');
  }
  if (newPassword !== confirmPassword) {
    return renderWith('كلمة المرور الجديدة وتأكيدها غير متطابقتين');
  }
  if (currentPassword === newPassword) {
    return renderWith('كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية');
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(auth.hashPassword(newPassword), req.user.id);
  res.redirect('/account?saved=1');
});

router.post('/account/profile', auth.requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || name.trim().length < 2) {
    return res.render('auth/account', {
      title: 'حسابي',
      user: req.user,
      stats: {
        leagues: db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE owner_id = ?').get(req.user.id).n,
        sections: db.prepare('SELECT COUNT(*) AS n FROM sections WHERE league_id IN (SELECT id FROM leagues WHERE owner_id = ?)').get(req.user.id).n,
      },
      error: 'الاسم قصير جداً',
      success: null,
    });
  }
  db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name.trim(), req.user.id);
  res.redirect('/account?saved=1');
});

module.exports = router;
