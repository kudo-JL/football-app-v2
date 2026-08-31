/**
 * Legal pages — Privacy Policy & Terms of Use.
 * These are public pages, no auth required.
 */
const express = require('express');
const router = express.Router();

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'سياسة الخصوصية', user: req.user || null });
});

router.get('/terms', (req, res) => {
  res.render('terms', { title: 'شروط الاستخدام', user: req.user || null });
});

module.exports = router;
