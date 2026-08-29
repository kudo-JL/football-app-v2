/**
 * scripts/make-admin.js
 * Promote a user account to system admin (role = 'ADMIN').
 *
 * Usage:
 *   node scripts/make-admin.js <email>
 *   node scripts/make-admin.js --list          # list all users with roles
 *   node scripts/make-admin.js --demote <email>  # demote a user to 'user'
 *
 * Examples:
 *   node scripts/make-admin.js lotfi@lotfi.ma
 *   node scripts/make-admin.js --demote admin@a.com
 *   node scripts/make-admin.js --list
 *
 * Use this to set yourself as the only ADMIN. The default test accounts
 * (admin@a.com, a@a.com) are NOT auto-promoted anymore for security.
 */
const path = require('path');
const DatabaseSync = require('node:sqlite').DatabaseSync;
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'football.db'));

const arg1 = process.argv[2];
const arg2 = process.argv[3];

if (!arg1 || arg1 === '--help' || arg1 === '-h') {
  console.log('Usage:');
  console.log('  node scripts/make-admin.js <email>           promote to ADMIN');
  console.log('  node scripts/make-admin.js --demote <email>  demote to user');
  console.log('  node scripts/make-admin.js --list            list all users');
  process.exit(0);
}

if (arg1 === '--list') {
  const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at').all();
  console.log('\nUsers:');
  console.table(users);
  process.exit(0);
}

if (arg1 === '--demote') {
  if (!arg2) {
    console.error('Error: --demote requires an email');
    process.exit(1);
  }
  const result = db.prepare("UPDATE users SET role = 'user' WHERE email = ?").run(arg2);
  if (result.changes === 0) {
    console.error('No user found with email:', arg2);
    process.exit(1);
  }
  console.log('Demoted', arg2, 'to user.');
  process.exit(0);
}

// Promote to ADMIN
const email = arg1;
const result = db.prepare("UPDATE users SET role = 'ADMIN' WHERE email = ?").run(email);
if (result.changes === 0) {
  console.error('No user found with email:', email);
  console.log('Run --list to see available users.');
  process.exit(1);
}
const u = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(email);
console.log('\nPromoted to ADMIN:');
console.table([u]);
console.log('\nNow log in with this account and visit /admin');
