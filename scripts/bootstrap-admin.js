// Creates the FIRST admin, from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD.
// Run by the deploy on every release; does nothing once an admin exists.
//
// Create-only, deliberately NOT an upsert like create-admin.js. The deploy runs
// this every single release — an upsert would quietly reset the password back to
// the GitHub secret each time, silently undoing any password change and leaving
// a long-lived credential that is only as safe as the CI secret store. So: it
// seeds an empty table and then never touches it again.
//
// Rotating a password afterwards is a panel job (edit the admin_users row), or
// `create-admin.js`, which DOES overwrite on purpose.
import '../src/env.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';

const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

const existing = await prisma.admin_users.count();

if (existing > 0) {
  console.log(`${existing} admin(s) already exist — leaving them alone.`);
  await prisma.$disconnect();
  process.exit(0);
}

// An empty table and no credentials means nobody can log in. Say so loudly, but
// don't fail the deploy over it — the panel is still up, and an admin can be
// made by hand with create-admin.js.
if (!email || !password) {
  console.warn(
    'No admins exist and ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are not set.\n' +
      'Nobody can log in. Set the secrets and redeploy, or create one by hand:\n' +
      '  docker exec -it coachwise-admin node scripts/create-admin.js <email> <password> SUPERADMIN',
  );
  await prisma.$disconnect();
  process.exit(0);
}

if (password.length < 10) {
  console.error('ADMIN_BOOTSTRAP_PASSWORD must be at least 10 characters.');
  await prisma.$disconnect();
  process.exit(1);
}

const admin = await prisma.admin_users.create({
  data: {
    email,
    password_hash: await bcrypt.hash(password, 10),
    role: 'SUPERADMIN',
    name: process.env.ADMIN_BOOTSTRAP_NAME || null,
  },
});

console.log(`Created first admin: ${admin.email} (SUPERADMIN)`);
await prisma.$disconnect();
