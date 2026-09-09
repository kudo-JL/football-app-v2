/**
 * Auth — single-token cookie for simplicity.
 * Uses Node's built-in crypto.scrypt (no bcrypt dependency) — works without compile.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'flm_session';
const TOKEN_TTL_DAYS = 14;
const SCRYPT_KEYLEN = 64;

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const hash = parts[2];
  const test = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sessionToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  return { token, userId };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((p) => {
    const idx = p.indexOf('=');
    if (idx < 0) return;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 1000 * 60 * 60 * 24 * TOKEN_TTL_DAYS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const [sessionId, userId] = token.split('.');
  if (!sessionId || !userId) return null;

  const db = require('./db');
  const row = db
  .prepare('SELECT id, email, name, role, is_verified, is_super_admin FROM users WHERE id = ?')
  .get(userId);  
  return row || null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'auth required' });
  }
  if (!user.is_verified) {
    if (req.accepts('html')) return res.redirect('/verify-pending');
    return res.status(403).json({ error: 'email not verified' });
  }
  req.user = user;
  next();
}

/**
 * Optional auth: sets req.user if logged in, but never blocks the request.
 * Use this for routes that should be publicly viewable but show extra UI
 * when the visitor is the owner or an admin.
 */
function optionalAuth(req, res, next) {
  const user = getSessionUser(req);
  if (user) req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      if (req.accepts('html')) return res.status(403).send('forbidden');
      return res.status(403).json({ error: 'admin required' });
    }
    next();
  });
}

/**
 * Super admin gate — only the FIRST registered user (is_super_admin=1).
 * Use this for destructive actions: delete user, manual verify, etc.
 * If no super admin exists yet (e.g. legacy DB), grants access to the
 * lowest-id user as a safe fallback.
 */
function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_super_admin) {
      if (req.accepts('html')) return res.status(403).send('forbidden — super admin only');
      return res.status(403).json({ error: 'super admin required' });
    }
    next();
  });
}

/**
 * Check if `user` (may be null) is allowed to edit a `league`.
 * Returns true if user is the league owner OR a super admin.
 */
function canEditLeague(user, league) {
  if (!user || !league) return false;
  if (user.role === 'ADMIN') return true;
  return user.id === league.owner_id;
}

function issueSession(res, user) {
  const { token } = sessionToken(user.id);
  const cookieValue = token + '.' + user.id;
  setSessionCookie(res, cookieValue);
}

// Random session secret for production cookie signing (regenerated on each restart
// — fine for single-instance, would need to be persistent for multi-instance)
function getSessionSecret() {
  return process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
}

module.exports = {
  newId,
  hashPassword,
  verifyPassword,
  issueSession,
  clearSessionCookie,
  getSessionUser,
  getSessionSecret,
  requireAuth,
  optionalAuth,
  requireAdmin,
  requireSuperAdmin,
  canEditLeague,
  COOKIE_NAME,
};
