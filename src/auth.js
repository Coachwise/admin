import bcrypt from 'bcryptjs';
import { prisma } from './db.js';

/**
 * Admin login. Checked against admin_users — NOT the product's `users` table.
 *
 * Product login is passwordless phone + OTP; if admin rights hung off that, a SIM
 * swap on the right number would be a full takeover of the payout queue. Admins
 * have their own credentials and their own session, and no product token can
 * reach this panel.
 */
export async function authenticate(email, password) {
  const admin = await prisma.admin_users.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  // Compare against a dummy hash when the account is missing or disabled, so a
  // wrong email and a wrong password take the same time to answer and the login
  // form can't be used to enumerate admin accounts.
  const hash = admin?.is_active
    ? admin.password_hash
    : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';

  const ok = await bcrypt.compare(password, hash);
  if (!ok || !admin?.is_active) return null;

  await prisma.admin_users.update({
    where: { id: admin.id },
    data: { last_login_at: new Date() },
  });

  // Whatever this returns becomes `currentAdmin` in every action — role included,
  // which is what gates the money actions.
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    title: admin.role,
    name: admin.name ?? admin.email,
  };
}
