import { prisma } from '../db.js';
import { audit } from './audit.js';

/**
 * Replaces AdminJS's hard DELETE with a `deleted_at` stamp.
 *
 * Activates automatically for any table that has a deleted_at column (see
 * resources.js). api/'s rule is that rows are never removed — a refund, an audit
 * or a dispute all need the row a DELETE would have destroyed — so the panel must
 * not be the one tool in the system that can actually destroy them.
 */
export const softDeleteAction = (modelName) => ({
  actionType: 'record',
  icon: 'Trash2',
  label: 'Delete',
  guard: 'Delete this record? It is kept in the database and can be restored.',
  handler: async (request, response, context) => {
    const { record, currentAdmin, h, resource } = context;
    const id = record.id();

    await prisma.$transaction(async (tx) => {
      await tx[modelName].update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      await audit(tx, {
        adminId: currentAdmin.id,
        action: 'SOFT_DELETE',
        resource: modelName,
        resourceId: id,
        detail: null,
      });
    });

    return {
      record: record.toJSON(currentAdmin),
      redirectUrl: h.resourceUrl({ resourceId: resource._decorated?.id() ?? modelName }),
      notice: { message: 'Record deleted. It is retained and can be restored.', type: 'success' },
    };
  },
});
