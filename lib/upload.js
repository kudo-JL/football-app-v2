/**
 * Upload — multer config for team logos.
 * Stores files in /public/uploads/teams/ with teamId-timestamp.ext naming.
 * Pure JS, no native deps, works on all platforms.
 */
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'teams');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const teamId = (req.params && req.params.id) || 'team';
    const stamp = Date.now();
    const safe = String(teamId).replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'team';
    cb(null, `${safe}-${stamp}${ext}`);
  },
});

const fileFilter = function (req, file, cb) {
  if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('نوع الملف غير مدعوم. استخدم JPG / PNG / GIF / WEBP / SVG'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

module.exports = {
  upload,
  UPLOAD_DIR,
  MAX_SIZE,
  ALLOWED_MIMES,
};
