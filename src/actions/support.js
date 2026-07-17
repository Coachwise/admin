import { prisma } from '../db.js';
import { audit } from './audit.js';

// Answering a support ticket, from the panel.
//
// The panel writes straight to Postgres and can't reach the API's event bus, so
// the api-side worker (StartSupportDeliveryLoop) is what actually pushes this
// reply to the user — it polls for support_messages with delivered_at IS NULL.
// All this action does is write the row (delivered_at stays NULL) and hand the
// turn back to the user; the worker takes it from there.
//
// The conversation is turn-based: an admin may only reply when it is the admin's
// turn. The turn flip is part of the same transaction as the insert, so it also
// guards two admins answering at once — the second finds the turn already handed
// back and is refused.

const notice = (message, type = 'success') => ({ message, type });

const showUrl = (context, id) =>
  context.h.showUrl(context.resource._decorated?.id() ?? 'support_tickets', id);

export const supportActions = () => ({
  reply: {
    actionType: 'record',
    icon: 'Send',
    label: 'Reply',
    // Only answerable while open and genuinely awaiting the admin.
    isVisible: (context) =>
      context.record?.params?.status === 'OPEN' && context.record?.params?.turn === 'ADMIN',
    // A single free-text field on the action form.
    component: false,
    handler: async (request, response, context) => {
      const { record, currentAdmin } = context;
      const id = record.id();

      // GET renders the form; POST carries the typed reply.
      if (request.method !== 'post') {
        return { record: record.toJSON(currentAdmin) };
      }

      const body = (request.payload?.body || '').trim();
      if (!body) {
        return { record: record.toJSON(currentAdmin), notice: notice('Write a reply first.', 'error') };
      }

      try {
        await prisma.$transaction(async (tx) => {
          const ticket = await tx.support_tickets.findUnique({ where: { id } });
          if (!ticket) throw new Error('Ticket not found.');
          if (ticket.status !== 'OPEN') throw new Error('This ticket is closed.');

          // Claim the turn: succeeds only if it is genuinely the admin's turn.
          const moved = await tx.support_tickets.updateMany({
            where: { id, turn: 'ADMIN', status: 'OPEN' },
            data: { turn: 'USER', last_message_at: new Date(), updated_at: new Date() },
          });
          if (moved.count === 0) {
            throw new Error("Not the admin's turn — the user hasn't replied, or someone already answered.");
          }

          await tx.support_messages.create({
            // delivered_at stays NULL → the worker pushes it to the user.
            data: { ticket_id: id, sender: 'ADMIN', body },
          });

          await audit(tx, {
            adminId: currentAdmin.id,
            action: 'SUPPORT_REPLY',
            resource: 'support_tickets',
            resourceId: id,
            detail: { chars: body.length },
          });
        });
      } catch (err) {
        return { record: record.toJSON(currentAdmin), notice: notice(err.message, 'error') };
      }

      const fresh = await context.resource.findOne(id);
      return {
        record: fresh.toJSON(currentAdmin),
        redirectUrl: showUrl(context, id),
        notice: notice('Reply sent. The user will be notified.'),
      };
    },
  },

  close: {
    actionType: 'record',
    icon: 'X',
    label: 'Close ticket',
    guard: 'Close this ticket? The user can still open a new one.',
    isVisible: (context) => context.record?.params?.status === 'OPEN',
    handler: async (request, response, context) => {
      const { record, currentAdmin } = context;
      const id = record.id();

      await prisma.$transaction(async (tx) => {
        await tx.support_tickets.update({
          where: { id },
          data: { status: 'CLOSED', updated_at: new Date(), last_message_at: new Date() },
        });
        // A SYSTEM marker with delivered_at NULL — the api worker picks it up and
        // notifies the user their ticket was closed (the panel can't emit events).
        // The body is a stable marker the app localizes, not prose.
        await tx.support_messages.create({
          data: { ticket_id: id, sender: 'SYSTEM', body: 'closed_by_support' },
        });
        await audit(tx, {
          adminId: currentAdmin.id,
          action: 'SUPPORT_CLOSE',
          resource: 'support_tickets',
          resourceId: id,
        });
      });

      const fresh = await context.resource.findOne(id);
      return {
        record: fresh.toJSON(currentAdmin),
        redirectUrl: showUrl(context, id),
        notice: notice('Ticket closed.'),
      };
    },
  },
});
