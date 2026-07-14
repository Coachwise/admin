import { prisma } from '../db.js';
import { audit } from './audit.js';

// The payout lifecycle, and why it can't be a dropdown.
//
// api/'s RequestPayout (models/payout.go) debits the wallet AT REQUEST TIME: the
// moment a coach asks for money, a -amount PAYOUT row is written to
// wallet_transactions. So while status is REQUESTED, the money is already out of
// their available balance.
//
//   APPROVED  status only — already debited, no ledger change.
//   PAID      status only — already debited, no ledger change.
//   REJECTED  MUST CREDIT THE MONEY BACK. The debit already happened; rejecting
//             without the credit destroys the coach's balance silently, and
//             because balances are derived from the ledger there is nothing to
//             alert on and no way to notice later.
//
// That last one is the whole reason payouts are not editable through a normal
// CRUD form. Status and ledger move together, in one transaction, or not at all.

const SUPER = ({ currentAdmin }) => currentAdmin?.role === 'SUPERADMIN';

const notice = (message, type = 'success') => ({ message, type });

/**
 * Moves a payout between statuses, atomically.
 *
 * The updateMany + `status: { in: from }` filter is the concurrency guard: if
 * another admin already moved this payout, it matches zero rows and we bail out
 * BEFORE touching the ledger, rather than crediting a coach twice.
 */
async function transition({ id, from, to, adminId, creditBack }) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.payouts.findUnique({ where: { id } });
    if (!payout) throw new Error('Payout not found.');

    const moved = await tx.payouts.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, updated_at: new Date() },
    });

    if (moved.count === 0) {
      throw new Error(
        `Payout is ${payout.status}, not ${from.join(' or ')} — someone may have already actioned it. Nothing was changed.`,
      );
    }

    if (creditBack) {
      // Give the money back. REFUND is in the wallet_transactions type CHECK, and
      // ref_type/ref_id tie the credit to the payout it reverses.
      await tx.wallet_transactions.create({
        data: {
          wallet_id: payout.wallet_id,
          currency: payout.currency,
          amount: payout.amount, // positive: reverses the -amount debit
          type: 'REFUND',
          available_at: new Date(),
          ref_type: 'payout',
          ref_id: payout.id,
          description: 'Payout rejected — amount returned to wallet',
        },
      });
    }

    await audit(tx, {
      adminId,
      action: to,
      resource: 'payouts',
      resourceId: id,
      detail: {
        from: payout.status,
        to,
        amount: payout.amount.toString(),
        currency: payout.currency,
        coach_id: payout.coach_id,
        credited_back: Boolean(creditBack),
      },
    });

    return payout;
  });
}

const action = ({ label, icon, from, to, creditBack, guard }) => ({
  actionType: 'record',
  icon,
  label,
  isAccessible: SUPER,
  isVisible: (context) => from.includes(context.record?.params?.status),
  guard,
  handler: async (request, response, context) => {
    const { record, currentAdmin, h, resource } = context;
    const id = record.id();

    try {
      const before = await transition({
        id,
        from,
        to,
        adminId: currentAdmin.id,
        creditBack,
      });

      const fresh = await resource.findOne(id);
      const amount = `${before.amount.toString()} ${before.currency}`;

      return {
        record: fresh.toJSON(currentAdmin),
        redirectUrl: h.resourceUrl({ resourceId: resource._decorated?.id() ?? 'payouts' }),
        notice: notice(
          creditBack
            ? `Payout rejected. ${amount} returned to the coach's wallet.`
            : `Payout marked ${to}.`,
        ),
      };
    } catch (err) {
      return {
        record: record.toJSON(currentAdmin),
        notice: notice(err.message, 'error'),
      };
    }
  },
});

export const payoutActions = () => ({
  approvePayout: action({
    label: 'Approve',
    icon: 'Check',
    from: ['REQUESTED'],
    to: 'APPROVED',
    creditBack: false,
  }),

  markPaid: action({
    label: 'Mark paid',
    icon: 'DollarSign',
    from: ['APPROVED'],
    to: 'PAID',
    creditBack: false,
    guard: 'Confirm the money has actually been transferred to the coach. This cannot be undone.',
  }),

  rejectPayout: action({
    label: 'Reject & refund',
    icon: 'X',
    from: ['REQUESTED', 'APPROVED'],
    to: 'REJECTED',
    creditBack: true,
    guard: "Reject this payout and return the amount to the coach's wallet?",
  }),
});
