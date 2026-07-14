import { Prisma } from '@prisma/client';
import { getModelByName } from '@adminjs/prisma';
import { prisma } from './db.js';
import { payoutActions } from './actions/payouts.js';
import { softDeleteAction } from './actions/soft-delete.js';
import { beforeSaveHashPassword } from './actions/admin-users.js';

// Money tables are LIST/SHOW only.
//
// Wallet balances are derived from wallet_transactions — there is no cached
// balance column — so a row here is only ever correct in company with its
// ledger entry. A free-text CRUD form lets you break that pairing silently: the
// worst case is flipping a payout to REJECTED, which must credit the coach's
// money back (RequestPayout already debited it) and in a plain form would not.
// Every legitimate money change therefore goes through a custom action that
// writes both sides in one transaction. See actions/payouts.js.
const READ_ONLY = new Set([
  'wallets',
  'wallet_transactions',
  'orders',
  'payments',
  'payouts',
  'package_subscriptions',
]);

// Plumbing an operator should never hand-edit.
const HIDDEN = new Set([
  'schema_migrations', // api/'s golang-migrate history
  'admin_migrations', // our own
  'otps', // short-lived secrets
  'tokens_blacklist',
  'param_logs',
  'sets',
]);

const NAV = {
  People: ['users', 'coaches', 'coach_applications', 'connections', 'connection_requests'],
  Training: [
    'exercises',
    'exercise_categories',
    'tags',
    'plans',
    'plan_exercises',
    'plan_assignees',
    'plan_schedules',
    'sessions',
    'workout_logs',
    'workout_logs_tags',
    'params',
  ],
  Coaching: [
    'coach_packages',
    'coach_package_plans',
    'coach_package_prices',
    'duration_tiers',
    'tests',
    'test_items',
    'test_requests',
    'achievements',
    'profile_achievement_layouts',
  ],
  Money: [
    'payouts',
    'payout_accounts',
    'orders',
    'payments',
    'wallets',
    'wallet_transactions',
    'package_subscriptions',
    'currencies',
    'pro_prices',
  ],
  Social: [
    'feeds',
    'feed_comments',
    'feed_likes',
    'feed_media',
    'feed_tags',
    'media',
    'messages',
    'chats',
    'chat_members',
    'notifications',
  ],
  System: ['admin_users', 'admin_audit_log', 'platform_settings'],
};

const groupOf = (name) =>
  Object.entries(NAV).find(([, models]) => models.includes(name))?.[0] ?? 'Other';

// Money columns render as raw bigint strings; show them as grouped numbers so a
// misplaced zero is visible at a glance.
const AMOUNT_FIELDS = new Set(['amount', 'price', 'balance', 'total', 'fee']);

/** Only a SUPERADMIN may act on money. */
const isSuperAdmin = ({ currentAdmin }) => currentAdmin?.role === 'SUPERADMIN';

function propertiesFor(model, { readOnly, softDelete }) {
  const properties = {};

  for (const field of model.fields) {
    // tsvector columns are GENERATED ALWAYS; Postgres rejects any write to them.
    // Prisma types them Unsupported so the client can't touch them, but they
    // still show up in the DMMF — hide them or every form carries a dead field.
    if (String(field.type).startsWith('Unsupported')) {
      properties[field.name] = { isVisible: false };
      continue;
    }

    if (AMOUNT_FIELDS.has(field.name) && field.type === 'BigInt') {
      properties[field.name] = {
        components: {},
        isVisible: { list: true, filter: true, show: true, edit: !readOnly },
      };
    }
  }

  // Never render a password hash, and never let one be typed in raw.
  if (model.name === 'users') {
    properties.password = { isVisible: false };
  }
  if (model.name === 'admin_users') {
    properties.password_hash = { isVisible: false };
    // A virtual field: type a plaintext password, the before-hook bcrypts it.
    properties.newPassword = {
      type: 'password',
      isVisible: { list: false, filter: false, show: false, edit: true },
    };
  }

  // Soft-deleted rows stay in the table forever; they should not clutter lists.
  if (softDelete) {
    properties.deleted_at = { isVisible: { list: true, filter: true, show: true, edit: false } };
  }

  return properties;
}

export function buildResources() {
  const models = Prisma.dmmf.datamodel.models.filter((m) => !HIDDEN.has(m.name));

  return models.map((model) => {
    const readOnly = READ_ONLY.has(model.name);
    // Detects api/'s soft-delete migration the moment it lands: no code change
    // here, just re-run `npm run pull`.
    const softDelete = model.fields.some((f) => f.name === 'deleted_at');

    const actions = {};

    if (readOnly) {
      actions.new = { isAccessible: false };
      actions.edit = { isAccessible: false };
      actions.delete = { isAccessible: false };
      actions.bulkDelete = { isAccessible: false };
    }

    if (softDelete) {
      // Hard DELETE would destroy the row api/ expects to still be there for
      // refunds, audits and disputes. Replace it with a deleted_at stamp, and
      // hide already-deleted rows from the default list.
      actions.delete = softDeleteAction(model.name);
      actions.bulkDelete = { isAccessible: false };
    }

    if (model.name === 'payouts') {
      Object.assign(actions, payoutActions());
    }

    if (model.name === 'admin_users') {
      actions.new = { isAccessible: isSuperAdmin, before: beforeSaveHashPassword };
      actions.edit = { isAccessible: isSuperAdmin, before: beforeSaveHashPassword };
      actions.delete = { isAccessible: isSuperAdmin };
    }

    if (model.name === 'admin_audit_log') {
      actions.new = { isAccessible: false };
      actions.edit = { isAccessible: false };
      actions.delete = { isAccessible: false };
      actions.bulkDelete = { isAccessible: false };
    }

    return {
      resource: { model: getModelByName(model.name), client: prisma },
      options: {
        navigation: { name: groupOf(model.name) },
        properties: propertiesFor(model, { readOnly, softDelete }),
        actions,
      },
    };
  });
}
