/**
 * Football League Manager — single-file Express server.
 * Stack: Express + EJS + Node 22+ built-in SQLite + multer (logos).
 */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');

require('./lib/db'); // init + auto-run schema

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Expose current user + helpers to all views
const { escapeHtml, formatDate, formatDateTime, statusLabel, statusClass } = require('./lib/helpers');
app.use((req, res, next) => {
  const auth = require('./lib/auth');
  res.locals.user = auth.getSessionUser(req);
  res.locals.path = req.path;
  res.locals.appName = 'Football League Manager';
  res.locals.escapeHtml = escapeHtml;
  res.locals.formatDate = formatDate;
  res.locals.formatDateTime = formatDateTime;
  res.locals.statusLabel = statusLabel;
  res.locals.statusClass = statusClass;
  next();
});

// Health check (public, no auth)
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Routes
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/leagues', require('./routes/leagues'));
app.use(require('./routes/sections'));
app.use(require('./routes/teams'));
app.use(require('./routes/matchdays'));
app.use(require('./routes/matches'));
app.use(require('./routes/fixtures'));
app.use(require('./routes/players'));
app.use('/cups', require('./routes/cups'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/legal'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'غير موجود', message: 'الصفحة غير موجودة', layout: 'layouts/main' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'خطأ',
    message: err.message || 'خطأ في الخادم',
    layout: 'layouts/main',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ⚽ Football League Manager running on http://localhost:${PORT}\n`);
});
