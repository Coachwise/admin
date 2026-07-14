// Creates (or re-passwords) an admin account.
//
//   npm run create-admin -- <email> <password> [SUPERADMIN|ADMIN] [name]
//
// There is no self-signup: an admin can only exist because someone with shell
// access on the server made one. Only SUPERADMIN may action payouts.
import '../src/env.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';

const [email, password, role = 'SUPERADMIN', ...nameParts] = process.argv.slice(2);

if (!email || !password) {
  console.error('usage: npm run create-admin -- <email> <password> [SUPERADMIN|ADMIN] [name]');
  process.exit(1);
}
if (!['SUPERADMIN', 'ADMIN'].includes(role)) {
  console.error(`role must be SUPERADMIN or ADMIN, got "${role}"`);
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters.');
  process.exit(1);
}

const normalized = email.trim().toLowerCase();
const password_hash = await bcrypt.hash(password, 10);
const name = nameParts.join(' ') || null;

const admin = await prisma.admin_users.upsert({
  where: { email: normalized },
  update: { password_hash, role, is_active: true, updated_at: new Date() },
  create: { email: normalized, password_hash, role, name },
});

console.log(`${admin.email} (${admin.role}) ready — sign in at /admin`);
await prisma.$disconnect();
