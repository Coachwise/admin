import bcrypt from 'bcryptjs';

/**
 * Turns the virtual `newPassword` field into a bcrypt hash.
 *
 * Same cost (10) and same $2a$ format as api/'s golang.org/x/crypto/bcrypt, so
 * hashes stay mutually readable if admin auth ever moves into Go.
 */
export const beforeSaveHashPassword = async (request) => {
  const plain = request.payload?.newPassword;

  if (plain) {
    request.payload.password_hash = await bcrypt.hash(plain, 10);
  }
  delete request.payload?.newPassword;

  return request;
};
