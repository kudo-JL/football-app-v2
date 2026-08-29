const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../lib/auth');

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'تسجيل الدخول', error: null });
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
  const id = auth.newId();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, auth.hashPassword(password), name, role);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  auth.issueSession(res, user);
  res.redirect('/');
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
