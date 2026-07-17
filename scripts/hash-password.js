// Prints a bcrypt hash for a password, so you can set it with a plain SQL UPDATE:
//
//   node scripts/hash-password.js 'my-new-password'
//   -> $2a$10$....
//
//   UPDATE admin_users SET password_hash = '$2a$10$....' WHERE email = 'you@...';
//
// Same cost (10) and $2a$ format the panel uses, so the hash it prints is exactly
// what authenticate() will check against. Needs no database connection — it only
// hashes — so it runs fine on a laptop with the repo checked out.
//
// (create-admin.js does the hash AND the write in one step; use this only when
// you specifically want to run the UPDATE yourself.)
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password || password.length < 10) {
  console.error("usage: node scripts/hash-password.js '<password>'   (min 10 chars)");
  console.error('Quote the password so the shell does not touch $, !, spaces, etc.');
  process.exit(1);
}

console.log(await bcrypt.hash(password, 10));
