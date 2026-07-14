import { PrismaClient } from '@prisma/client';

// Money is bigint in Postgres (whole Toman/cents), so Prisma hands back BigInt.
// JSON.stringify throws on BigInt, and AdminJS serialises every record it renders
// — without this, any page showing a wallet, order or payout 500s.
BigInt.prototype.toJSON = function toJSON() {
  return this.toString();
};

export const prisma = new PrismaClient();
